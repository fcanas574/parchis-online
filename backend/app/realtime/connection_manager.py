import asyncio
import logging
from time import perf_counter
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import WebSocket

from app.game.models import SessionIdentity
from app.realtime.diagnostics import diagnostic_id


logger = logging.getLogger(__name__)


REPLACED_CONNECTION_CLOSE_CODE = 4000
REPLACED_CONNECTION_CLOSE_REASON = "Replaced by a newer connection."


@dataclass(frozen=True, slots=True)
class ClientConnection:
    websocket: WebSocket
    identity: SessionIdentity


@dataclass(slots=True)
class _PublicationLockEntry:
    lock: asyncio.Lock
    users: int = 0


class RoomPublicationCoordinator:
    def __init__(self) -> None:
        self._entries: dict[str, _PublicationLockEntry] = {}
        self._guard = asyncio.Lock()

    @asynccontextmanager
    async def serialize(self, room_code: str) -> AsyncIterator[None]:
        async with self._guard:
            entry = self._entries.setdefault(
                room_code,
                _PublicationLockEntry(lock=asyncio.Lock()),
            )
            entry.users += 1

        trace_timing = logger.isEnabledFor(logging.DEBUG)
        waiting_started = perf_counter() if trace_timing else 0.0
        if trace_timing:
            logger.debug(
                "realtime_room_lock_waiting room_id=%s queued=%d",
                diagnostic_id(room_code),
                max(entry.users - 1, 0),
            )
        try:
            async with entry.lock:
                acquired_at = perf_counter() if trace_timing else 0.0
                if trace_timing:
                    logger.debug(
                        "realtime_room_lock_acquired room_id=%s wait_ms=%.2f",
                        diagnostic_id(room_code),
                        (acquired_at - waiting_started) * 1000,
                    )
                try:
                    yield
                finally:
                    if trace_timing:
                        logger.debug(
                            "realtime_room_lock_released room_id=%s hold_ms=%.2f",
                            diagnostic_id(room_code),
                            (perf_counter() - acquired_at) * 1000,
                        )
        finally:
            async with self._guard:
                entry.users -= 1
                if entry.users == 0 and self._entries.get(room_code) is entry:
                    self._entries.pop(room_code, None)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, ClientConnection]] = {}
        self._lock = asyncio.Lock()

    async def add(
        self,
        room_code: str,
        connection: ClientConnection,
    ) -> ClientConnection | None:
        if connection.identity.room_code != room_code:
            raise ValueError(
                "Connection identity room code "
                f"{connection.identity.room_code!r} does not match target room code "
                f"{room_code!r}."
            )
        async with self._lock:
            room_connections = self._connections.setdefault(room_code, {})
            previous = room_connections.get(connection.identity.player_id)
            room_connections[connection.identity.player_id] = connection

        if previous is not None and previous is not connection:
            try:
                await previous.websocket.close(
                    code=REPLACED_CONNECTION_CLOSE_CODE,
                    reason=REPLACED_CONNECTION_CLOSE_REASON,
                )
            except Exception:
                pass
            return previous
        return None

    async def remove(
        self,
        room_code: str,
        player_id: str,
        connection: ClientConnection | None = None,
    ) -> bool:
        async with self._lock:
            room_connections = self._connections.get(room_code)
            if room_connections is None:
                return False
            current = room_connections.get(player_id)
            if current is None:
                return False
            if connection is not None and current is not connection:
                return False
            return self._remove_locked(room_code, player_id)

    async def is_current(self, connection: ClientConnection) -> bool:
        async with self._lock:
            return (
                self._connections.get(connection.identity.room_code, {}).get(
                    connection.identity.player_id
                )
                is connection
            )

    async def broadcast(
        self,
        room_code: str,
        event: dict[str, object],
        exclude_player_id: str | None = None,
    ) -> list[ClientConnection]:
        """Return failed targets; the lifecycle owner handles their removal."""
        async with self._lock:
            targets = [
                connection
                for player_id, connection in self._connections.get(
                    room_code, {}
                ).items()
                if player_id != exclude_player_id
            ]

        failed: list[ClientConnection] = []
        for connection in targets:
            failure = await self.send(connection, event)
            if failure is not None:
                failed.append(failure)
        return failed

    async def send(
        self,
        connection: ClientConnection,
        event: dict[str, object],
    ) -> ClientConnection | None:
        """Report failure without consuming the lifecycle's removal claim."""
        started_at = perf_counter()
        event_type = event.get("type", "unknown")
        state_version = event.get("stateVersion", "unknown")
        trace_timing = logger.isEnabledFor(logging.DEBUG)
        event_id = request_id = room_id = player_id = "none"
        if trace_timing:
            raw_event_id = event.get("eventId")
            raw_request_id = event.get("requestId")
            event_id = (
                diagnostic_id(raw_event_id)
                if isinstance(raw_event_id, str)
                else "none"
            )
            request_id = (
                diagnostic_id(raw_request_id)
                if isinstance(raw_request_id, str)
                else "none"
            )
            room_id = diagnostic_id(connection.identity.room_code)
            player_id = diagnostic_id(connection.identity.player_id)
            logger.debug(
                "realtime_ws_send_started room_id=%s player_id=%s event=%s "
                "state_version=%s event_id=%s request_id=%s",
                room_id,
                player_id,
                event_type,
                state_version,
                event_id,
                request_id,
            )
        try:
            await connection.websocket.send_json(event)
        except Exception as error:
            if not trace_timing:
                room_id = diagnostic_id(connection.identity.room_code)
                player_id = diagnostic_id(connection.identity.player_id)
            raw_event_id = event.get("eventId")
            raw_request_id = event.get("requestId")
            event_id = (
                diagnostic_id(raw_event_id)
                if isinstance(raw_event_id, str)
                else "none"
            )
            request_id = (
                diagnostic_id(raw_request_id)
                if isinstance(raw_request_id, str)
                else "none"
            )
            logger.warning(
                "realtime_ws_send_failed room_id=%s player_id=%s event=%s "
                "state_version=%s event_id=%s request_id=%s duration_ms=%.2f "
                "error_type=%s",
                room_id,
                player_id,
                event_type,
                state_version,
                event_id,
                request_id,
                (perf_counter() - started_at) * 1000,
                type(error).__name__,
            )
            return connection
        if trace_timing:
            logger.debug(
                "realtime_ws_send_finished room_id=%s player_id=%s event=%s "
                "state_version=%s event_id=%s request_id=%s duration_ms=%.2f",
                room_id,
                player_id,
                event_type,
                state_version,
                event_id,
                request_id,
                (perf_counter() - started_at) * 1000,
            )
        return None

    def connected_player_ids(self, room_code: str) -> set[str]:
        return set(self._connections.get(room_code, {}))

    def connection_counts(self, room_code: str) -> tuple[int, int]:
        """Return current room and process counts for registered WebSockets."""
        room_count = len(self._connections.get(room_code, {}))
        process_count = sum(len(players) for players in self._connections.values())
        return room_count, process_count

    def _remove_locked(self, room_code: str, player_id: str) -> bool:
        room_connections = self._connections.get(room_code)
        if room_connections is None:
            return False
        removed = room_connections.pop(player_id, None)
        if not room_connections:
            self._connections.pop(room_code, None)
        return removed is not None
