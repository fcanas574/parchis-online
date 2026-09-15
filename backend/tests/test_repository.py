import pytest


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
