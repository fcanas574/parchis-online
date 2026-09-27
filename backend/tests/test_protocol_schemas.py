import json
from copy import deepcopy
from pathlib import Path

import pytest
from jsonschema import ValidationError, validate
from pydantic import TypeAdapter, ValidationError as PydanticValidationError

from app.realtime.events import make_event
from app.schemas.websocket import ClientMessage, ServerEvent
from game_support import make_game_state

CONTRACTS = Path(__file__).parents[2] / "contracts" / "v1"


def load_schema(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text())


def minimal_public_room() -> dict:
    return {
        "roomCode": "AB7K2",
        "mode": "friends",
        "status": "lobby",
        "maxPlayers": 4,
        "hostPlayerId": "p1",
        "players": [],
        "stateVersion": 0,
        "gameState": None,
        "lastGameResult": None,
    }


def test_reconnect_command_matches_v1_schema():
    validate(
        {
            "type": "RECONNECT",
            "version": 1,
            "roomCode": "AB7K2",
            "playerToken": "t" * 32,
        },
        load_schema("protocol.schema.json"),
    )


def test_ready_command_requires_boolean_ready():
    with pytest.raises(ValidationError):
        validate(
            {
                "type": "PLAYER_READY",
                "version": 1,
                "ready": "yes",
                "requestId": "req-1",
            },
            load_schema("protocol.schema.json"),
        )


def test_server_sync_has_state_version():
    event = make_event(
        "GAME_STATE_SYNC",
        "AB7K2",
        3,
        {"room": minimal_public_room(), "game": None},
    )
    validate(event, load_schema("server-events.schema.json"))
    TypeAdapter(ServerEvent).validate_python(event)


def test_piece_moved_path_matches_strict_wire_schemas():
    position = {"state": "track", "trackPosition": 10, "finishProgress": None}
    destination = {"state": "track", "trackPosition": 12, "finishProgress": None}
    event = make_event(
        "PIECE_MOVED",
        "AB7K2",
        3,
        {
            "pieceId": "p1-piece-1",
            "from": position,
            "to": destination,
            "diceIndices": [0],
            "path": [
                {"state": "track", "trackPosition": 11, "finishProgress": None},
                destination,
            ],
        },
    )

    validate(event, load_schema("server-events.schema.json"))
    TypeAdapter(ServerEvent).validate_python(event)


@pytest.mark.parametrize("path", [None, []])
def test_piece_moved_rejects_a_missing_or_empty_path_in_both_schemas(path):
    payload = {
        "pieceId": "p1-piece-1",
        "from": {"state": "track", "trackPosition": 10, "finishProgress": None},
        "to": {"state": "track", "trackPosition": 11, "finishProgress": None},
        "diceIndices": [0],
    }
    if path is not None:
        payload["path"] = path
    event = make_event("PIECE_MOVED", "AB7K2", 3, payload)

    with pytest.raises(ValidationError):
        validate(event, load_schema("server-events.schema.json"))
    with pytest.raises(PydanticValidationError):
        TypeAdapter(ServerEvent).validate_python(event)


@pytest.mark.asyncio
async def test_practice_sync_matches_json_and_pydantic_contracts(room_manager):
    credentials = await room_manager.create_practice_room("Felipe", 4, "green")
    public_room = await room_manager.public_room(credentials.room_code)
    event = make_event(
        "GAME_STATE_SYNC",
        credentials.room_code,
        public_room["stateVersion"],
        {"room": public_room, "game": public_room["gameState"]},
    )

    validate(event, load_schema("server-events.schema.json"))
    parsed = TypeAdapter(ServerEvent).validate_python(event)
    assert parsed.payload.room.mode == "practice"
    assert sum(player.is_bot for player in parsed.payload.room.players) == 3


def test_pydantic_ready_command_rejects_string_boolean():
    with pytest.raises(PydanticValidationError):
        TypeAdapter(ClientMessage).validate_python(
            {
                "type": "PLAYER_READY",
                "version": 1,
                "ready": "yes",
                "requestId": "req-1",
            }
        )


def test_pydantic_commands_reject_unknown_authority_fields():
    with pytest.raises(PydanticValidationError):
        TypeAdapter(ClientMessage).validate_python(
            {
                "type": "PLAYER_READY",
                "version": 1,
                "ready": True,
                "requestId": "req-1",
                "playerId": "private-id",
            }
        )


def test_pydantic_reconnect_rejects_invalid_room_code():
    with pytest.raises(PydanticValidationError):
        TypeAdapter(ClientMessage).validate_python(
            {
                "type": "RECONNECT",
                "version": 1,
                "roomCode": "abc12",
                "playerToken": "t" * 32,
            }
        )


def test_client_commands_require_explicit_protocol_version():
    message = {"type": "ROLL_DICE", "requestId": "roll-1"}

    with pytest.raises(ValidationError):
        validate(message, load_schema("protocol.schema.json"))
    with pytest.raises(PydanticValidationError):
        TypeAdapter(ClientMessage).validate_python(message)


