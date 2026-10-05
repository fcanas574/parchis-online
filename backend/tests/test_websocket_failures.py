import asyncio
import json
import logging
from collections.abc import AsyncIterator, Callable
from contextlib import AsyncExitStack, asynccontextmanager
from dataclasses import dataclass, field
from itertools import count
from typing import cast

import pytest
from fastapi import WebSocket, WebSocketDisconnect
from starlette.types import Message, Scope

from app.api.websocket import room_websocket
from app.game.models import RoomCredentialData, SessionIdentity
from app.realtime.connection_manager import ConnectionManager, RoomPublicationCoordinator
from app.services.room_manager import RoomManager
from game_support import create_ready_room


@pytest.fixture
def token_generator() -> Callable[[], str]:
    tokens = (f"token-{number:032d}" for number in count(1))
    return lambda: next(tokens)


@dataclass
class SocketHarness:
    """Real endpoint/Starlette socket, with controllable ASGI transport failure."""

    incoming: asyncio.Queue[Message] = field(default_factory=asyncio.Queue)
    outgoing: asyncio.Queue[dict[str, object]] = field(default_factory=asyncio.Queue)
    fail_on: str | None = None
    disconnect_exception: bool = False
    failed: bool = False
    close_code: int | None = None
    fail_close: bool = False

    async def send(self, message: Message) -> None:
        if message["type"] == "websocket.close":
            if self.fail_close:
                raise RuntimeError("injected ASGI close failure")
            self.close_code = message["code"]
        if message["type"] != "websocket.send":
            return
        event = cast(dict[str, object], json.loads(message["text"]))
        if self.failed or event["type"] == self.fail_on:
            self.failed = True
            if self.disconnect_exception:
                raise WebSocketDisconnect(code=1006)
            raise RuntimeError("injected ASGI send failure")
        self.outgoing.put_nowait(event)

    def command(self, message: dict[str, object]) -> None:
        self.text(json.dumps(message))

    def text(self, text: str) -> None:
        self.incoming.put_nowait({"type": "websocket.receive", "text": text})

    async def event(self, expected_type: str) -> dict[str, object]:
        event = await asyncio.wait_for(self.outgoing.get(), timeout=1)
        assert event["type"] == expected_type
        return event


