import asyncio
import json
import threading
import time
from contextlib import ExitStack
from itertools import chain, count, product

import anyio
import pytest
from pydantic import TypeAdapter
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.api.rooms import get_room_manager, get_room_rate_limiter
from app.api.websocket import get_connection_manager
from app.game.rules import GameRules
from app.main import app
from app.realtime.connection_manager import ClientConnection, ConnectionManager
from app.realtime.events import make_event
from app.repositories.memory_room_repository import MemoryRoomRepository
from app.security.rate_limit import FixedWindowRateLimiter
from app.schemas.websocket import ServerEvent
from app.services.room_manager import RoomManager
from game_support import SequenceDice


@pytest.mark.asyncio
async def test_practice_snapshot_validates_strict_wire_schema(room_manager):
    credentials = await room_manager.create_practice_room("Felipe", 5, "purple")
    public_room = await room_manager.public_room(credentials.room_code)
    event = make_event(
        "GAME_STATE_SYNC",
        credentials.room_code,
        public_room["stateVersion"],
        {"room": public_room, "game": public_room["gameState"]},
    )

    parsed = TypeAdapter(ServerEvent).validate_python(event)

    assert parsed.payload.room.mode == "practice"
    assert [player.is_bot for player in parsed.payload.room.players] == [False, True, True, True, True]


_PRIVATE_CREDENTIAL_KEYS = {"playerToken", "tokenHash", "token_hash"}


def assert_no_private_credentials(value: object) -> None:
    assert "token-" not in json.dumps(value)
    if isinstance(value, dict):
        assert _PRIVATE_CREDENTIAL_KEYS.isdisjoint(value)
        for nested in value.values():
            assert_no_private_credentials(nested)
    elif isinstance(value, list):
        for nested in value:
            assert_no_private_credentials(nested)


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
        assert_no_private_credentials(event)
        if event["type"] == event_type:
            return event
    pytest.fail(f"Did not receive {event_type} within 20 messages")


def receive_until_request(websocket, event_type: str, request_id: str) -> dict:
    for _ in range(20):
        event = websocket.receive_json()
        assert_no_private_credentials(event)
        if event["type"] == event_type and event.get("requestId") == request_id:
            return event
    pytest.fail(
        f"Did not receive {event_type} for {request_id} within 20 messages"
    )


def receive_until_with_timeout(websocket, event_type: str, seconds: float = 2.0) -> dict:
    async def receive_event() -> dict:
        with anyio.fail_after(seconds):
            for _ in range(30):
                message = await websocket._send_rx.receive()
                if message["type"] != "websocket.send":
                    continue
                event = json.loads(message["text"])
                assert_no_private_credentials(event)
                if event["type"] == event_type:
                    return event
        raise AssertionError(f"Did not receive {event_type} within 30 messages")

    return websocket.portal.call(receive_event)


def receive_complete_snapshot(
    websocket, player_count: int, state_version: int | None = None
) -> dict:
    for _ in range(40):
        event = websocket.receive_json()
        assert_no_private_credentials(event)
        if (
            event["type"] == "GAME_STATE_SYNC"
            and len(event["payload"]["room"]["players"]) == player_count
            and (state_version is None or event["stateVersion"] == state_version)
        ):
            return event
    pytest.fail(f"Did not receive a {player_count}-player snapshot")


def assert_room_snapshots_equal(events: list[dict]) -> None:
    rooms = [event["payload"]["room"] for event in events]
    assert all(room == rooms[0] for room in rooms[1:])


def receive_close_code(websocket, timeout: float = 1.0) -> int:
    async def receive_message() -> dict:
        with anyio.fail_after(timeout):
            return await websocket._send_rx.receive()

    for _ in range(20):
        message = websocket.portal.call(receive_message)
        if message["type"] == "websocket.close":
            return message.get("code", 1000)
    pytest.fail("Did not receive a WebSocket close within 20 messages")


