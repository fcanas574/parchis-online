from typing import Protocol

from app.game.models import RoomState


class RoomCodeCollisionError(Exception):
    def __init__(self, room_code: str) -> None:
        self.room_code = room_code
        super().__init__(f"Room code already exists: {room_code}")


class RoomRepository(Protocol):
    async def create(self, room: RoomState) -> None:
        raise NotImplementedError

    async def get(self, room_code: str) -> RoomState | None:
        raise NotImplementedError

    async def save(self, room: RoomState) -> None:
        raise NotImplementedError

    async def delete(self, room_code: str) -> None:
        raise NotImplementedError

    async def list_rooms(self) -> list[RoomState]:
        raise NotImplementedError
