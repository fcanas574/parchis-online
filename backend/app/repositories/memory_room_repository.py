import asyncio

from app.game.models import RoomState


class MemoryRoomRepository:
    def __init__(self) -> None:
        self._rooms: dict[str, RoomState] = {}
        self._lock = asyncio.Lock()

    async def create(self, room: RoomState) -> None:
        async with self._lock:
            self._rooms[room.room_code] = room

    async def get(self, room_code: str) -> RoomState | None:
        async with self._lock:
            return self._rooms.get(room_code)

    async def save(self, room: RoomState) -> None:
        async with self._lock:
            self._rooms[room.room_code] = room

    async def delete(self, room_code: str) -> None:
        async with self._lock:
            self._rooms.pop(room_code, None)

    async def list_rooms(self) -> list[RoomState]:
        async with self._lock:
            return list(self._rooms.values())