class TrackingConnectionManager(ConnectionManager):
    def __init__(self) -> None:
        super().__init__()
        self.remove_attempted = threading.Event()
        self.last_remove_result: bool | None = None

    async def remove(
        self,
        room_code: str,
        player_id: str,
        connection: ClientConnection | None = None,
    ) -> bool:
        if connection is None:
            result = await super().remove(room_code, player_id)
        else:
            result = await super().remove(room_code, player_id, connection)
        self.last_remove_result = result
        self.remove_attempted.set()
        return result


class DelayingConnectionManager(ConnectionManager):
    def __init__(self) -> None:
        super().__init__()
        self.first_started = threading.Event()
        self.second_started = threading.Event()
        self.release_first = threading.Event()

    async def broadcast(
        self,
        room_code: str,
        event: dict[str, object],
        exclude_player_id: str | None = None,
    ) -> list[ClientConnection]:
        request_id = event.get("requestId")
        if request_id == "ready-first":
            self.first_started.set()
            released = await asyncio.to_thread(self.release_first.wait, 2.0)
            if not released:
                raise TimeoutError("Timed out waiting to release first publication")
        elif request_id == "ready-second":
            self.second_started.set()
        return await super().broadcast(room_code, event, exclude_player_id)


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
        game_rules=GameRules(dice=SequenceDice([(5, 2)] * 40)),
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
    assert room["mode"] == "friends"
    assert room["players"] == [
        {
            "id": host["playerId"],
            "displayName": "Host",
            "color": "green",
            "seatIndex": 0,
            "isHost": True,
            "isBot": False,
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


def test_four_player_room_full_flow_is_authoritative_for_every_socket(client):
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

        expected_version = client.get(f"/api/rooms/{host['roomCode']}").json()[
            "stateVersion"
        ]
        snapshots = [
            receive_complete_snapshot(websocket, 4, expected_version)
            for websocket in sockets
        ]
        assert len({event["stateVersion"] for event in snapshots}) == 1
        assert_room_snapshots_equal(snapshots)
        latest_version = snapshots[0]["stateVersion"]
        for event in snapshots:
            room = event["payload"]["room"]
            assert room["status"] == "lobby"
            assert room["maxPlayers"] == 4
            assert [player["seatIndex"] for player in room["players"]] == [0, 1, 2, 3]

        sockets[1].send_json(
            {"type": "START_GAME", "version": 1, "requestId": "guest-start"}
        )
        non_host_error = receive_until_request(sockets[1], "ERROR", "guest-start")
        assert non_host_error["payload"]["code"] == "NOT_HOST"
        assert client.get(f"/api/rooms/{host['roomCode']}").json()[
            "stateVersion"
        ] == latest_version

        sockets[0].send_json(
            {"type": "START_GAME", "version": 1, "requestId": "start-unready"}
        )
        unready_error = receive_until_request(
            sockets[0], "ERROR", "start-unready"
        )
        assert unready_error["payload"]["code"] == "PLAYER_NOT_READY"
        assert client.get(f"/api/rooms/{host['roomCode']}").json()[
            "stateVersion"
        ] == latest_version

        ready_player_ids: set[str] = set()
        for number, websocket in enumerate(sockets):
            request_id = f"ready-{number}"
            ready_player_ids.add(credentials[number]["playerId"])
            websocket.send_json(
                {
                    "type": "PLAYER_READY",
                    "version": 1,
                    "ready": True,
                    "requestId": request_id,
                }
            )
            ready_events = [
                receive_until_request(recipient, "PLAYER_READY", request_id)
                for recipient in sockets
            ]
            sync_events = [
                receive_until(recipient, "GAME_STATE_SYNC")
                for recipient in sockets
            ]
            batch_versions = {
                event["stateVersion"] for event in [*ready_events, *sync_events]
            }
            assert batch_versions == {latest_version + 1}
            assert_room_snapshots_equal(sync_events)
            latest_version += 1
            assert all(
                {
                    player["id"]
                    for player in sync["payload"]["room"]["players"]
                    if player["isReady"]
                }
                == ready_player_ids
                for sync in sync_events
            )

        sockets[0].send_json(
            {"type": "START_GAME", "version": 1, "requestId": "start-full"}
        )

        started_events = [receive_until(websocket, "GAME_STARTED") for websocket in sockets]
        sync_events = [
            receive_until(websocket, "GAME_STATE_SYNC") for websocket in sockets
        ]
        assert {
            event["stateVersion"] for event in [*started_events, *sync_events]
        } == {latest_version + 1}
        assert_room_snapshots_equal(sync_events)
        for started, sync in zip(started_events, sync_events, strict=True):
            assert started["payload"] == {"status": "playing"}
            assert sync["payload"]["room"]["status"] == "playing"
            assert all(
                player["isReady"] for player in sync["payload"]["room"]["players"]
            )


def test_gameplay_events_and_full_snapshots_match_for_every_socket(client):
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

        initial_version = client.get(f"/api/rooms/{host['roomCode']}").json()[
            "stateVersion"
        ]
        initial_snapshots = [
            receive_complete_snapshot(websocket, 4, initial_version)
            for websocket in sockets
        ]
        assert_room_snapshots_equal(initial_snapshots)

        for index, websocket in enumerate(sockets):
            request_id = f"game-ready-{index}"
            websocket.send_json(
                {
                    "type": "PLAYER_READY",
                    "version": 1,
                    "ready": True,
                    "requestId": request_id,
                }
            )
            for recipient in sockets:
                receive_until_request(recipient, "PLAYER_READY", request_id)
            for recipient in sockets:
                receive_until(recipient, "GAME_STATE_SYNC")

        sockets[0].send_json(
            {"type": "START_GAME", "version": 1, "requestId": "game-start"}
        )
        for websocket in sockets:
            receive_until_request(websocket, "GAME_STARTED", "game-start")
        start_snapshots = [
            receive_until(websocket, "GAME_STATE_SYNC") for websocket in sockets
        ]
        assert_room_snapshots_equal(start_snapshots)
        assert all(
            snapshot["payload"]["game"]
            == snapshot["payload"]["room"]["gameState"]
            for snapshot in start_snapshots
        )

        sockets[0].send_json(
            {"type": "ROLL_DICE", "version": 1, "requestId": "game-roll"}
        )
        roll_events = [
            receive_until_request(websocket, "DICE_ROLLED", "game-roll")
            for websocket in sockets
        ]
        roll_snapshots = [
            receive_until(websocket, "GAME_STATE_SYNC") for websocket in sockets
        ]
        assert {event["stateVersion"] for event in roll_events + roll_snapshots} == {
            roll_events[0]["stateVersion"]
        }
        assert all(event["payload"] == roll_events[0]["payload"] for event in roll_events)
        assert all(
            snapshot["payload"]["game"]
            == snapshot["payload"]["room"]["gameState"]
            for snapshot in roll_snapshots
        )
        assert_room_snapshots_equal(roll_snapshots)
        event_adapter = TypeAdapter(ServerEvent)
        event_adapter.validate_python(roll_events[0])
        event_adapter.validate_python(roll_snapshots[0])
        move = next(
            option
            for option in roll_events[0]["payload"]["availableMoves"]
            if option["leavesHome"]
        )

        sockets[0].send_json(
            {
                "type": "MOVE_PIECE",
                "version": 1,
                "requestId": "game-move",
                "pieceId": move["pieceId"],
                "diceIndices": move["diceIndices"],
            }
        )
        move_events = [
            receive_until_request(websocket, "PIECE_MOVED", "game-move")
            for websocket in sockets
        ]
        move_snapshots = [
            receive_until(websocket, "GAME_STATE_SYNC") for websocket in sockets
        ]
        assert {event["stateVersion"] for event in move_events + move_snapshots} == {
            move_events[0]["stateVersion"]
        }
        assert all(event["payload"] == move_events[0]["payload"] for event in move_events)
        move_payload = move_events[0]["payload"]
        assert move_payload["from"]["state"] == "yard"
        assert move_payload["path"] == [move_payload["to"]]
        assert move_events[0]["stateVersion"] == move_snapshots[0]["stateVersion"]
        assert_room_snapshots_equal(move_snapshots)
        event_adapter.validate_python(move_events[0])
        event_adapter.validate_python(move_snapshots[0])


def test_disconnected_current_player_takes_automatic_turn(client):
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
        version = client.get(f"/api/rooms/{host['roomCode']}").json()["stateVersion"]
        for websocket in sockets:
            receive_complete_snapshot(websocket, 4, version)

        for index, websocket in enumerate(sockets):
            request_id = f"autopilot-ready-{index}"
            websocket.send_json(
                {
                    "type": "PLAYER_READY",
                    "version": 1,
                    "ready": True,
                    "requestId": request_id,
                }
            )
            for recipient in sockets:
                receive_until_request(recipient, "PLAYER_READY", request_id)
            for recipient in sockets:
                receive_until(recipient, "GAME_STATE_SYNC")

        sockets[0].send_json(
            {"type": "START_GAME", "version": 1, "requestId": "autopilot-start"}
        )
        for websocket in sockets:
            receive_until_request(websocket, "GAME_STARTED", "autopilot-start")
        for websocket in sockets:
            receive_until(websocket, "GAME_STATE_SYNC")

        sockets[0].close()
        observer = sockets[1]
        left = receive_until(observer, "PLAYER_LEFT")
        disconnected_sync = receive_until(observer, "GAME_STATE_SYNC")
        automatic_roll = receive_until(observer, "DICE_ROLLED")
        roll_sync = receive_until(observer, "GAME_STATE_SYNC")
        automatic_move = receive_until(observer, "PIECE_MOVED")
        move_sync = receive_until(observer, "GAME_STATE_SYNC")

    assert left["payload"]["playerId"] == host["playerId"]
    assert automatic_roll["payload"]["playerId"] == host["playerId"]
    assert automatic_move["payload"]["pieceId"] == f"{host['playerId']}-piece-1"
    assert automatic_roll["stateVersion"] == roll_sync["stateVersion"]
    assert automatic_move["stateVersion"] == move_sync["stateVersion"]
    assert disconnected_sync["payload"]["room"]["status"] == "playing"
    assert roll_sync["payload"]["game"] == roll_sync["payload"]["room"]["gameState"]
    assert move_sync["payload"]["game"] == move_sync["payload"]["room"]["gameState"]


def test_reconnecting_host_resumes_one_bot_turn_with_ordered_events(client):
    response = client.post(
        "/api/practice",
        json={"displayName": "Felipe", "playerCount": 4, "color": "green"},
    )
    assert response.status_code == 201
    host = response.json()
    manager = app.dependency_overrides[get_room_manager]()
    room = client.portal.call(manager.get_room, host["roomCode"])
    assert room.game_state is not None
    bot_id = room.players[1].id
    room.game_state.current_player_id = bot_id
    room.players[0].has_connected = True
    room.players[0].is_connected = False
    client.portal.call(manager._repository.save, room)

    with client.websocket_connect(host["wsPath"]) as websocket:
        websocket.send_json(reconnect_message(host["roomCode"], host["playerToken"]))
        reconnected = receive_until(websocket, "PLAYER_RECONNECTED")
        synced = receive_until(websocket, "GAME_STATE_SYNC")
        time.sleep(0.1)  # The worker should be waiting outside the publication lock.
        websocket.send_json({"type": "ROLL_DICE", "version": 1, "requestId": "human-wrong-turn"})
        wrong_turn = receive_until_with_timeout(websocket, "ERROR", seconds=0.3)
        before_bot_roll = time.monotonic()
        rolled = receive_until_with_timeout(websocket, "DICE_ROLLED")
        bot_roll_delay = time.monotonic() - before_bot_roll
        roll_sync = receive_until_with_timeout(websocket, "GAME_STATE_SYNC")
        moved = receive_until_with_timeout(websocket, "PIECE_MOVED")
        move_sync = receive_until_with_timeout(websocket, "GAME_STATE_SYNC")

    assert reconnected["payload"]["player"]["id"] == host["playerId"]
    assert synced["payload"]["room"]["mode"] == "practice"
    assert wrong_turn["requestId"] == "human-wrong-turn"
    assert wrong_turn["payload"]["code"] == "INVALID_GAME_ACTION"
    assert bot_roll_delay >= 0.25
    assert rolled["payload"]["playerId"] == bot_id
    assert rolled["stateVersion"] == roll_sync["stateVersion"]
    assert moved["stateVersion"] == move_sync["stateVersion"]
    assert rolled["stateVersion"] < moved["stateVersion"]
    assert moved["payload"]["pieceId"].startswith(f"{bot_id}-")


@pytest.mark.parametrize("player_count", [5, 6])
def test_five_and_six_player_rooms_fill_unique_seats_and_reject_overflow(
    client, player_count
):
    colors = ("green", "red", "blue", "yellow", "purple", "orange")
    created = client.post(
        "/api/rooms",
        json={
            "displayName": "Host",
            "playerCount": player_count,
            "color": colors[0],
        },
    )
    assert created.status_code == 201
    host = created.json()

    for seat_index in range(1, player_count):
        joined = client.post(
            f"/api/rooms/{host['roomCode']}/join",
            json={
                "displayName": f"Guest {seat_index}",
                "color": colors[seat_index],
            },
        )
        assert joined.status_code == 201

    room_response = client.get(f"/api/rooms/{host['roomCode']}")
    assert room_response.status_code == 200
    room = room_response.json()
    assert room["maxPlayers"] == player_count
    assert [player["seatIndex"] for player in room["players"]] == list(
        range(player_count)
    )
    assert len({player["color"] for player in room["players"]}) == player_count

    overflow = client.post(
        f"/api/rooms/{host['roomCode']}/join",
        json={"displayName": "One too many", "color": "green"},
    )
    assert overflow.status_code == 409
    assert overflow.json()["code"] == "ROOM_FULL"


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


def test_reconnect_before_reservation_expiry_restores_the_same_seat_and_color(
    client, clock
):
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
            receive_until(guest_socket, "GAME_STATE_SYNC")
            receive_until(host_socket, "GAME_STATE_SYNC")
            guest_socket.close()

        receive_until(host_socket, "PLAYER_LEFT")
        disconnected = receive_until(host_socket, "GAME_STATE_SYNC")
        reserved = next(
            player
            for player in disconnected["payload"]["room"]["players"]
            if player["id"] == guest["playerId"]
        )
        assert reserved["reservationExpiresAt"] is not None

        clock.advance(seconds=599)
        with client.websocket_connect(guest["wsPath"]) as returned_socket:
            returned_socket.send_json(
                reconnect_message(guest["roomCode"], guest["playerToken"])
            )
            reconnected = receive_until(returned_socket, "PLAYER_RECONNECTED")
            snapshot = receive_until(returned_socket, "GAME_STATE_SYNC")

    restored = next(
        player
        for player in snapshot["payload"]["room"]["players"]
        if player["id"] == guest["playerId"]
    )
    assert reconnected["payload"]["player"]["id"] == guest["playerId"]
    assert restored["id"] == guest["playerId"]
    assert restored["seatIndex"] == 1
    assert restored["color"] == "red"
    assert restored["isConnected"] is True
    assert restored["reservationExpiresAt"] is None


def test_expired_reservation_rejects_the_original_player_token(client, clock):
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
            receive_until(guest_socket, "GAME_STATE_SYNC")
            receive_until(host_socket, "GAME_STATE_SYNC")
            guest_socket.close()

        receive_until(host_socket, "PLAYER_LEFT")
        receive_until(host_socket, "GAME_STATE_SYNC")
        clock.advance(seconds=601)

        with client.websocket_connect(guest["wsPath"]) as expired_socket:
            expired_socket.send_json(
                reconnect_message(guest["roomCode"], guest["playerToken"])
            )
            error = receive_until(expired_socket, "ERROR")
            with pytest.raises(WebSocketDisconnect) as closed:
                expired_socket.receive_json()

    assert error["payload"]["code"] == "UNAUTHENTICATED"
    assert closed.value.code == 1008


def test_overlapping_reconnect_replaces_old_without_disconnecting_new(client):
    connection_manager = TrackingConnectionManager()
    app.dependency_overrides[get_connection_manager] = lambda: connection_manager
    host = create_room(client)

    with client.websocket_connect(host["wsPath"]) as old_socket:
        old_socket.send_json(
            reconnect_message(host["roomCode"], host["playerToken"])
        )
        receive_until(old_socket, "GAME_STATE_SYNC")

        with client.websocket_connect(host["wsPath"]) as new_socket:
            new_socket.send_json(
                reconnect_message(host["roomCode"], host["playerToken"])
            )
            receive_until(new_socket, "GAME_STATE_SYNC")

            assert receive_close_code(old_socket) == 4000
            old_socket.close()
            assert connection_manager.remove_attempted.wait(timeout=2.0)
            assert connection_manager.last_remove_result is False

            new_socket.send_json(
                {
                    "type": "PLAYER_READY",
                    "version": 1,
                    "ready": True,
                    "requestId": "replacement-ready",
                }
            )
            receive_until_request(
                new_socket,
                "PLAYER_READY",
                "replacement-ready",
            )
            sync = receive_until(new_socket, "GAME_STATE_SYNC")

    current_player = sync["payload"]["room"]["players"][0]
    assert current_player["id"] == host["playerId"]
    assert current_player["isConnected"] is True
    assert current_player["isReady"] is True


def test_concurrent_mutations_publish_versions_in_commit_order(client):
    connection_manager = DelayingConnectionManager()
    app.dependency_overrides[get_connection_manager] = lambda: connection_manager
    host = create_room(client)
    guest = join_room(client, host["roomCode"], 1)
    observer = join_room(client, host["roomCode"], 2)

    with client.websocket_connect(host["wsPath"]) as first_socket:
        first_socket.send_json(
            reconnect_message(host["roomCode"], host["playerToken"])
        )
        receive_until(first_socket, "GAME_STATE_SYNC")
        with client.websocket_connect(guest["wsPath"]) as second_socket:
            second_socket.send_json(
                reconnect_message(guest["roomCode"], guest["playerToken"])
            )
            receive_until(first_socket, "GAME_STATE_SYNC")
            receive_until(second_socket, "GAME_STATE_SYNC")
            with client.websocket_connect(observer["wsPath"]) as observer_socket:
                observer_socket.send_json(
                    reconnect_message(
                        observer["roomCode"], observer["playerToken"]
                    )
                )
                receive_until(first_socket, "GAME_STATE_SYNC")
                receive_until(second_socket, "GAME_STATE_SYNC")
                receive_until(observer_socket, "GAME_STATE_SYNC")

                first_socket.send_json(
                    {
                        "type": "PLAYER_READY",
                        "version": 1,
                        "ready": True,
                        "requestId": "ready-first",
                    }
                )
                assert connection_manager.first_started.wait(timeout=2.0)

                def release_when_second_can_publish() -> None:
                    connection_manager.second_started.wait(timeout=0.5)
                    connection_manager.release_first.set()

                releaser = threading.Thread(
                    target=release_when_second_can_publish,
                    daemon=True,
                )
                releaser.start()
                try:
                    second_socket.send_json(
                        {
                            "type": "PLAYER_READY",
                            "version": 1,
                            "ready": True,
                            "requestId": "ready-second",
                        }
                    )
                    events = [observer_socket.receive_json() for _ in range(4)]
                finally:
                    connection_manager.release_first.set()
                    releaser.join(timeout=2.0)

    assert [event["type"] for event in events] == [
        "PLAYER_READY",
        "GAME_STATE_SYNC",
        "PLAYER_READY",
        "GAME_STATE_SYNC",
    ]
    versions = [event["stateVersion"] for event in events]
    assert versions == sorted(versions)
    assert versions[0] == versions[1]
    assert versions[2] == versions[3] == versions[0] + 1


def test_not_yet_supported_command_returns_error_without_mutating_state(client):
    host = create_room(client)

    with client.websocket_connect(host["wsPath"]) as websocket:
        websocket.send_json(reconnect_message(host["roomCode"], host["playerToken"]))
        sync = receive_until(websocket, "GAME_STATE_SYNC")
        state_version = sync["stateVersion"]

        websocket.send_json(
            {"type": "CHAT_MESSAGE", "version": 1, "requestId": "future-command"}
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
