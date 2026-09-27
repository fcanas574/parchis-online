import asyncio
import json
from collections import deque
from typing import Any
from weakref import WeakKeyDictionary

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from app.api.rooms import get_room_manager
from app.config import settings
from app.game.models import RoomChange, RoomState
from app.realtime.connection_manager import (
    ClientConnection,
    ConnectionManager,
    RoomPublicationCoordinator,
)
from app.realtime.autopilot_runner import RoomAutopilotRunner
from app.realtime.events import make_change_events, make_error_event, make_event
from app.services.command_router import CommandContext, CommandRouter
from app.services.room_manager import RoomError, RoomManager


router = APIRouter(prefix="/api/ws", tags=["websocket"])

_connection_manager = ConnectionManager()
_publication_coordinator = RoomPublicationCoordinator()
_autopilot_runners: WeakKeyDictionary[RoomManager, RoomAutopilotRunner] = (
    WeakKeyDictionary()
)


def _runner_for(room_manager: RoomManager) -> RoomAutopilotRunner:
    runner = _autopilot_runners.get(room_manager)
    if runner is None:
        runner = RoomAutopilotRunner()
        _autopilot_runners[room_manager] = runner
    return runner


def get_connection_manager() -> ConnectionManager:
    return _connection_manager


def get_publication_coordinator() -> RoomPublicationCoordinator:
    return _publication_coordinator


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
    publication_coordinator: RoomPublicationCoordinator = Depends(
        get_publication_coordinator
    ),
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
        async with publication_coordinator.serialize(room_code):
            if not await connection_manager.is_current(connection):
                return
            state = await room_manager.get_room(room_code)
            await send_connection_event(
                connection,
                make_error_event(
                    room_code,
                    state.state_version,
                    "INVALID_MESSAGE",
                    message,
                ),
            )

    async def send_connection_event(
        target: ClientConnection,
        event: dict[str, object],
    ) -> None:
        failure = await connection_manager.send(target, event)
        if failure is not None:
            await disconnect_connections([failure])

    async def send_state_sync(
        target: ClientConnection,
        state: RoomState,
    ) -> None:
        public_room = room_manager.public_room_from_state(state)
        await send_connection_event(
            target,
            make_event(
                "GAME_STATE_SYNC",
                state.room_code,
                state.state_version,
                {"room": public_room, "game": public_room["gameState"]},
            ),
        )

    async def broadcast_change(change: RoomChange) -> list[ClientConnection]:
        # Finish the complete versioned batch before publishing any disconnects.
        failed: list[ClientConnection] = []
        public_room = room_manager.public_room_from_state(change.state)
        for event in make_change_events(change, public_room):
            failed.extend(
                await connection_manager.broadcast(change.state.room_code, event)
            )
        return failed

    async def disconnect_connections(targets: list[ClientConnection]) -> None:
        """Own removal and domain disconnect under the caller's publication lock.

        Exact removal is the once-only claim shared with endpoint teardown.
        Drain cascading send failures iteratively: never recurse or reacquire
        the room publication lock while emitting PLAYER_LEFT and its snapshot.
        """
        pending = deque(targets)
        should_start_autopilot = False
        while pending:
            target = pending.popleft()
            removed = await connection_manager.remove(
                target.identity.room_code,
                target.identity.player_id,
                target,
            )
            if not removed:
                continue
            try:
                change = await room_manager.disconnect(target.identity)
            except RoomError:
                change = None
            if change is not None:
                if (
                    change.state.status == "playing"
                    and change.state.game_state is not None
                ):
                    should_start_autopilot = True
                pending.extend(await broadcast_change(change))
            if (
                target.websocket.client_state is WebSocketState.CONNECTED
                and target.websocket.application_state is WebSocketState.CONNECTED
            ):
                try:
                    await target.websocket.close(code=1011)
                except Exception:
                    # A failed transport must not block cleanup.
                    pass
        if should_start_autopilot:
            schedule_autopilot()

    async def run_autopilot_worker() -> None:
        while True:
            try:
                state = await room_manager.get_room(room_code)
            except RoomError:
                return
            game = state.game_state
            if state.status != "playing" or game is None:
                return
            active = next(
                (player for player in state.players if player.id == game.current_player_id),
                None,
            )
            if active is None or (active.is_connected and not active.is_bot):
                return
            # Keep the publication lock free while the bot's dice/move is shown.
            await asyncio.sleep(0.5 if active.is_bot else 0)
            async with publication_coordinator.serialize(room_code):
                change = await room_manager.run_autopilot_step(room_code)
                if change is None:
                    return
                failures = await broadcast_change(change)
                await disconnect_connections(failures)
            # Let a reconnecting player acquire the publication lock before the
            # next step re-checks which seat owns the turn.
            await asyncio.sleep(0)

    def schedule_autopilot() -> None:
        _runner_for(room_manager).schedule(room_code, run_autopilot_worker)

    try:
        try:
            first_message = await _receive_message(websocket)
            reconnect = CommandRouter.parse_reconnect(first_message)
            if reconnect.room_code != room_code:
                raise RoomError(
                    "INVALID_MESSAGE",
                    "Reconnect room code does not match the WebSocket URL.",
                )
        except InvalidWebSocketMessage as error:
            await send_handshake_error(RoomError("INVALID_MESSAGE", str(error)))
            return
        except RoomError as error:
            await send_handshake_error(error)
            return

        try:
            async with publication_coordinator.serialize(room_code):
                authenticated = await room_manager.authenticate(
                    room_code,
                    reconnect.player_token,
                )
                connection = ClientConnection(websocket, authenticated.identity)
                replaced = await connection_manager.add(room_code, connection)

                state = await room_manager.get_room(room_code)
                if replaced is not None and not authenticated.is_reconnect:
                    await send_state_sync(connection, state)
                else:
                    event_type = (
                        "PLAYER_RECONNECTED"
                        if authenticated.is_reconnect
                        else "PLAYER_JOINED"
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
                    failures = await broadcast_change(presence_change)
                    await disconnect_connections(failures)
        except RoomError as error:
            await send_handshake_error(error)
            return

        if state.status == "playing" and state.game_state is not None:
            active = next(
                (
                    player
                    for player in state.players
                    if player.id == state.game_state.current_player_id
                ),
                None,
            )
            if active is not None and (active.is_bot or not active.is_connected):
                schedule_autopilot()

        command_router = CommandRouter(room_manager)
        context = CommandContext(authenticated.identity, room_code)
        while await connection_manager.is_current(connection):
            try:
                message = await _receive_message(websocket)
            except InvalidWebSocketMessage as error:
                await send_connection_error(str(error))
                continue

            stop_stale_connection = False
            async with publication_coordinator.serialize(room_code):
                if not await connection_manager.is_current(connection):
                    stop_stale_connection = True
                else:
                    changes = await command_router.handle(context, message)
                    for change in changes:
                        if change.event_type == "ERROR":
                            await send_connection_event(
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
                            failures = await broadcast_change(change)
                            await disconnect_connections(failures)
                            if (
                                change.state.status == "playing"
                                and change.event_type != "GAME_STARTED"
                            ):
                                schedule_autopilot()
            if stop_stale_connection:
                break
    except WebSocketDisconnect:
        pass
    finally:
        if connection is not None:
            async with publication_coordinator.serialize(
                connection.identity.room_code
            ):
                await disconnect_connections([connection])
