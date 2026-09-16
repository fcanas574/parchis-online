from contextlib import ExitStack
from itertools import chain, count, product

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.rooms import get_room_manager, get_room_rate_limiter
from app.main import app
from app.repositories.memory_room_repository import MemoryRoomRepository
from app.security.rate_limit import FixedWindowRateLimiter
from app.services.room_manager import RoomManager


def reconnect_message(room_code: str, token: str) -> dict:
    return {
        "type": "RECONNECT",
        "version": 1,
        "roomCode": room_code,
        "playerToken": token,
    }


def receive_until(websocket, event_type: str) -> dict:
    for _ in range(20):
        event = websocket.receive_json()
        if event["type"] == event_type:
            return event
    pytest.fail(f"Did not receive {event_type} within 20 messages")


def receive_until_request(websocket, event_type: str, request_id: str) -> dict:
    for _ in range(20):
        event = websocket.receive_json()
        if event["type"] == event_type and event.get("requestId") == request_id:
            return event
    pytest.fail(
        f"Did not receive {event_type} for {request_id} within 20 messages"
    )


@pytest.fixture
def client(clock):
    generated_codes = chain(
        ("AB7K2",),
        (f"CD3{first}{second}" for first, second in product("ABCDEFGH", repeat=2)),
    )
    generated_tokens = (f"token-{token_id:032d}" for token_id in count(1))
    manager = RoomManager(
        repository=MemoryRoomRepository(),
        code_generator=lambda: next(generated_codes),
        token_generator=lambda: next(generated_tokens),
        clock=clock,
    )
    limiter = FixedWindowRateLimiter(limit=20, window_seconds=60, clock=clock)
    app.dependency_overrides[get_room_manager] = lambda: manager
    app.dependency_overrides[get_room_rate_limiter] = lambda: limiter

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def create_room(client: TestClient) -> dict:
    response = client.post(
        "/api/rooms",
        json={"displayName": "Host", "playerCount": 4, "color": "green"},
    )
    assert response.status_code == 201
    return response.json()


def join_room(client: TestClient, room_code: str, number: int) -> dict:
    colors = ("red", "blue", "yellow")
    response = client.post(
        f"/api/rooms/{room_code}/join",
        json={"displayName": f"Guest {number}", "color": colors[number - 1]},
    )
    assert response.status_code == 201
    return response.json()


def test_handshake_sends_authoritative_snapshot_with_host(client):
    host = create_room(client)

    with client.websocket_connect(host["wsPath"]) as websocket:
        websocket.send_json(reconnect_message(host["roomCode"], host["playerToken"]))

        sync = receive_until(websocket, "GAME_STATE_SYNC")

    room = sync["payload"]["room"]
    assert room["hostPlayerId"] == host["playerId"]
    assert room["players"] == [
        {
            "id": host["playerId"],
            "displayName": "Host",
            "color": "green",
            "seatIndex": 0,
            "isHost": True,
            "isReady": False,
            "isConnected": True,
            "reservationExpiresAt": None,
        }
    ]
    assert "playerToken" not in str(sync)
    assert "tokenHash" not in str(sync)


def test_join_handshake_broadcasts_player_joined_then_two_player_snapshot(client):
    host = create_room(client)

    with client.websocket_connect(host["wsPath"]) as host_socket:
        host_socket.send_json(
            reconnect_message(host["roomCode"], host["playerToken"])
        )
        receive_until(host_socket, "GAME_STATE_SYNC")
        guest = join_room(client, host["roomCode"], 1)

        with client.websocket_connect(guest["wsPath"]) as guest_socket:
            guest_socket.send_json(
                reconnect_message(guest["roomCode"], guest["playerToken"])
            )

            joined = receive_until(host_socket, "PLAYER_JOINED")
            sync = receive_until(host_socket, "GAME_STATE_SYNC")

            assert joined["payload"]["player"]["id"] == guest["playerId"]
            assert len(sync["payload"]["room"]["players"]) == 2
            receive_until(guest_socket, "GAME_STATE_SYNC")


def test_player_ready_broadcasts_semantic_event_and_fresh_snapshot(client):
    host = create_room(client)

    with client.websocket_connect(host["wsPath"]) as host_socket:
        host_socket.send_json(
            reconnect_message(host["roomCode"], host["playerToken"])
        )
        receive_until(host_socket, "GAME_STATE_SYNC")
        guest = join_room(client, host["roomCode"], 1)

        with client.websocket_connect(guest["wsPath"]) as guest_socket:
            guest_socket.send_json(
                reconnect_message(guest["roomCode"], guest["playerToken"])
            )
            receive_until(host_socket, "GAME_STATE_SYNC")
            receive_until(guest_socket, "GAME_STATE_SYNC")

            guest_socket.send_json(
                {
                    "type": "PLAYER_READY",
                    "version": 1,
                    "ready": True,
                    "requestId": "ready-guest",
                }
            )

            for websocket in (host_socket, guest_socket):
                ready = receive_until(websocket, "PLAYER_READY")
                sync = receive_until(websocket, "GAME_STATE_SYNC")
                guest_state = next(
                    player
                    for player in sync["payload"]["room"]["players"]
                    if player["id"] == guest["playerId"]
                )
                assert ready["payload"] == {
                    "playerId": guest["playerId"],
                    "ready": True,
                }
                assert ready["requestId"] == "ready-guest"
                assert guest_state["isReady"] is True


