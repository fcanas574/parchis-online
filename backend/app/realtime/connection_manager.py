import asyncio
from dataclasses import dataclass

from fastapi import WebSocket, WebSocketDisconnect

from app.game.models import SessionIdentity


@dataclass(frozen=True, slots=True)
class ClientConnection:
    websocket: WebSocket
    identity: SessionIdentity


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, dict[str, ClientConnection]] = {}
        self._lock = asyncio.Lock()

    async def add(self, room_code: str, connection: ClientConnection) -> None:
        if connection.identity.room_code != room_code:
            raise ValueError(
                "Connection identity room code "
                f"{connection.identity.room_code!r} does not match target room code "
                f"{room_code!r}."
            )
        async with self._lock:
            room_connections = self._connections.setdefault(room_code, {})
            room_connections[connection.identity.player_id] = connection

    async def remove(self, room_code: str, player_id: str) -> None:
        async with self._lock:
            self._remove_locked(room_code, player_id)

    async def broadcast(
        self,
        room_code: str,
        event: dict[str, object],
        exclude_player_id: str | None = None,
    ) -> None:
        async with self._lock:
            targets = [
                connection
                for player_id, connection in self._connections.get(
                    room_code, {}
                ).items()
                if player_id != exclude_player_id
            ]

        for connection in targets:
            await self.send(connection, event)

    async def send(
        self,
        connection: ClientConnection,
        event: dict[str, object],
    ) -> None:
        try:
            await connection.websocket.send_json(event)
        except WebSocketDisconnect:
            await self._remove_failed(connection)
        except Exception:
            await self._remove_failed(connection)

    def connected_player_ids(self, room_code: str) -> set[str]:
        return set(self._connections.get(room_code, {}))

    async def _remove_failed(self, connection: ClientConnection) -> None:
        room_code = connection.identity.room_code
        player_id = connection.identity.player_id
        async with self._lock:
            room_connections = self._connections.get(room_code)
            if room_connections is None:
                return
            if room_connections.get(player_id) is connection:
                self._remove_locked(room_code, player_id)

    def _remove_locked(self, room_code: str, player_id: str) -> None:
        room_connections = self._connections.get(room_code)
        if room_connections is None:
            return
        room_connections.pop(player_id, None)
        if not room_connections:
            self._connections.pop(room_code, None)
