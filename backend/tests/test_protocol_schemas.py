import json
from pathlib import Path

import pytest
from jsonschema import ValidationError, validate

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
