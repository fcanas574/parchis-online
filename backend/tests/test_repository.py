import asyncio

import pytest

from app.game.models import RoomState
from app.repositories.room_repository import RoomCodeCollisionError


@pytest.mark.asyncio
async def test_repository_round_trips_and_deletes_room(room_repository, room):
    await room_repository.create(room)
    assert await room_repository.get(room.room_code) is room

    room.state_version = 1
    await room_repository.save(room)
    assert (await room_repository.get(room.room_code)).state_version == 1

    await room_repository.delete(room.room_code)
    assert await room_repository.get(room.room_code) is None


@pytest.mark.asyncio
async def test_repository_returns_none_for_unknown_code(room_repository):
    assert await room_repository.get("AB7K2") is None


@pytest.mark.asyncio
async def test_repository_rejects_duplicate_room_code(room_repository, room):
    await room_repository.create(room)

    with pytest.raises(RoomCodeCollisionError) as collision:
        await room_repository.create(
            RoomState(
                room_code=room.room_code,
                max_players=room.max_players,
                host_player_id="p2",
                players=[],
            )
        )

    assert collision.value.room_code == room.room_code
    assert await room_repository.get(room.room_code) is room


@pytest.mark.asyncio
async def test_repository_concurrent_create_has_one_winner(room_repository, room):
    other_room = RoomState(
        room_code=room.room_code,
        max_players=room.max_players,
        host_player_id="p2",
        players=[],
    )

    results = await asyncio.gather(
        room_repository.create(room),
        room_repository.create(other_room),
        return_exceptions=True,
    )

    assert sum(result is None for result in results) == 1
    collisions = [result for result in results if isinstance(result, RoomCodeCollisionError)]
    assert len(collisions) == 1
    assert await room_repository.get(room.room_code) in (room, other_room)


@pytest.mark.asyncio
async def test_repository_lists_rooms(room_repository, room):
    other_room = RoomState(
        room_code="CD3E4",
        max_players=4,
        host_player_id="p2",
        players=[],
    )
    await room_repository.create(room)
    await room_repository.create(other_room)

    assert await room_repository.list_rooms() == [room, other_room]
