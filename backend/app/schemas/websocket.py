from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    field_validator,
)

from .rooms import PlayerColor


DieValue = Annotated[StrictInt, Field(ge=1, le=6)]
DiceIndex = Annotated[StrictInt, Field(ge=0, le=1)]


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ReconnectCommand(WireModel):
    type: Literal["RECONNECT"]
    version: Literal[1]
    room_code: str = Field(alias="roomCode", pattern=r"^[A-Z2-9]{5}$")
    player_token: str = Field(alias="playerToken", min_length=32, max_length=256)


class PlayerReadyCommand(WireModel):
    type: Literal["PLAYER_READY"]
    version: Literal[1]
    ready: StrictBool
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)


class StartGameCommand(WireModel):
    type: Literal["START_GAME"]
    version: Literal[1]
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)


class RollDiceCommand(WireModel):
    type: Literal["ROLL_DICE"]
    version: Literal[1]
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)


class MovePieceCommand(WireModel):
    type: Literal["MOVE_PIECE"]
    version: Literal[1]
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)
    piece_id: str = Field(alias="pieceId", min_length=1, max_length=64)
    dice_indices: list[DiceIndex] = Field(
        alias="diceIndices",
        min_length=1,
        max_length=2,
    )

    @field_validator("dice_indices")
    @classmethod
    def dice_indices_must_be_unique(cls, values: list[int]) -> list[int]:
        if len(set(values)) != len(values):
            raise ValueError("dice indices must be unique")
        return values


class MoveBonusPieceCommand(WireModel):
    type: Literal["MOVE_BONUS_PIECE"]
    version: Literal[1]
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)
    piece_id: str = Field(alias="pieceId", min_length=1, max_length=64)


class ReturnToLobbyCommand(WireModel):
    type: Literal["RETURN_TO_LOBBY"]
    version: Literal[1]
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)


class PlayAgainCommand(WireModel):
    type: Literal["PLAY_AGAIN"]
    version: Literal[1]
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)


ClientMessage = Annotated[
    ReconnectCommand
    | PlayerReadyCommand
    | StartGameCommand
    | RollDiceCommand
    | MovePieceCommand
    | MoveBonusPieceCommand
    | ReturnToLobbyCommand
    | PlayAgainCommand,
    Field(discriminator="type"),
]


class PublicPlayer(WireModel):
    id: str
    display_name: str = Field(alias="displayName")
    color: PlayerColor
    seat_index: StrictInt = Field(alias="seatIndex", ge=0, le=5)
    is_host: StrictBool = Field(alias="isHost")
    is_bot: StrictBool = Field(alias="isBot")
    is_ready: StrictBool = Field(alias="isReady")
    is_connected: StrictBool = Field(alias="isConnected")
    reservation_expires_at: datetime | None = Field(alias="reservationExpiresAt")


class PublicPiecePosition(WireModel):
    state: Literal["yard", "track", "finish_path", "finished"]
    track_position: StrictInt | None = Field(alias="trackPosition", ge=0)
    finish_progress: StrictInt | None = Field(alias="finishProgress", ge=0)


class PublicPiece(WireModel):
    id: str
    player_id: str = Field(alias="playerId")
    state: Literal["yard", "track", "finish_path", "finished"]
    track_position: StrictInt | None = Field(alias="trackPosition", ge=0)
    finish_progress: StrictInt | None = Field(alias="finishProgress", ge=0)


class PublicMoveOption(WireModel):
    piece_id: str = Field(alias="pieceId")
    dice_indices: list[DiceIndex] = Field(alias="diceIndices", max_length=2)
    steps: StrictInt = Field(gt=0)
    destination: PublicPiecePosition
    capture_piece_id: str | None = Field(alias="capturePieceId")
    completes_piece: StrictBool = Field(alias="completesPiece")
    captures: StrictBool
    lands_safe: StrictBool = Field(alias="landsSafe")
    leaves_home: StrictBool = Field(alias="leavesHome")
    progress: StrictInt = Field(ge=0)
    completes_split_plan: StrictBool = Field(alias="completesSplitPlan")


class PublicPendingBonus(WireModel):
    player_id: str = Field(alias="playerId")
    steps: StrictInt = Field(gt=0)
    reason: Literal["capture", "goal"]


