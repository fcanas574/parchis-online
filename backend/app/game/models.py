from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal


PlayerColor = Literal["green", "red", "blue", "yellow", "purple", "orange"]


@dataclass(slots=True)
class PlayerState:
    id: str
    display_name: str
    color: PlayerColor
    seat_index: int
    is_host: bool
    token_hash: str = field(repr=False)
    is_ready: bool = False
    is_connected: bool = False
    has_connected: bool = False
    reservation_expires_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class SessionIdentity:
    room_code: str
    player_id: str


@dataclass(frozen=True, slots=True)
class RoomChange:
    state: "RoomState"
    event_type: str
    payload: dict[str, object]
    request_id: str | None = None


@dataclass(slots=True)
class RoomState:
    room_code: str
    max_players: Literal[4, 5, 6]
    host_player_id: str
    players: list[PlayerState]
    status: Literal["lobby", "playing", "finished"] = "lobby"
    state_version: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    processed_changes: OrderedDict[tuple[str, str], RoomChange] = field(
        default_factory=OrderedDict,
        repr=False,
    )


@dataclass(frozen=True, slots=True)
class RoomCredentialData:
    room_code: str
    player_id: str
    player_token: str
    is_host: bool
    ws_path: str


@dataclass(frozen=True, slots=True)
class AuthenticatedSession:
    identity: SessionIdentity
    is_reconnect: bool
