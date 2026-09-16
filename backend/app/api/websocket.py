import json
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.api.rooms import get_room_manager
from app.config import settings
from app.game.models import RoomChange, RoomState
from app.realtime.connection_manager import ClientConnection, ConnectionManager
from app.realtime.events import make_error_event, make_event
from app.services.command_router import CommandContext, CommandRouter
from app.services.room_manager import RoomError, RoomManager


router = APIRouter(prefix="/api/ws", tags=["websocket"])

_connection_manager = ConnectionManager()


def get_connection_manager() -> ConnectionManager:
    return _connection_manager


class InvalidWebSocketMessage(Exception):
    pass


async def _receive_message(websocket: WebSocket) -> object:
    message = await websocket.receive()
    if message["type"] == "websocket.disconnect":
        raise WebSocketDisconnect(
            code=message.get("code", 1000),
            reason=message.get("reason", ""),
        )

    raw_message = message.get("text")
    if raw_message is None:
        raw_message = message.get("bytes")
    if raw_message is None:
        raise InvalidWebSocketMessage("Message must contain JSON text.")

    if isinstance(raw_message, str):
        message_size = len(raw_message.encode("utf-8"))
    else:
        message_size = len(raw_message)
    if message_size > settings.max_websocket_message_bytes:
        raise InvalidWebSocketMessage("Message exceeds the maximum size.")

    try:
        parsed = json.loads(raw_message)
    except (json.JSONDecodeError, UnicodeDecodeError, TypeError) as error:
        raise InvalidWebSocketMessage("Message must be valid JSON.") from error
    if not isinstance(parsed, dict):
        raise InvalidWebSocketMessage("Message must be a JSON object.")
    return parsed


def _public_player(
    room_manager: RoomManager,
    state: RoomState,
    player_id: str,
) -> dict[str, Any]:
    public_room = room_manager.public_room_from_state(state)
    players = public_room["players"]
    if not isinstance(players, list):
        raise RuntimeError("Public room players must be a list.")
    for player in players:
        if isinstance(player, dict) and player.get("id") == player_id:
            return player
    raise RuntimeError("Authenticated player is absent from the room snapshot.")


@router.websocket("/rooms/{room_code}")
async def room_websocket(
    websocket: WebSocket,
    room_code: str,
    room_manager: RoomManager = Depends(get_room_manager),
    connection_manager: ConnectionManager = Depends(get_connection_manager),
) -> None:
    await websocket.accept()
    connection: ClientConnection | None = None

    async def send_handshake_error(error: RoomError) -> None:
        await websocket.send_json(
            make_error_event(
                room_code,
                0,
                error.code,
                error.message,
            )
        )
        await websocket.close(code=1008, reason=error.code)

    async def send_connection_error(message: str) -> None:
        if connection is None:
            return
        state = await room_manager.get_room(room_code)
        await connection_manager.send(
            connection,
            make_error_event(
                room_code,
                state.state_version,
                "INVALID_MESSAGE",
                message,
            ),
        )

    async def broadcast_change(change: RoomChange) -> None:
        semantic_event = make_event(
            change.event_type,
            change.state.room_code,
            change.state.state_version,
            change.payload,
            change.request_id,
        )
        await connection_manager.broadcast(change.state.room_code, semantic_event)
        public_room = room_manager.public_room_from_state(change.state)
        sync_event = make_event(
            "GAME_STATE_SYNC",
            change.state.room_code,
            change.state.state_version,
            {"room": public_room},
        )
        await connection_manager.broadcast(change.state.room_code, sync_event)

    try:
        try:
            first_message = await _receive_message(websocket)
            reconnect = CommandRouter.parse_reconnect(first_message)
            if reconnect.room_code != room_code:
                raise RoomError(
                    "INVALID_MESSAGE",
                    "Reconnect room code does not match the WebSocket URL.",
                )
            authenticated = await room_manager.authenticate(
                room_code,
                reconnect.player_token,
            )
        except InvalidWebSocketMessage as error:
            await send_handshake_error(RoomError("INVALID_MESSAGE", str(error)))
            return
        except RoomError as error:
            await send_handshake_error(error)
            return

        connection = ClientConnection(websocket, authenticated.identity)
        await connection_manager.add(room_code, connection)

        state = await room_manager.get_room(room_code)
        event_type = (
            "PLAYER_RECONNECTED" if authenticated.is_reconnect else "PLAYER_JOINED"
        )
        presence_change = RoomChange(
            state=state,
            event_type=event_type,
            payload={
                "player": _public_player(
                    room_manager,
                    state,
                    authenticated.identity.player_id,
                )
            },
        )
        await broadcast_change(presence_change)

        command_router = CommandRouter(room_manager)
        context = CommandContext(authenticated.identity, room_code)
        while True:
            try:
                message = await _receive_message(websocket)
            except InvalidWebSocketMessage as error:
                await send_connection_error(str(error))
                continue

            changes = await command_router.handle(context, message)
            for change in changes:
                if change.event_type == "ERROR":
                    await connection_manager.send(
                        connection,
                        make_event(
                            change.event_type,
                            change.state.room_code,
                            change.state.state_version,
                            change.payload,
                            change.request_id,
                        ),
                    )
                else:
                    await broadcast_change(change)
    except WebSocketDisconnect:
        pass
    finally:
        if connection is not None:
            await connection_manager.remove(
                connection.identity.room_code,
                connection.identity.player_id,
            )
            try:
                disconnect_change = await room_manager.disconnect(connection.identity)
            except RoomError:
                disconnect_change = None
            if disconnect_change is not None:
                await broadcast_change(disconnect_change)
