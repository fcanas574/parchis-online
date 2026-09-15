from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

PlayerColor = Literal["green", "red", "blue", "yellow", "purple", "orange"]
PlayerCount = Literal[4, 5, 6]


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class CreateRoomRequest(WireModel):
    display_name: str = Field(alias="displayName", min_length=2, max_length=20)
    player_count: PlayerCount = Field(alias="playerCount")
    color: PlayerColor | None = None


class JoinRoomRequest(WireModel):
    display_name: str = Field(alias="displayName", min_length=2, max_length=20)
    color: PlayerColor | None = None


class RoomCredentials(WireModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
        from_attributes=True,
    )

    room_code: str = Field(alias="roomCode")
    player_id: str = Field(alias="playerId")
    player_token: str = Field(alias="playerToken")
    is_host: bool = Field(alias="isHost")
    ws_path: str = Field(alias="wsPath")
