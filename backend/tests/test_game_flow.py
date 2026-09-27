import pytest

from app.game.models import DomainEvent, RoomChange, SessionIdentity
from app.realtime.events import make_change_events
from app.services.command_router import CommandContext, CommandRouter
from app.services.room_manager import RoomError
from game_support import create_ready_room


@pytest.mark.asyncio
@pytest.mark.parametrize("seat_count", [4, 5, 6])
async def test_game_flow_starts_with_same_roster_and_public_pieces(
    room_manager,
    seat_count,
):
    credentials = await create_ready_room(room_manager, seat_count)
    room_code = credentials[0].room_code
    host = SessionIdentity(room_code, credentials[0].player_id)

    started = await room_manager.start_game(host, f"start-{seat_count}")
    public_room = room_manager.public_room_from_state(started.state)

    assert started.state.status == "playing"
    assert started.state.game_state.player_order == [
        player.player_id for player in credentials
    ]
    assert public_room["gameState"]["currentPlayerId"] == credentials[0].player_id
    assert len(public_room["gameState"]["pieces"]) == seat_count * 4
    assert all("tokenHash" not in piece for piece in public_room["gameState"]["pieces"])


@pytest.mark.asyncio
async def test_roll_and_move_update_authoritative_snapshot_and_turn(room_manager):
    credentials = await create_ready_room(room_manager, 4)
    room_code = credentials[0].room_code
    host = SessionIdentity(room_code, credentials[0].player_id)
    await room_manager.start_game(host, "start")

    rolled = await room_manager.roll_dice(host, "roll")
    assert rolled.event_type == "DICE_ROLLED"
    assert rolled.state.game_state.dice_values == (5, 2)
    first_move = next(
        option
        for option in rolled.state.game_state.available_moves
        if option.leaves_home
    )
    moved = await room_manager.move_piece(
        host,
        "move-1",
        first_move.piece_id,
        first_move.dice_indices,
    )

    assert moved.state.game_state.current_player_id == credentials[0].player_id
    assert moved.state.game_state.used_dice_indices == [0]
    remaining_move = next(
        option
        for option in moved.state.game_state.available_moves
        if option.dice_indices == (1,)
    )
    completed_turn = await room_manager.move_piece(
        host,
        "move-2",
        remaining_move.piece_id,
        remaining_move.dice_indices,
    )

    assert completed_turn.state.game_state.current_player_id == credentials[1].player_id
    assert completed_turn.state.game_state.turn_phase == "waiting_for_roll"
    assert completed_turn.state.state_version == moved.state.state_version + 1

    public_room = room_manager.public_room_from_state(completed_turn.state)
    assert public_room["gameState"]["currentPlayerId"] == credentials[1].player_id
    assert "token_hash" not in repr(public_room)


@pytest.mark.asyncio
async def test_autopilot_performs_one_step_then_yields_to_reconnected_player(
    room_manager,
):
    credentials = await create_ready_room(room_manager, 4)
    room_code = credentials[0].room_code
    host = SessionIdentity(room_code, credentials[0].player_id)
    session = await room_manager.authenticate(room_code, credentials[0].player_token)
    await room_manager.start_game(host, "start")
    await room_manager.disconnect(session)

    automatic_step = await room_manager.run_autopilot_step(room_code)

    assert automatic_step is not None
    assert automatic_step.event_type == "DICE_ROLLED"
    await room_manager.authenticate(room_code, credentials[0].player_token)
    assert await room_manager.run_autopilot_step(room_code) is None


@pytest.mark.asyncio
async def test_command_router_dispatches_roll_as_authenticated_player(room_manager):
    credentials = await create_ready_room(room_manager, 4)
    identity = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    await room_manager.start_game(identity, "start-router")
    router = CommandRouter(room_manager)

    changes = await router.handle(
        CommandContext(identity, identity.room_code),
        {"type": "ROLL_DICE", "version": 1, "requestId": "roll-router"},
    )

    assert changes[0].event_type == "DICE_ROLLED"
    assert changes[0].request_id == "roll-router"
    assert changes[0].payload["playerId"] == credentials[0].player_id
    assert changes[0].state.game_state.dice_values == (5, 2)