@asynccontextmanager
async def connected_socket(
    credentials: RoomCredentialData,
    room_manager: RoomManager,
    connections: ConnectionManager,
    coordinator: RoomPublicationCoordinator,
    *,
    fail_on: str | None = None,
) -> AsyncIterator[tuple[SocketHarness, asyncio.Task[None]]]:
    transport = SocketHarness(fail_on=fail_on)
    transport.incoming.put_nowait({"type": "websocket.connect"})
    transport.command({
        "type": "RECONNECT",
        "version": 1,
        "roomCode": credentials.room_code,
        "playerToken": credentials.player_token,
    })
    scope: Scope = {"type": "websocket", "path": credentials.ws_path}
    task = asyncio.create_task(room_websocket(
        WebSocket(scope, transport.incoming.get, transport.send),
        credentials.room_code,
        room_manager,
        connections,
        coordinator,
    ))
    try:
        yield transport, task
    finally:
        transport.incoming.put_nowait({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(task, timeout=1)


def snapshot_player(event: dict[str, object], player_id: str) -> dict[str, object]:
    payload = cast(dict[str, object], event["payload"])
    room = cast(dict[str, object], payload["room"])
    players = cast(list[dict[str, object]], room["players"])
    return next(player for player in players if player["id"] == player_id)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("failure_event", "trigger", "disconnect_exception"),
    [
        ("PLAYER_READY", "ready", False),
        ("GAME_STATE_SYNC", "ready", True),
        ("ERROR", "command-error", False),
        ("ERROR", "invalid-json", False),
        ("ERROR", "oversized", True),
    ],
)
async def test_failed_send_reserves_player_and_publishes_once(
    room_manager: RoomManager,
    failure_event: str,
    trigger: str,
    disconnect_exception: bool,
) -> None:
    connections = ConnectionManager()
    coordinator = RoomPublicationCoordinator()
    host = await room_manager.create_room("Host", 4, "green")
    guest = await room_manager.join_room(host.room_code, "Guest", "red")
    async with AsyncExitStack() as stack:
        observer, _ = await stack.enter_async_context(connected_socket(
            host, room_manager, connections, coordinator,
        ))
        await observer.event("PLAYER_JOINED")
        await observer.event("GAME_STATE_SYNC")
        await observer.event("CHAT_HISTORY_SYNC")
        failed, failed_task = await stack.enter_async_context(connected_socket(
            guest, room_manager, connections, coordinator,
        ))
        for socket in (observer, failed):
            await socket.event("PLAYER_JOINED")
            await socket.event("GAME_STATE_SYNC")
        await failed.event("CHAT_HISTORY_SYNC")
        before = await room_manager.get_room(host.room_code)
        failed.fail_on = failure_event
        failed.disconnect_exception = disconnect_exception

        if trigger == "ready":
            observer.command({
                "type": "PLAYER_READY", "version": 1,
                "ready": True, "requestId": "ready-before-failure",
            })
            ready = await observer.event("PLAYER_READY")
            sync = await observer.event("GAME_STATE_SYNC")
            assert ready["stateVersion"] == sync["stateVersion"]
            assert sync["stateVersion"] == before.state_version + 1
        elif trigger == "command-error":
            failed.command({
                "type": "START_GAME", "version": 1, "requestId": "not-host",
            })
        elif trigger == "invalid-json":
            failed.text("{")
        else:
            failed.text("{" + "x" * 20_000)

        left = await observer.event("PLAYER_LEFT")
        sync = await observer.event("GAME_STATE_SYNC")
        assert failed.failed
        payload = cast(dict[str, object], left["payload"])
        assert payload["playerId"] == guest.player_id
        player = snapshot_player(sync, guest.player_id)
        assert player["isConnected"] is False
        assert player["isReady"] is False
        assert player["reservationExpiresAt"] is not None
        expected_version = before.state_version + (2 if trigger == "ready" else 1)
        assert left["stateVersion"] == sync["stateVersion"] == expected_version
        state = await room_manager.get_room(host.room_code)
        assert state.state_version == sync["stateVersion"]
        authoritative_player = next(
            player for player in state.players if player.id == guest.player_id
        )
        assert not authoritative_player.is_connected
        assert authoritative_player.reservation_expires_at is not None
        assert connections.connected_player_ids(host.room_code) == {host.player_id}

        # A late receive-side disconnect must not repeat the domain mutation.
        failed.incoming.put_nowait({"type": "websocket.disconnect", "code": 1006})
        await asyncio.wait_for(failed_task, timeout=1)
        after_teardown = await room_manager.get_room(host.room_code)
        assert after_teardown.state_version == state.state_version
        assert observer.outgoing.empty()

        replacement, _ = await stack.enter_async_context(connected_socket(
            guest, room_manager, connections, coordinator,
        ))
        await replacement.event("PLAYER_RECONNECTED")
        restored = snapshot_player(
            await replacement.event("GAME_STATE_SYNC"), guest.player_id,
        )
        await replacement.event("CHAT_HISTORY_SYNC")
        assert restored["isConnected"] is True
        assert restored["seatIndex"] == player["seatIndex"]
        assert restored["reservationExpiresAt"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("failure_event", ["PLAYER_JOINED", "GAME_STATE_SYNC"])
async def test_failed_initial_presence_send_disconnects_before_receive_loop(
    room_manager: RoomManager,
    failure_event: str,
) -> None:
    connections = ConnectionManager()
    coordinator = RoomPublicationCoordinator()
    host = await room_manager.create_room("Host", 4, "green")
    async with connected_socket(
        host, room_manager, connections, coordinator,
    ) as (observer, _):
        await observer.event("PLAYER_JOINED")
        await observer.event("GAME_STATE_SYNC")
        await observer.event("CHAT_HISTORY_SYNC")
        guest = await room_manager.join_room(host.room_code, "Guest", "red")
        async with connected_socket(
            guest, room_manager, connections, coordinator, fail_on=failure_event,
        ) as (failed, task):
            await observer.event("PLAYER_JOINED")
            joined = await observer.event("GAME_STATE_SYNC")
            left = await observer.event("PLAYER_LEFT")
            sync = await observer.event("GAME_STATE_SYNC")
            await asyncio.wait_for(task, timeout=1)
            assert failed.failed
            assert left["stateVersion"] == sync["stateVersion"]
            assert sync["stateVersion"] == cast(int, joined["stateVersion"]) + 1
            assert snapshot_player(sync, guest.player_id)["isConnected"] is False
            assert connections.connected_player_ids(host.room_code) == {host.player_id}


@pytest.mark.asyncio
async def test_failed_replacement_sync_disconnects_once_despite_both_teardowns(
    room_manager: RoomManager,
) -> None:
    connections = ConnectionManager()
    coordinator = RoomPublicationCoordinator()
    host = await room_manager.create_room("Host", 4, "green")
    guest = await room_manager.join_room(host.room_code, "Guest", "red")
    async with AsyncExitStack() as stack:
        observer, _ = await stack.enter_async_context(connected_socket(
            host, room_manager, connections, coordinator,
        ))
        await observer.event("PLAYER_JOINED")
        await observer.event("GAME_STATE_SYNC")
        await observer.event("CHAT_HISTORY_SYNC")
        old, old_task = await stack.enter_async_context(connected_socket(
            guest, room_manager, connections, coordinator,
        ))
        for socket in (observer, old):
            await socket.event("PLAYER_JOINED")
            await socket.event("GAME_STATE_SYNC")
        await old.event("CHAT_HISTORY_SYNC")
        before = await room_manager.get_room(host.room_code)
        failed, failed_task = await stack.enter_async_context(connected_socket(
            guest, room_manager, connections, coordinator,
            fail_on="GAME_STATE_SYNC",
        ))
        await observer.event("PLAYER_LEFT")
        sync = await observer.event("GAME_STATE_SYNC")
        assert old.close_code == 4000
        assert failed.failed
        assert sync["stateVersion"] == before.state_version + 1
        assert snapshot_player(sync, guest.player_id)["isConnected"] is False
        old.incoming.put_nowait({"type": "websocket.disconnect", "code": 1000})
        await asyncio.wait_for(asyncio.gather(old_task, failed_task), timeout=1)
        after_teardown = await room_manager.get_room(host.room_code)
        assert after_teardown.state_version == sync["stateVersion"]
        assert observer.outgoing.empty()


@pytest.mark.asyncio
async def test_websocket_logs_connection_reconnect_and_close_code(
    room_manager: RoomManager,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO, logger="app.api.websocket")
    connections = ConnectionManager()
    coordinator = RoomPublicationCoordinator()
    host = await room_manager.create_room("Host", 4, "green")

    async with connected_socket(host, room_manager, connections, coordinator) as (socket, _):
        await socket.event("PLAYER_JOINED")
        await socket.event("GAME_STATE_SYNC")
        await socket.event("CHAT_HISTORY_SYNC")
    async with connected_socket(host, room_manager, connections, coordinator) as (socket, _):
        await socket.event("PLAYER_RECONNECTED")
        await socket.event("GAME_STATE_SYNC")
        await socket.event("CHAT_HISTORY_SYNC")

    assert "realtime_ws_connected" in caplog.text
    assert "reconnect=false" in caplog.text
    assert "reconnect=true" in caplog.text
    assert "realtime_ws_disconnected" in caplog.text
    assert "close_code=1000" in caplog.text
    assert "realtime_ws_closed" in caplog.text
    assert "room_connections=1" in caplog.text
    assert "managed_connections=1" in caplog.text
    assert "managed_connections=0" in caplog.text
    assert "room=AB7K2" not in caplog.text
    assert host.player_id not in caplog.text
    assert host.player_token not in caplog.text


@pytest.mark.asyncio
async def test_websocket_logs_correlatable_command_lifecycle_without_private_contents(
    room_manager: RoomManager,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.INFO)
    connections = ConnectionManager()
    coordinator = RoomPublicationCoordinator()
    host = (await create_ready_room(room_manager, 4))[0]
    await room_manager.start_game(
        SessionIdentity(host.room_code, host.player_id),
        "diagnostics-start",
    )

    async with connected_socket(host, room_manager, connections, coordinator) as (socket, _):
        await socket.event("PLAYER_JOINED")
        await socket.event("GAME_STATE_SYNC")
        await socket.event("CHAT_HISTORY_SYNC")
        request_id = "90f1e3d8-4817-4a2b-9b29-017d3f64f5a2"
        socket.command({
            "type": "CHAT_MESSAGE",
            "version": 1,
            "requestId": request_id,
            "text": "private chat contents must not be logged",
        })
        await socket.event("CHAT_MESSAGE")

    assert "realtime_ws_command_received" in caplog.text
    assert "realtime_ws_command_processed" in caplog.text
    assert "realtime_ws_broadcast_completed" in caplog.text
    assert "command=CHAT_MESSAGE" in caplog.text
    assert "outcome=accepted" in caplog.text
    assert request_id in caplog.text
    assert "private chat contents must not be logged" not in caplog.text
    assert "AB7K2" not in caplog.text
    assert host.player_token not in caplog.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("trigger", "cascade_event"),
    [
        ("error", "PLAYER_LEFT"),
        ("error", "GAME_STATE_SYNC"),
        ("disconnect", "PLAYER_LEFT"),
        ("disconnect", "GAME_STATE_SYNC"),
        ("ready", "PLAYER_READY"),
    ],
)
async def test_cleanup_drains_multiple_failures_in_version_order(
    room_manager: RoomManager,
    trigger: str,
    cascade_event: str,
) -> None:
    connections = ConnectionManager()
    coordinator = RoomPublicationCoordinator()
    host = await room_manager.create_room("Host", 4, "green")
    first = await room_manager.join_room(host.room_code, "First", "red")
    second = await room_manager.join_room(host.room_code, "Second", "blue")
    async with AsyncExitStack() as stack:
        sockets: list[SocketHarness] = []
        tasks: list[asyncio.Task[None]] = []
        for credentials in (host, first, second):
            socket, task = await stack.enter_async_context(connected_socket(
                credentials, room_manager, connections, coordinator,
            ))
            sockets.append(socket)
            tasks.append(task)
            for recipient in sockets:
                await recipient.event("PLAYER_JOINED")
                await recipient.event("GAME_STATE_SYNC")
            await socket.event("CHAT_HISTORY_SYNC")
        observer, failed_first, failed_second = sockets
        before = await room_manager.get_room(host.room_code)
        failed_first.fail_on = "PLAYER_READY" if trigger == "ready" else "ERROR"
        failed_first.fail_close = True
        failed_second.fail_on = cascade_event
        if trigger == "disconnect":
            failed_first.incoming.put_nowait({
                "type": "websocket.disconnect", "code": 1000,
            })
        elif trigger == "error":
            failed_first.text("{")
        else:
            observer.command({
                "type": "PLAYER_READY", "version": 1,
                "ready": True, "requestId": "multiple-failures",
            })
            await observer.event("PLAYER_READY")
            await observer.event("GAME_STATE_SYNC")

        version = before.state_version + (1 if trigger == "ready" else 0)
        for credentials in (first, second):
            left = await observer.event("PLAYER_LEFT")
            sync = await observer.event("GAME_STATE_SYNC")
            version += 1
            payload = cast(dict[str, object], left["payload"])
            assert payload["playerId"] == credentials.player_id
            assert left["stateVersion"] == sync["stateVersion"] == version
            player = snapshot_player(sync, credentials.player_id)
            assert player["isConnected"] is False
            assert player["reservationExpiresAt"] is not None
        assert connections.connected_player_ids(host.room_code) == {host.player_id}
        for socket in (failed_first, failed_second):
            socket.incoming.put_nowait({"type": "websocket.disconnect", "code": 1006})
        await asyncio.wait_for(asyncio.gather(*tasks[1:]), timeout=1)
        assert (await room_manager.get_room(host.room_code)).state_version == version
        assert observer.outgoing.empty()
