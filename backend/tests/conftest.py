import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from app.game.models import RoomState
from app.repositories.memory_room_repository import MemoryRoomRepository


class ControllableClock:
    def __init__(self) -> None:
        self.current = datetime(2026, 9, 14, 18, 30, tzinfo=UTC)

    def __call__(self) -> datetime:
        return self.current

    def advance(self, *, seconds: int) -> None:
        self.current += timedelta(seconds=seconds)


@pytest.fixture
def room_repository() -> MemoryRoomRepository:
    return MemoryRoomRepository()


@pytest.fixture
def clock() -> ControllableClock:
    return ControllableClock()


@pytest.fixture
def room() -> RoomState:
    return RoomState(
        room_code="AB7K2",
        max_players=4,
        host_player_id="p1",
        players=[],
    )


@pytest.fixture
def code_generator():
    room_codes = iter(("AB7K2", "CD3E4"))
    return lambda: next(room_codes)


@pytest.fixture
def token_generator():
    player_tokens = iter(("token-1", "token-2", "token-3"))
    return lambda: next(player_tokens)


@pytest.fixture
def reservation_ttl_seconds() -> int:
    return 600


@pytest.fixture
def room_manager(
    room_repository,
    code_generator,
    token_generator,
    clock,
    reservation_ttl_seconds,
):
    from app.services.room_manager import RoomManager

    return RoomManager(
        repository=room_repository,
        code_generator=code_generator,
        token_generator=token_generator,
        clock=clock,
        reservation_ttl_seconds=reservation_ttl_seconds,
    )
