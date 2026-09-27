from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal


PlayerColor = Literal["green", "red", "blue", "yellow", "purple", "orange"]
SeatCount = Literal[4, 5, 6]
PieceLocation = Literal["yard", "track", "finish_path", "finished"]
TurnPhase = Literal["waiting_for_roll", "waiting_for_move", "waiting_for_bonus", "finished"]
GameStatus = Literal["playing", "finished"]
BonusReason = Literal["capture", "goal"]


@dataclass(frozen=True, slots=True)
class PiecePosition:
    state: PieceLocation
    track_position: int | None
    finish_progress: int | None


@dataclass(slots=True)
class PieceState:
    id: str
    player_id: str
    state: PieceLocation
    track_position: int | None
    finish_progress: int | None
    track_arrival_order: int | None = None


@dataclass(frozen=True, slots=True)
class MoveOption:
    piece_id: str
    dice_indices: tuple[int, ...]
    steps: int
    destination: PiecePosition
    capture_piece_id: str | None = None
    completes_piece: bool = False
    captures: bool = False
    lands_safe: bool = False
    leaves_home: bool = False
    progress: int = 0
    completes_split_plan: bool = False


@dataclass(frozen=True, slots=True)
class PendingBonus:
    player_id: str
    steps: int
    reason: BonusReason


@dataclass(frozen=True, slots=True)
class GameParticipant:
    id: str
    seat_index: int


@dataclass(slots=True)
class GameState:
    room_code: str
    seat_count: SeatCount
    player_order: list[str]
    status: GameStatus
    current_player_id: str | None
    turn_phase: TurnPhase
    dice_values: tuple[int, int] | None
    used_dice_indices: list[int]
    available_moves: list[MoveOption]
    pending_bonuses: list[PendingBonus]
    pieces: list[PieceState]
    finish_order: list[str]
    winner_id: str | None
    result: "GameResult | None"
    requires_split_plan: bool = False


@dataclass(frozen=True, slots=True)
class PlayerPlacement:
    player_id: str
    rank: int


@dataclass(frozen=True, slots=True)
class GameResult:
    winner_id: str
    placements: list[PlayerPlacement]


@dataclass(frozen=True, slots=True)
class DomainEvent:
    type: str
    payload: dict[str, object]


@dataclass(frozen=True, slots=True)
class GameTransition:
    state: GameState
    events: tuple[DomainEvent, ...]


@dataclass(slots=True)
class PlayerState:
    id: str
    display_name: str
    color: PlayerColor
    seat_index: int
    is_host: bool
    token_hash: str = field(repr=False)
    is_bot: bool = False
    is_ready: bool = False
    is_connected: bool = False
    has_connected: bool = False
    reservation_expires_at: datetime | None = None
    reservation_expired: bool = False


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
    additional_events: tuple[DomainEvent, ...] = ()


@dataclass(slots=True)
class RoomState:
    room_code: str
    max_players: Literal[4, 5, 6]
    host_player_id: str
    players: list[PlayerState]
    mode: Literal["friends", "practice"] = "friends"
    status: Literal["lobby", "playing", "finished"] = "lobby"
    state_version: int = 0
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    game_state: GameState | None = None
    last_game_result: GameResult | None = None
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
