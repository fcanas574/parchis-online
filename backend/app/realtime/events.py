from datetime import UTC, datetime
from uuid import uuid4


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