class PublicPlacement(WireModel):
    player_id: str = Field(alias="playerId")
    rank: StrictInt = Field(ge=1, le=6)


class PublicGameResult(WireModel):
    winner_id: str = Field(alias="winnerId")
    placements: list[PublicPlacement] = Field(min_length=4, max_length=6)


class PublicGameState(WireModel):
    room_code: str = Field(alias="roomCode", pattern=r"^[A-Z2-9]{5}$")
    seat_count: Literal[4, 5, 6] = Field(alias="seatCount")
    status: Literal["playing", "finished"]
    player_order: list[str] = Field(alias="playerOrder", min_length=4, max_length=6)
    current_player_id: str | None = Field(alias="currentPlayerId")
    turn_phase: Literal[
        "waiting_for_roll",
        "waiting_for_move",
        "waiting_for_bonus",
        "finished",
    ] = Field(alias="turnPhase")
    dice_values: Annotated[list[DieValue], Field(min_length=2, max_length=2)] | None = Field(
        alias="diceValues"
    )
    used_dice_indices: list[DiceIndex] = Field(alias="usedDiceIndices", max_length=2)
    available_moves: list[PublicMoveOption] = Field(alias="availableMoves")
    pending_bonuses: list[PublicPendingBonus] = Field(alias="pendingBonuses")
    pieces: list[PublicPiece]
    finish_order: list[str] = Field(alias="finishOrder", max_length=6)
    winner_id: str | None = Field(alias="winnerId")
    result: PublicGameResult | None
    requires_split_plan: StrictBool = Field(alias="requiresSplitPlan")


class PublicRoomState(WireModel):
    room_code: str = Field(alias="roomCode", pattern=r"^[A-Z2-9]{5}$")
    mode: Literal["friends", "practice"]
    status: Literal["lobby", "playing", "finished"]
    max_players: Literal[4, 5, 6] = Field(alias="maxPlayers")
    host_player_id: str = Field(alias="hostPlayerId")
    players: list[PublicPlayer] = Field(max_length=6)
    state_version: StrictInt = Field(alias="stateVersion", ge=0)
    game_state: PublicGameState | None = Field(alias="gameState")
    last_game_result: PublicGameResult | None = Field(alias="lastGameResult")


class PlayerJoinedPayload(WireModel):
    player: PublicPlayer


class PlayerLeftPayload(WireModel):
    player_id: str = Field(alias="playerId")
    reservation_expires_at: datetime = Field(alias="reservationExpiresAt")


class PlayerReconnectedPayload(WireModel):
    player: PublicPlayer


class PlayerReadyPayload(WireModel):
    player_id: str = Field(alias="playerId")
    ready: StrictBool


class GameStartedPayload(WireModel):
    status: Literal["playing"]


class TurnStartedPayload(WireModel):
    player_id: str = Field(alias="playerId")


class DiceRolledPayload(WireModel):
    player_id: str = Field(alias="playerId")
    values: Annotated[list[DieValue], Field(min_length=2, max_length=2)]
    available_moves: list[PublicMoveOption] = Field(alias="availableMoves")


class PieceMovedPayload(WireModel):
    piece_id: str = Field(alias="pieceId")
    from_position: PublicPiecePosition = Field(alias="from")
    to_position: PublicPiecePosition = Field(alias="to")
    dice_indices: list[DiceIndex] = Field(alias="diceIndices", max_length=2)
    path: list[PublicPiecePosition] = Field(min_length=1)


class PieceCapturedPayload(WireModel):
    captured_piece_id: str = Field(alias="capturedPieceId")
    by_piece_id: str = Field(alias="byPieceId")
    bonus_steps: StrictInt = Field(alias="bonusSteps", ge=0)


class BonusGrantedPayload(WireModel):
    player_id: str = Field(alias="playerId")
    steps: StrictInt = Field(gt=0)
    reason: Literal["capture", "goal"]


class BonusSkippedPayload(WireModel):
    player_id: str = Field(alias="playerId")
    steps: StrictInt = Field(gt=0)
    reason: Literal["capture", "goal"]
    skip_reason: Literal["no_legal_moves", "player_not_active"] = Field(
        alias="skipReason"
    )


class TurnEndedPayload(WireModel):
    player_id: str = Field(alias="playerId")
    extra_turn: StrictBool = Field(alias="extraTurn")


