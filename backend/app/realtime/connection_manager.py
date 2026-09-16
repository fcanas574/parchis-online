import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass

from fastapi import WebSocket

from app.game.models import SessionIdentity


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

        try:
            async with entry.lock:
                yield
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
        try:
            await connection.websocket.send_json(event)
        except Exception:
            return connection
        return None

    def connected_player_ids(self, room_code: str) -> set[str]:
        return set(self._connections.get(room_code, {}))

    def _remove_locked(self, room_code: str, player_id: str) -> bool:
        room_connections = self._connections.get(room_code)
        if room_connections is None:
            return False
        removed = room_connections.pop(player_id, None)
        if not room_connections:
            self._connections.pop(room_code, None)
        return removed is not None
