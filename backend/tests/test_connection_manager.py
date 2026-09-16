from unittest.mock import AsyncMock

import pytest

from app.game.models import SessionIdentity
from app.realtime.connection_manager import ClientConnection, ConnectionManager
from app.realtime.events import make_event


@pytest.fixture
def manager() -> ConnectionManager:
    return ConnectionManager()


@pytest.fixture
def sockets() -> list[AsyncMock]:
    return [AsyncMock(), AsyncMock()]


@pytest.mark.asyncio
async def test_broadcast_sends_only_to_connections_in_room(manager, sockets):
    first = ClientConnection(sockets[0], SessionIdentity("AB7K2", "p1"))
    second = ClientConnection(sockets[1], SessionIdentity("CD3K4", "p2"))
    await manager.add("AB7K2", first)
    await manager.add("CD3K4", second)

    event = make_event(
        "PLAYER_READY",
        "AB7K2",
        2,
        {"playerId": "p1", "ready": True},
    )
    await manager.broadcast("AB7K2", event)

    sockets[0].send_json.assert_awaited_once_with(event)
    sockets[1].send_json.assert_not_awaited()


@pytest.mark.asyncio
async def test_add_rejects_connection_from_different_room(manager, sockets):
    connection = ClientConnection(sockets[0], SessionIdentity("CD3K4", "p1"))

    with pytest.raises(ValueError, match="room code.*CD3K4.*AB7K2"):
        await manager.add("AB7K2", connection)

    assert manager.connected_player_ids("AB7K2") == set()
    assert manager.connected_player_ids("CD3K4") == set()


def test_event_envelope_uses_wire_names_and_version():
    event = make_event("GAME_STATE_SYNC", "AB7K2", 3, {"room": {}})

    assert event["type"] == "GAME_STATE_SYNC"
    assert event["version"] == 1
    assert event["roomCode"] == "AB7K2"
    assert event["stateVersion"] == 3
    assert event["eventId"]
    assert event["serverTime"].endswith("Z")


def test_event_envelope_includes_request_id_only_when_provided():
    without_request = make_event("GAME_STATE_SYNC", "AB7K2", 3, {"room": {}})
    with_request = make_event(
        "ERROR",
        "AB7K2",
        3,
        {"code": "INVALID_MESSAGE", "message": "Invalid message."},
        request_id="req-1",
    )

    assert "requestId" not in without_request
    assert with_request["requestId"] == "req-1"


@pytest.mark.asyncio
async def test_remove_updates_connected_player_ids(manager, sockets):
    connection = ClientConnection(sockets[0], SessionIdentity("AB7K2", "p1"))
    await manager.add("AB7K2", connection)

    assert manager.connected_player_ids("AB7K2") == {"p1"}

    removed = await manager.remove("AB7K2", "p1")

    assert removed is True
    assert manager.connected_player_ids("AB7K2") == set()


@pytest.mark.asyncio
async def test_duplicate_connection_replaces_old_and_stale_remove_is_ignored(
    manager,
    sockets,
):
    old_connection = ClientConnection(
        sockets[0], SessionIdentity("AB7K2", "p1")
    )
    new_connection = ClientConnection(
        sockets[1], SessionIdentity("AB7K2", "p1")
    )
    await manager.add("AB7K2", old_connection)

    replaced = await manager.add("AB7K2", new_connection)
    stale_removed = await manager.remove(
        "AB7K2",
        "p1",
        old_connection,
    )

    assert replaced is old_connection
    sockets[0].close.assert_awaited_once_with(
        code=4000,
        reason="Replaced by a newer connection.",
    )
    assert stale_removed is False
    assert manager.connected_player_ids("AB7K2") == {"p1"}

    current_removed = await manager.remove("AB7K2", "p1", new_connection)

    assert current_removed is True
    assert manager.connected_player_ids("AB7K2") == set()


@pytest.mark.asyncio
async def test_broadcast_excludes_requested_player(manager, sockets):
    first = ClientConnection(sockets[0], SessionIdentity("AB7K2", "p1"))
    second = ClientConnection(sockets[1], SessionIdentity("AB7K2", "p2"))
    await manager.add("AB7K2", first)
    await manager.add("AB7K2", second)
    event = make_event(
        "PLAYER_READY",
        "AB7K2",
        4,
        {"playerId": "p1", "ready": True},
    )

    await manager.broadcast("AB7K2", event, exclude_player_id="p1")

    sockets[0].send_json.assert_not_awaited()
    sockets[1].send_json.assert_awaited_once_with(event)


@pytest.mark.asyncio
async def test_broadcast_reports_failed_connection_for_lifecycle_cleanup(
    manager: ConnectionManager,
    sockets: list[AsyncMock],
) -> None:
    sockets[0].send_json.side_effect = RuntimeError("connection closed")
    first = ClientConnection(sockets[0], SessionIdentity("AB7K2", "p1"))
    second = ClientConnection(sockets[1], SessionIdentity("AB7K2", "p2"))
    await manager.add("AB7K2", first)
    await manager.add("AB7K2", second)
    event = make_event("GAME_STATE_SYNC", "AB7K2", 4, {"room": {}})

    failed = await manager.broadcast("AB7K2", event)

    sockets[1].send_json.assert_awaited_once_with(event)
    assert failed == [first]
    # Only the lifecycle owner may claim removal and the domain disconnect.
    assert await manager.is_current(first)


@pytest.mark.asyncio
async def test_send_reports_exact_failed_connection_after_replacement(
    manager: ConnectionManager,
    sockets: list[AsyncMock],
) -> None:
    old = ClientConnection(sockets[0], SessionIdentity("AB7K2", "p1"))
    replacement = ClientConnection(sockets[1], old.identity)
    await manager.add("AB7K2", old)
    await manager.add("AB7K2", replacement)
    sockets[0].send_json.side_effect = RuntimeError("old transport failed")

    failed = await manager.send(old, {"type": "ERROR"})

    assert failed is old
    assert await manager.is_current(replacement)
    assert not await manager.remove("AB7K2", "p1", old)
