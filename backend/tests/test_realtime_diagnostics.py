import asyncio
import logging

import pytest

from app.game.models import SessionIdentity
from app.realtime.connection_manager import (
    ClientConnection,
    ConnectionManager,
    RoomPublicationCoordinator,
)


class RecordingSocket:
    async def send_json(self, event: dict[str, object]) -> None:
        await asyncio.sleep(0)


class FailingSocket:
    async def send_json(self, event: dict[str, object]) -> None:
        raise RuntimeError("injected send failure")


@pytest.mark.asyncio
async def test_room_publication_logs_lock_wait_and_hold_without_raw_room_code(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="app.realtime.connection_manager")
    coordinator = RoomPublicationCoordinator()

    async with coordinator.serialize("AB7K2"):
        await asyncio.sleep(0)

    assert "realtime_room_lock_acquired" in caplog.text
    assert "realtime_room_lock_released" in caplog.text
    assert "wait_ms=" in caplog.text
    assert "hold_ms=" in caplog.text
    assert "AB7K2" not in caplog.text


@pytest.mark.asyncio
async def test_socket_send_logs_event_timing_without_raw_player_or_room_ids(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="app.realtime.connection_manager")
    manager = ConnectionManager()
    connection = ClientConnection(
        RecordingSocket(),
        SessionIdentity(room_code="AB7K2", player_id="private-player-id"),
    )
    event = {
        "type": "GAME_STATE_SYNC",
        "roomCode": "AB7K2",
        "eventId": "event-123",
        "stateVersion": 9,
        "payload": {},
    }

    await manager.send(connection, event)

    assert "realtime_ws_send_started" in caplog.text
    assert "realtime_ws_send_finished" in caplog.text
    assert "event=GAME_STATE_SYNC" in caplog.text
    assert "state_version=9" in caplog.text
    assert "duration_ms=" in caplog.text
    assert "private-player-id" not in caplog.text
    assert "AB7K2" not in caplog.text


@pytest.mark.asyncio
async def test_failed_socket_send_logs_failure_without_exception_contents(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="app.realtime.connection_manager")
    manager = ConnectionManager()
    connection = ClientConnection(
        FailingSocket(),
        SessionIdentity(room_code="AB7K2", player_id="p1"),
    )

    failure = await manager.send(connection, {"type": "DICE_ROLLED", "stateVersion": 3})

    assert failure is connection
    assert "realtime_ws_send_failed" in caplog.text
    assert "error_type=RuntimeError" in caplog.text
    assert "injected send failure" not in caplog.text
    assert "AB7K2" not in caplog.text