def test_invalid_token_closes_without_exposing_room_state(client):
    host = create_room(client)

    with client.websocket_connect(host["wsPath"]) as websocket:
        websocket.send_json(reconnect_message(host["roomCode"], "x" * 32))

        error = websocket.receive_json()
        assert error["type"] == "ERROR"
        assert error["payload"]["code"] == "UNAUTHENTICATED"
        assert "room" not in error["payload"]
        with pytest.raises(WebSocketDisconnect) as closed:
            websocket.receive_json()

    assert closed.value.code == 1008


def test_start_game_errors_do_not_mutate_lobby(client):
    host = create_room(client)
    guest = join_room(client, host["roomCode"], 1)

    with client.websocket_connect(host["wsPath"]) as host_socket:
        host_socket.send_json(
            reconnect_message(host["roomCode"], host["playerToken"])
        )
        receive_until(host_socket, "GAME_STATE_SYNC")
        with client.websocket_connect(guest["wsPath"]) as guest_socket:
            guest_socket.send_json(
                reconnect_message(guest["roomCode"], guest["playerToken"])
            )
            receive_until(host_socket, "GAME_STATE_SYNC")
            receive_until(guest_socket, "GAME_STATE_SYNC")

            guest_socket.send_json(
                {"type": "START_GAME", "version": 1, "requestId": "guest-start"}
            )
            non_host_error = receive_until(guest_socket, "ERROR")

            host_socket.send_json(
                {"type": "START_GAME", "version": 1, "requestId": "host-start"}
            )
            insufficient_error = receive_until(host_socket, "ERROR")

    assert non_host_error["payload"]["code"] == "NOT_HOST"
    assert non_host_error["requestId"] == "guest-start"
    assert insufficient_error["payload"]["code"] == "INSUFFICIENT_PLAYERS"
    assert insufficient_error["requestId"] == "host-start"
    assert client.get(f"/api/rooms/{host['roomCode']}").json()["status"] == "lobby"


def test_full_ready_room_can_start_as_host(client):
    host = create_room(client)
    guests = [join_room(client, host["roomCode"], number) for number in range(1, 4)]
    credentials = [host, *guests]

    with ExitStack() as stack:
        sockets = [
            stack.enter_context(client.websocket_connect(player["wsPath"]))
            for player in credentials
        ]
        for websocket, player in zip(sockets, credentials, strict=True):
            websocket.send_json(
                reconnect_message(player["roomCode"], player["playerToken"])
            )
            receive_until(websocket, "GAME_STATE_SYNC")

        sockets[0].send_json(
            {"type": "START_GAME", "version": 1, "requestId": "start-unready"}
        )
        unready_error = receive_until_request(
            sockets[0], "ERROR", "start-unready"
        )
        assert unready_error["payload"]["code"] == "PLAYER_NOT_READY"

        for number, websocket in enumerate(sockets):
            request_id = f"ready-{number}"
            websocket.send_json(
                {
                    "type": "PLAYER_READY",
                    "version": 1,
                    "ready": True,
                    "requestId": request_id,
                }
            )
            receive_until_request(websocket, "PLAYER_READY", request_id)

        sockets[0].send_json(
            {"type": "START_GAME", "version": 1, "requestId": "start-full"}
        )

        for websocket in sockets:
            started = receive_until(websocket, "GAME_STARTED")
            sync = receive_until(websocket, "GAME_STATE_SYNC")
            assert started["payload"] == {"status": "playing"}
            assert sync["payload"]["room"]["status"] == "playing"
            assert all(
                player["isReady"] for player in sync["payload"]["room"]["players"]
            )


