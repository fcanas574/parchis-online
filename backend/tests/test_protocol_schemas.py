import json
from pathlib import Path

import pytest
from jsonschema import ValidationError, validate
from pydantic import TypeAdapter, ValidationError as PydanticValidationError

from app.schemas.websocket import ClientMessage

CONTRACTS = Path(__file__).parents[2] / "contracts" / "v1"


def load_schema(name: str) -> dict:
    return json.loads((CONTRACTS / name).read_text())


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
    validate(
        {
            "type": "GAME_STATE_SYNC",
            "version": 1,
            "roomCode": "AB7K2",
            "stateVersion": 3,
            "eventId": "evt-1",
            "serverTime": "2026-09-14T18:30:00Z",
            "payload": {"room": {}},
        },
        load_schema("server-events.schema.json"),
    )


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
                "payload": {"room": {"playerToken": "private"}},
            },
            load_schema("server-events.schema.json"),
        )