def test_server_events_require_explicit_protocol_version():
    event = make_event("TURN_STARTED", "AB7K2", 3, {"playerId": "p1"})
    event.pop("version")

    with pytest.raises(ValidationError):
        validate(event, load_schema("server-events.schema.json"))
    with pytest.raises(PydanticValidationError):
        TypeAdapter(ServerEvent).validate_python(event)


def test_server_sync_rejects_private_player_token_in_room():
    with pytest.raises(ValidationError):
        validate(
            {
            "type": "GAME_STATE_SYNC",
                "version": 1,
                "roomCode": "AB7K2",
                "stateVersion": 3,
                "eventId": "evt-1",
                "serverTime": "2026-09-14T18:30:00Z",
            "payload": {
                "room": {**minimal_public_room(), "playerToken": "private"},
                "game": None,
            },
        },
        load_schema("server-events.schema.json"),
    )


@pytest.mark.parametrize(
    "message",
    [
        {"type": "ROLL_DICE", "version": 1, "requestId": "roll-1"},
        {
            "type": "MOVE_PIECE",
            "version": 1,
            "requestId": "move-1",
            "pieceId": "p1-piece-1",
            "diceIndices": [0],
        },
        {
            "type": "MOVE_BONUS_PIECE",
            "version": 1,
            "requestId": "bonus-1",
            "pieceId": "p1-piece-1",
        },
        {"type": "RETURN_TO_LOBBY", "version": 1, "requestId": "lobby-1"},
        {"type": "PLAY_AGAIN", "version": 1, "requestId": "again-1"},
    ],
)
def test_gameplay_commands_validate_against_pydantic_and_json_schema(message):
    TypeAdapter(ClientMessage).validate_python(message)
    validate(message, load_schema("protocol.schema.json"))


@pytest.mark.parametrize("dice_indices", [[], [0, 0], [2], [0, 1, 0]])
def test_move_piece_schema_rejects_invalid_dice_indices(dice_indices):
    message = {
        "type": "MOVE_PIECE",
        "version": 1,
        "requestId": "move-bad",
        "pieceId": "p1-piece-1",
        "diceIndices": dice_indices,
    }
    with pytest.raises(ValidationError):
        validate(message, load_schema("protocol.schema.json"))
    with pytest.raises(PydanticValidationError):
        TypeAdapter(ClientMessage).validate_python(message)


def test_sync_schema_contains_public_game_and_result_without_credentials(
    room,
    room_manager,
):
    state = deepcopy(room)
    state.status = "playing"
    state.game_state = make_game_state()
    public_room = room_manager.public_room_from_state(state)
    snapshot = make_event(
        "GAME_STATE_SYNC",
        state.room_code,
        state.state_version,
        {"room": public_room, "game": public_room["gameState"]},
    )

    validate(snapshot, load_schema("server-events.schema.json"))
    TypeAdapter(ServerEvent).validate_python(snapshot)
    assert "playerToken" not in json.dumps(snapshot)
    assert "tokenHash" not in json.dumps(snapshot)
    assert "token_hash" not in json.dumps(snapshot)


@pytest.mark.parametrize(
    "event_type,payload",
    [
        ("TURN_STARTED", {"playerId": "p1"}),
        (
            "DICE_ROLLED",
            {"playerId": "p1", "values": [5, 2], "availableMoves": []},
        ),
        (
            "PIECE_MOVED",
            {
                "pieceId": "p1-piece-1",
                "from": {"state": "yard", "trackPosition": None, "finishProgress": None},
                "to": {"state": "track", "trackPosition": 0, "finishProgress": None},
                "diceIndices": [0],
                "path": [
                    {"state": "track", "trackPosition": 0, "finishProgress": None}
                ],
            },
        ),
        (
            "PIECE_CAPTURED",
            {"capturedPieceId": "p2-piece-1", "byPieceId": "p1-piece-1", "bonusSteps": 20},
        ),
        ("BONUS_GRANTED", {"playerId": "p1", "steps": 20, "reason": "capture"}),
        (
            "BONUS_SKIPPED",
            {
                "playerId": "p1",
                "steps": 10,
                "reason": "goal",
                "skipReason": "no_legal_moves",
            },
        ),
        ("TURN_ENDED", {"playerId": "p1", "extraTurn": False}),
        ("PLAYER_FINISHED", {"playerId": "p1", "rank": 1}),
        (
            "GAME_FINISHED",
            {
                "winnerId": "p1",
                "finishOrder": ["p1", "p2", "p3"],
                "placements": [
                    {"playerId": "p1", "rank": 1},
                    {"playerId": "p2", "rank": 2},
                    {"playerId": "p3", "rank": 3},
                    {"playerId": "p4", "rank": 4},
                ],
            },
        ),
        (
            "GAME_RESET",
            {"status": "lobby", "requestedReplay": True, "requesterId": "p1"},
        ),
        ("ERROR", {"code": "INVALID_GAME_ACTION", "message": "Not your turn."}),
    ],
)
def test_gameplay_server_event_payloads_validate_in_both_contracts(
    event_type,
    payload,
):
    event = make_event(event_type, "AB7K2", 12, payload, "request-1")

    validate(event, load_schema("server-events.schema.json"))
    TypeAdapter(ServerEvent).validate_python(event)