def test_reconnect_preserves_player_identity_and_seat(client):
    host = create_room(client)
    guest = join_room(client, host["roomCode"], 1)
    observer = join_room(client, host["roomCode"], 2)

    with client.websocket_connect(host["wsPath"]) as host_socket:
        host_socket.send_json(
            reconnect_message(host["roomCode"], host["playerToken"])
        )
        receive_until(host_socket, "GAME_STATE_SYNC")

        with client.websocket_connect(observer["wsPath"]) as observer_socket:
            observer_socket.send_json(
                reconnect_message(
                    observer["roomCode"], observer["playerToken"]
                )
            )
            receive_until(host_socket, "GAME_STATE_SYNC")
            receive_until(observer_socket, "GAME_STATE_SYNC")

            with client.websocket_connect(guest["wsPath"]) as first_guest_socket:
                first_guest_socket.send_json(
                    reconnect_message(guest["roomCode"], guest["playerToken"])
                )
                receive_until(host_socket, "GAME_STATE_SYNC")
                receive_until(observer_socket, "GAME_STATE_SYNC")
                first_sync = receive_until(first_guest_socket, "GAME_STATE_SYNC")

                # Starlette's WebSocketTestSession.__exit__ sends disconnect and
                # immediately cancels the ASGI task. Closing explicitly while the
                # context stays open lets the server finish both disconnect events.
                first_guest_socket.close()
                for remaining_socket in (host_socket, observer_socket):
                    left = receive_until(remaining_socket, "PLAYER_LEFT")
                    disconnected_sync = receive_until(
                        remaining_socket, "GAME_STATE_SYNC"
                    )
                    disconnected_guest = next(
                        player
                        for player in disconnected_sync["payload"]["room"][
                            "players"
                        ]
                        if player["id"] == guest["playerId"]
                    )
                    assert left["payload"]["playerId"] == guest["playerId"]
                    assert disconnected_guest["isConnected"] is False
                    assert disconnected_guest["reservationExpiresAt"] is not None

            first_player = next(
                player
                for player in first_sync["payload"]["room"]["players"]
                if player["id"] == guest["playerId"]
            )

            with client.websocket_connect(guest["wsPath"]) as second_guest_socket:
                second_guest_socket.send_json(
                    reconnect_message(guest["roomCode"], guest["playerToken"])
                )
                reconnected = receive_until(
                    second_guest_socket, "PLAYER_RECONNECTED"
                )
                second_sync = receive_until(
                    second_guest_socket, "GAME_STATE_SYNC"
                )

    second_player = next(
        player
        for player in second_sync["payload"]["room"]["players"]
        if player["id"] == guest["playerId"]
    )
    assert reconnected["payload"]["player"]["id"] == guest["playerId"]
    assert second_player["id"] == first_player["id"] == guest["playerId"]
    assert second_player["seatIndex"] == first_player["seatIndex"] == 1


def test_unsupported_command_returns_error_without_mutating_state(client):
    host = create_room(client)

    with client.websocket_connect(host["wsPath"]) as websocket:
        websocket.send_json(reconnect_message(host["roomCode"], host["playerToken"]))
        sync = receive_until(websocket, "GAME_STATE_SYNC")
        state_version = sync["stateVersion"]

        websocket.send_json(
            {"type": "ROLL_DICE", "version": 1, "requestId": "future-command"}
        )
        error = receive_until(websocket, "ERROR")

        room = client.get(f"/api/rooms/{host['roomCode']}").json()

    assert error["payload"]["code"] == "INVALID_MESSAGE"
    assert error["requestId"] == "future-command"
    assert room["stateVersion"] == state_version


def test_repeated_request_id_rebroadcasts_cached_change_without_new_version(client):
    host = create_room(client)

    with client.websocket_connect(host["wsPath"]) as websocket:
        websocket.send_json(reconnect_message(host["roomCode"], host["playerToken"]))
        receive_until(websocket, "GAME_STATE_SYNC")
        command = {
            "type": "PLAYER_READY",
            "version": 1,
            "ready": True,
            "requestId": "ready-once",
        }

        websocket.send_json(command)
        first_change = receive_until_request(websocket, "PLAYER_READY", "ready-once")
        first_sync = receive_until(websocket, "GAME_STATE_SYNC")
        websocket.send_json(command)
        repeated_change = receive_until_request(websocket, "PLAYER_READY", "ready-once")
        repeated_sync = receive_until(websocket, "GAME_STATE_SYNC")

    assert repeated_change["stateVersion"] == first_change["stateVersion"]
    assert repeated_sync["stateVersion"] == first_sync["stateVersion"]


def test_oversized_message_is_rejected_before_json_parsing(client):
    host = create_room(client)

    with client.websocket_connect(host["wsPath"]) as websocket:
        websocket.send_json(reconnect_message(host["roomCode"], host["playerToken"]))
        sync = receive_until(websocket, "GAME_STATE_SYNC")

        websocket.send_text("{" + "x" * 20_000)
        error = receive_until(websocket, "ERROR")

    assert error["payload"]["code"] == "INVALID_MESSAGE"
    assert error["stateVersion"] == sync["stateVersion"]