class PlayerFinishedPayload(WireModel):
    player_id: str = Field(alias="playerId")
    rank: StrictInt = Field(ge=1, le=6)


class GameFinishedPayload(WireModel):
    winner_id: str = Field(alias="winnerId")
    finish_order: list[str] = Field(alias="finishOrder", min_length=3, max_length=5)
    placements: list[PublicPlacement] = Field(min_length=4, max_length=6)


class GameStateSyncPayload(WireModel):
    room: PublicRoomState
    game: PublicGameState | None


class GameResetPayload(WireModel):
    status: Literal["lobby"]
    requested_replay: StrictBool = Field(alias="requestedReplay")
    requester_id: str = Field(alias="requesterId", min_length=1)


class ErrorPayload(WireModel):
    code: str
    message: str


class ServerEventEnvelope(WireModel):
    version: Literal[1]
    room_code: str = Field(alias="roomCode", pattern=r"^[A-Z2-9]{5}$")
    state_version: StrictInt = Field(alias="stateVersion", ge=0)
    event_id: str = Field(alias="eventId", min_length=1)
    server_time: datetime = Field(alias="serverTime")
    request_id: str | None = Field(default=None, alias="requestId", min_length=1, max_length=64)


class PlayerJoinedEvent(ServerEventEnvelope):
    type: Literal["PLAYER_JOINED"]
    payload: PlayerJoinedPayload


class PlayerLeftEvent(ServerEventEnvelope):
    type: Literal["PLAYER_LEFT"]
    payload: PlayerLeftPayload


class PlayerReconnectedEvent(ServerEventEnvelope):
    type: Literal["PLAYER_RECONNECTED"]
    payload: PlayerReconnectedPayload


class PlayerReadyEvent(ServerEventEnvelope):
    type: Literal["PLAYER_READY"]
    payload: PlayerReadyPayload


class GameStartedEvent(ServerEventEnvelope):
    type: Literal["GAME_STARTED"]
    payload: GameStartedPayload


class TurnStartedEvent(ServerEventEnvelope):
    type: Literal["TURN_STARTED"]
    payload: TurnStartedPayload


class DiceRolledEvent(ServerEventEnvelope):
    type: Literal["DICE_ROLLED"]
    payload: DiceRolledPayload


class PieceMovedEvent(ServerEventEnvelope):
    type: Literal["PIECE_MOVED"]
    payload: PieceMovedPayload


class PieceCapturedEvent(ServerEventEnvelope):
    type: Literal["PIECE_CAPTURED"]
    payload: PieceCapturedPayload


class BonusGrantedEvent(ServerEventEnvelope):
    type: Literal["BONUS_GRANTED"]
    payload: BonusGrantedPayload


class BonusSkippedEvent(ServerEventEnvelope):
    type: Literal["BONUS_SKIPPED"]
    payload: BonusSkippedPayload


class TurnEndedEvent(ServerEventEnvelope):
    type: Literal["TURN_ENDED"]
    payload: TurnEndedPayload


class PlayerFinishedEvent(ServerEventEnvelope):
    type: Literal["PLAYER_FINISHED"]
    payload: PlayerFinishedPayload


class GameFinishedEvent(ServerEventEnvelope):
    type: Literal["GAME_FINISHED"]
    payload: GameFinishedPayload


class GameStateSyncEvent(ServerEventEnvelope):
    type: Literal["GAME_STATE_SYNC"]
    payload: GameStateSyncPayload


class GameResetEvent(ServerEventEnvelope):
    type: Literal["GAME_RESET"]
    payload: GameResetPayload


class ErrorEvent(ServerEventEnvelope):
    type: Literal["ERROR"]
    payload: ErrorPayload


ServerEvent = Annotated[
    PlayerJoinedEvent
    | PlayerLeftEvent
    | PlayerReconnectedEvent
    | PlayerReadyEvent
    | GameStartedEvent
    | TurnStartedEvent
    | DiceRolledEvent
    | PieceMovedEvent
    | PieceCapturedEvent
    | BonusGrantedEvent
    | BonusSkippedEvent
    | TurnEndedEvent
    | PlayerFinishedEvent
    | GameFinishedEvent
    | GameStateSyncEvent
    | GameResetEvent
    | ErrorEvent,
    Field(discriminator="type"),
]