@pytest.mark.asyncio
async def test_command_router_rejects_roll_during_another_players_turn(room_manager):
    credentials = await create_ready_room(room_manager, 4)
    host = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    started = await room_manager.start_game(host, "start-other-turn")
    guest = SessionIdentity(credentials[0].room_code, credentials[1].player_id)
    router = CommandRouter(room_manager)

    changes = await router.handle(
        CommandContext(guest, guest.room_code),
        {"type": "ROLL_DICE", "version": 1, "requestId": "guest-roll"},
    )

    assert changes[0].event_type == "ERROR"
    assert changes[0].payload["code"] == "INVALID_GAME_ACTION"
    assert changes[0].request_id == "guest-roll"
    assert changes[0].state.state_version == started.state.state_version


@pytest.mark.asyncio
@pytest.mark.parametrize("dice_indices", [[], [0, 0], [1, 0], [2]])
async def test_move_command_rejects_malformed_dice_indices_without_mutation(
    room_manager,
    dice_indices,
):
    credentials = await create_ready_room(room_manager, 4)
    room_code = credentials[0].room_code
    identity = SessionIdentity(room_code, credentials[0].player_id)
    await room_manager.start_game(identity, "start-malformed")
    before = (await room_manager.get_room(room_code)).state_version
    router = CommandRouter(room_manager)

    changes = await router.handle(
        CommandContext(identity, room_code),
        {
            "type": "MOVE_PIECE",
            "version": 1,
            "requestId": "move-malformed",
            "pieceId": "p1-piece-1",
            "diceIndices": dice_indices,
        },
    )

    assert changes[0].event_type == "ERROR"
    assert changes[0].request_id == "move-malformed"
    assert changes[0].state.state_version == before


@pytest.mark.asyncio
async def test_replayed_move_request_does_not_apply_twice(room_manager):
    credentials = await create_ready_room(room_manager, 4)
    host = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    await room_manager.start_game(host, "start-replay")
    rolled = await room_manager.roll_dice(host, "roll-replay")
    option = next(
        move for move in rolled.state.game_state.available_moves if move.leaves_home
    )

    first = await room_manager.move_piece(
        host, "move-once", option.piece_id, option.dice_indices
    )
    replay = await room_manager.move_piece(
        host, "move-once", option.piece_id, option.dice_indices
    )

    assert replay.state.state_version == first.state.state_version
    assert replay.state.game_state.pieces == first.state.game_state.pieces


@pytest.mark.asyncio
async def test_change_event_batch_keeps_semantic_order_and_one_state_version(
    room_manager,
):
    credentials = await create_ready_room(room_manager, 4)
    host = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    started = await room_manager.start_game(host, "start-event-batch")
    public_room = room_manager.public_room_from_state(started.state)
    change = RoomChange(
        state=started.state,
        event_type="PIECE_MOVED",
        payload={
            "pieceId": "p1-piece-1",
            "from": {
                "state": "yard",
                "trackPosition": None,
                "finishProgress": None,
            },
            "to": {
                "state": "track",
                "trackPosition": 0,
                "finishProgress": None,
            },
            "diceIndices": (0,),
        },
        request_id="batch-request",
        additional_events=(
            DomainEvent(
                "PIECE_CAPTURED",
                {
                    "capturedPieceId": "p2-piece-1",
                    "byPieceId": "p1-piece-1",
                    "bonusSteps": 20,
                },
            ),
            DomainEvent(
                "BONUS_GRANTED",
                {"playerId": credentials[0].player_id, "steps": 20, "reason": "capture"},
            ),
        ),
    )

    events = make_change_events(change, public_room)

    assert [event["type"] for event in events] == [
        "PIECE_MOVED",
        "PIECE_CAPTURED",
        "BONUS_GRANTED",
        "GAME_STATE_SYNC",
    ]
    assert {event["stateVersion"] for event in events} == {
        started.state.state_version
    }
    assert all(event["requestId"] == "batch-request" for event in events)
    assert events[-1]["payload"] == {
        "room": public_room,
        "game": public_room["gameState"],
    }


@pytest.mark.asyncio
async def test_return_to_lobby_requires_finished_game(room_manager):
    credentials = await create_ready_room(room_manager, 4)
    host = SessionIdentity(credentials[0].room_code, credentials[0].player_id)

    with pytest.raises(RoomError, match="finished"):
        await room_manager.return_to_lobby(host, "return-too-early")
