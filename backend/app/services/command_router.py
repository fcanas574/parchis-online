from dataclasses import dataclass

from pydantic import TypeAdapter, ValidationError

from app.game.models import RoomChange, SessionIdentity
from app.schemas.websocket import (
    ClientMessage,
    ChatMessageCommand,
    GiftSentCommand,
    MoveBonusPieceCommand,
    MovePieceCommand,
    PlayAgainCommand,
    PlayerReadyCommand,
    ReactionSentCommand,
    ReconnectCommand,
    ReturnToLobbyCommand,
    RollDiceCommand,
    SetCosmeticsCommand,
    StartGameCommand,
)
from app.services.room_manager import RoomError, RoomManager


_CLIENT_MESSAGE_ADAPTER = TypeAdapter(ClientMessage)


@dataclass(frozen=True, slots=True)
class CommandContext:
    identity: SessionIdentity
    room_code: str


class CommandRouter:
    def __init__(self, room_manager: RoomManager) -> None:
        self._room_manager = room_manager

    @staticmethod
    def parse_reconnect(message: object) -> ReconnectCommand:
        try:
            return ReconnectCommand.model_validate(message)
        except ValidationError as error:
            raise RoomError("INVALID_MESSAGE", "Invalid reconnect message.") from error

    async def handle(
        self,
        context: CommandContext,
        message: object,
    ) -> list[RoomChange]:
        if context.identity.room_code != context.room_code:
            raise ValueError("Command identity does not match the target room.")

        try:
            command = _CLIENT_MESSAGE_ADAPTER.validate_python(message)
        except ValidationError:
            return [
                await self._error_change(
                    context,
                    "INVALID_MESSAGE",
                    "Invalid or unsupported command.",
                    self._request_id(message),
                )
            ]

        if isinstance(command, ReconnectCommand):
            return [
                await self._error_change(
                    context,
                    "INVALID_MESSAGE",
                    "RECONNECT is only valid as the first message.",
                    None,
                )
            ]

        try:
            if isinstance(command, PlayerReadyCommand):
                change = await self._room_manager.set_ready(
                    context.identity,
                    command.ready,
                    command.request_id,
                )
            elif isinstance(command, StartGameCommand):
                change = await self._room_manager.start_game(
                    context.identity,
                    command.request_id,
                )
            elif isinstance(command, RollDiceCommand):
                change = await self._room_manager.roll_dice(
                    context.identity,
                    command.request_id,
                )
            elif isinstance(command, MovePieceCommand):
                dice_indices = tuple(command.dice_indices)
                if dice_indices not in ((0,), (1,), (0, 1)):
                    return [
                        await self._error_change(
                            context,
                            "INVALID_MESSAGE",
                            "Dice indices must be [0], [1], or [0, 1].",
                            command.request_id,
                        )
                    ]
                change = await self._room_manager.move_piece(
                    context.identity,
                    command.request_id,
                    command.piece_id,
                    dice_indices,
                )
            elif isinstance(command, MoveBonusPieceCommand):
                change = await self._room_manager.move_bonus_piece(
                    context.identity,
                    command.request_id,
                    command.piece_id,
                )
            elif isinstance(command, ReturnToLobbyCommand):
                change = await self._room_manager.return_to_lobby(
                    context.identity,
                    command.request_id,
                )
            elif isinstance(command, PlayAgainCommand):
                change = await self._room_manager.play_again(
                    context.identity,
                    command.request_id,
                )
            elif isinstance(command, ChatMessageCommand):
                change = await self._room_manager.send_chat_message(
                    context.identity,
                    command.request_id,
                    command.text,
                )
            elif isinstance(command, ReactionSentCommand):
                change = await self._room_manager.send_reaction(
                    context.identity,
                    command.request_id,
                    command.reaction_id,
                )
            elif isinstance(command, GiftSentCommand):
                change = await self._room_manager.send_gift(
                    context.identity,
                    command.request_id,
                    command.to_player_id,
                    command.gift_id,
                )
            elif isinstance(command, SetCosmeticsCommand):
                change = await self._room_manager.set_cosmetics(
                    context.identity,
                    command.request_id,
                    command.dice_skin_id,
                    command.piece_skin_id,
                )
            else:
                return [
                    await self._error_change(
                        context,
                        "INVALID_MESSAGE",
                        "Invalid or unsupported command.",
                        self._request_id(message),
                    )
                ]
        except RoomError as error:
            return [
                await self._error_change(
                    context,
                    error.code,
                    error.message,
                    command.request_id,
                )
            ]

        return [change]

    async def _error_change(
        self,
        context: CommandContext,
        code: str,
        message: str,
        request_id: str | None,
    ) -> RoomChange:
        state = await self._room_manager.get_room(context.room_code)
        return RoomChange(
            state=state,
            event_type="ERROR",
            payload={"code": code, "message": message},
            request_id=request_id,
        )

    @staticmethod
    def _request_id(message: object) -> str | None:
        if not isinstance(message, dict):
            return None
        request_id = message.get("requestId")
        if isinstance(request_id, str) and 1 <= len(request_id) <= 64:
            return request_id
        return None
