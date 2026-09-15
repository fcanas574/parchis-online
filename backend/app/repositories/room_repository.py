from typing import Protocol

from app.game.models import RoomState


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
