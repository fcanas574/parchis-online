from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from .rooms import PlayerColor


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class ReconnectCommand(WireModel):
    type: Literal["RECONNECT"]
    version: Literal[1] = 1
    room_code: str = Field(alias="roomCode", pattern=r"^[A-Z2-9]{5}$")
    player_token: str = Field(alias="playerToken", min_length=32, max_length=256)


class PlayerReadyCommand(WireModel):
    type: Literal["PLAYER_READY"]
    version: Literal[1] = 1
    ready: StrictBool
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)


class StartGameCommand(WireModel):
    type: Literal["START_GAME"]
    version: Literal[1] = 1
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)


ClientMessage = Annotated[ReconnectCommand | PlayerReadyCommand | StartGameCommand, Field(discriminator="type")]


class PublicPlayer(WireModel):
    id: str
    display_name: str = Field(alias="displayName")
    color: PlayerColor
    seat_index: int = Field(alias="seatIndex")
    is_host: bool = Field(alias="isHost")
    is_ready: bool = Field(alias="isReady")
    is_connected: bool = Field(alias="isConnected")
    reservation_expires_at: datetime | None = Field(alias="reservationExpiresAt")


class PublicRoomState(WireModel):
    room_code: str = Field(alias="roomCode")
    status: Literal["lobby", "playing", "finished"]
    max_players: Literal[4, 5, 6] = Field(alias="maxPlayers")
    host_player_id: str = Field(alias="hostPlayerId")
    players: list[PublicPlayer]
    state_version: int = Field(alias="stateVersion")


class PlayerJoinedPayload(WireModel):
    player: PublicPlayer


class PlayerLeftPayload(WireModel):
    player_id: str = Field(alias="playerId")
    reservation_expires_at: datetime = Field(alias="reservationExpiresAt")


class PlayerReconnectedPayload(WireModel):
    player: PublicPlayer


class PlayerReadyPayload(WireModel):
    player_id: str = Field(alias="playerId")
    ready: bool


class GameStartedPayload(WireModel):
    status: Literal["playing"]


class GameStateSyncPayload(WireModel):
    room: PublicRoomState


class ErrorPayload(WireModel):
    code: str
    message: str


class ServerEventEnvelope(WireModel):
    version: Literal[1] = 1
    room_code: str = Field(alias="roomCode")
    state_version: int = Field(alias="stateVersion")
    event_id: str = Field(alias="eventId")
    server_time: datetime = Field(alias="serverTime")
    request_id: str | None = Field(default=None, alias="requestId")


class PlayerJoinedEvent(ServerEventEnvelope):
    type: Literal["PLAYER_JOINED"] = "PLAYER_JOINED"
    payload: PlayerJoinedPayload


class PlayerLeftEvent(ServerEventEnvelope):
    type: Literal["PLAYER_LEFT"] = "PLAYER_LEFT"
    payload: PlayerLeftPayload


class PlayerReconnectedEvent(ServerEventEnvelope):
    type: Literal["PLAYER_RECONNECTED"] = "PLAYER_RECONNECTED"
    payload: PlayerReconnectedPayload


class PlayerReadyEvent(ServerEventEnvelope):
    type: Literal["PLAYER_READY"] = "PLAYER_READY"
    payload: PlayerReadyPayload


class GameStartedEvent(ServerEventEnvelope):
    type: Literal["GAME_STARTED"] = "GAME_STARTED"
    payload: GameStartedPayload


class ErrorEvent(ServerEventEnvelope):
    type: Literal["ERROR"] = "ERROR"
    payload: ErrorPayload


class GameStateSyncEvent(ServerEventEnvelope):
    type: Literal["GAME_STATE_SYNC"] = "GAME_STATE_SYNC"
    payload: GameStateSyncPayload


ServerEvent = Annotated[
    PlayerJoinedEvent | PlayerLeftEvent | PlayerReconnectedEvent | PlayerReadyEvent | GameStartedEvent | GameStateSyncEvent | ErrorEvent,
    Field(discriminator="type"),
]
