from datetime import UTC, datetime
from uuid import uuid4

from app.game.models import RoomChange


def make_event(
    type: str,
    room_code: str,
    state_version: int,
    payload: dict[str, object],
    request_id: str | None = None,
) -> dict[str, object]:
    event: dict[str, object] = {
        "type": type,
        "version": 1,
        "roomCode": room_code,
        "eventId": str(uuid4()),
        "serverTime": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "stateVersion": state_version,
        "payload": payload,
    }
    if request_id is not None:
        event["requestId"] = request_id
    return event


def make_error_event(
    room_code: str,
    state_version: int,
    code: str,
    message: str,
    request_id: str | None = None,
) -> dict[str, object]:
    return make_event(
        "ERROR",
        room_code,
        state_version,
        {"code": code, "message": message},
        request_id,
    )


def make_change_events(
    change: RoomChange,
    public_room: dict[str, object],
) -> tuple[dict[str, object], ...]:
    """Serialize one authoritative transition as semantic events then a snapshot."""
    game_state = public_room.get("gameState")
    semantic_events = [(change.event_type, change.payload)]
    semantic_events.extend(
        (event.type, event.payload) for event in change.additional_events
    )

    events: list[dict[str, object]] = []
    for event_type, payload in semantic_events:
        public_payload = payload
        if event_type == "DICE_ROLLED":
            if not isinstance(game_state, dict):
                raise RuntimeError("DICE_ROLLED requires an active public game.")
            values = payload.get("values")
            moves = game_state.get("availableMoves")
            if not isinstance(values, (tuple, list)) or not isinstance(moves, list):
                raise RuntimeError("DICE_ROLLED has an invalid domain payload.")
            public_payload = {
                **payload,
                "values": list(values),
                "availableMoves": moves,
            }
        events.append(
            make_event(
                event_type,
                change.state.room_code,
                change.state.state_version,
                public_payload,
                change.request_id,
            )
        )

    events.append(
        make_event(
            "GAME_STATE_SYNC",
            change.state.room_code,
            change.state.state_version,
            {"room": public_room, "game": game_state},
            change.request_id,
        )
    )
    return tuple(events)
