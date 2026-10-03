import asyncio
import copy
from itertools import count
from types import SimpleNamespace
from typing import cast

import pytest
from pydantic import ValidationError

from app.realtime.events import make_change_events
from app.game.models import (
    GameResult,
    PendingBonus,
    PlayerPlacement,
    RoomChange,
    RoomState,
    SessionIdentity,
)
from app.game.rules import GameRules
from app.repositories.memory_room_repository import MemoryRoomRepository
from app.repositories.room_repository import RoomCodeCollisionError
from app.schemas.rooms import CreateRoomRequest, RoomCredentials
import app.services.room_manager as room_manager_module
from app.services.room_manager import RoomError, RoomManager, hash_player_token
from game_support import create_ready_room, make_game_state


async def social_action(manager, name, *args):
    operation = getattr(manager, name, None)
    assert callable(operation), f"RoomManager.{name} is not implemented"
    return await operation(*args)


async def start_social_game(manager):
    credentials = await create_ready_room(manager, 4)
    host = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    await manager.start_game(host, "social-start")
    return credentials


def make_room_manager(clock, reservation_ttl_seconds=600):
    token_ids = count(1)
    return RoomManager(
        repository=MemoryRoomRepository(),
        code_generator=lambda: "AB7K2",
        token_generator=lambda: f"token-{next(token_ids)}",
        clock=clock,
        reservation_ttl_seconds=reservation_ttl_seconds,
    )


@pytest.mark.parametrize("player_count", [4, 5, 6])
@pytest.mark.asyncio
async def test_create_practice_room_fills_seats_and_starts_game(clock, player_count):
    manager = make_room_manager(clock)

    host = await manager.create_practice_room("Felipe", player_count, "purple")
    room = await manager.get_room(host.room_code)
    snapshot = await manager.public_room(host.room_code)

    assert room.mode == "practice"
    assert room.status == "playing"
    assert len(room.players) == player_count
    assert [player.seat_index for player in room.players] == list(range(player_count))
    assert len({player.color for player in room.players}) == player_count
    assert len({player.display_name.casefold() for player in room.players}) == player_count
    assert room.players[0].id == host.player_id
    assert room.players[0].is_bot is False
    assert all(player.is_bot for player in room.players[1:])
    assert all(not player.is_connected for player in room.players[1:])
    assert all(player.reservation_expires_at is None for player in room.players[1:])
    assert room.game_state is not None
    assert room.game_state.player_order == [player.id for player in room.players]
    assert snapshot["mode"] == "practice"
    assert [player["isBot"] for player in snapshot["players"]] == [False] + [True] * (player_count - 1)
    assert (await manager.authenticate(host.room_code, host.player_token)).identity.player_id == host.player_id


@pytest.mark.asyncio
async def test_practice_rejects_join_and_bot_identity(clock):
    repository = MemoryRoomRepository()
    manager = RoomManager(
        repository=repository,
        code_generator=lambda: "AB7K2",
        token_generator=lambda: "human-token",
        clock=clock,
    )
    host = await manager.create_practice_room("Felipe", 4, "green")
    room = await manager.get_room(host.room_code)
    bot = room.players[1]
    bot.token_hash = hash_player_token("guessed-bot-token")
    await repository.save(room)

    with pytest.raises(RoomError) as cannot_join:
        await manager.join_room(host.room_code, "Guest", "blue")
    assert cannot_join.value.code == "ROOM_NOT_JOINABLE"

    with pytest.raises(RoomError) as cannot_authenticate:
        await manager.authenticate(host.room_code, "guessed-bot-token")
    assert cannot_authenticate.value.code == "UNAUTHENTICATED"

    with pytest.raises(RoomError) as cannot_act:
        await manager.set_ready(SessionIdentity(host.room_code, bot.id), True, "bot-ready")
    assert cannot_act.value.code == "UNAUTHENTICATED"


@pytest.mark.asyncio
async def test_practice_code_collision_retries_atomically(clock):
    room_codes = iter(("AB7K2", "AB7K2", "CD3E4"))
    manager = RoomManager(
        repository=MemoryRoomRepository(),
        code_generator=lambda: next(room_codes),
        token_generator=lambda: "human-token",
        clock=clock,
    )

    first = await manager.create_practice_room("Felipe", 4, "green")
    second = await manager.create_practice_room("Ana", 4, "red")

    assert first.room_code == "AB7K2"
    assert second.room_code == "CD3E4"
    assert (await manager.get_room(first.room_code)).players[0].id == first.player_id
    assert (await manager.get_room(second.room_code)).players[0].id == second.player_id


@pytest.mark.asyncio
async def test_practice_bot_uses_server_dice_and_only_legal_moves(room_manager, room_repository):
    credentials = await room_manager.create_practice_room("Felipe", 4, "green")
    room = await room_manager.get_room(credentials.room_code)
    bot_id = room.players[1].id
    assert room.game_state is not None
    room.game_state.current_player_id = bot_id
    room.players[1].is_connected = True  # A bot is always automated, regardless of presence flags.
    await room_repository.save(room)

    rolled = await room_manager.run_autopilot_step(credentials.room_code)

    assert rolled is not None
    assert rolled.event_type == "DICE_ROLLED"
    assert rolled.payload["playerId"] == bot_id
    assert rolled.payload["values"] == (5, 2)
    assert rolled.state.game_state is not None
    legal_options = rolled.state.game_state.available_moves
    assert legal_options

    moved = await room_manager.run_autopilot_step(credentials.room_code)

    assert moved is not None
    assert moved.event_type == "PIECE_MOVED"
    assert any(
        option.piece_id == moved.payload["pieceId"]
        and option.dice_indices == moved.payload["diceIndices"]
        for option in legal_options
    )


@pytest.mark.asyncio
async def test_practice_bot_uses_only_offered_bonus_move(room_manager, room_repository):
    credentials = await room_manager.create_practice_room("Felipe", 4, "green")
    room = await room_manager.get_room(credentials.room_code)
    game = room.game_state
    assert game is not None
    bot_id = room.players[1].id
    game.current_player_id = bot_id
    game.turn_phase = "waiting_for_bonus"
    game.dice_values = (5, 2)
    game.used_dice_indices = [0, 1]
    game.pending_bonuses = [PendingBonus(bot_id, 20, "capture")]
    bot_piece = next(piece for piece in game.pieces if piece.player_id == bot_id)
    bot_piece.state = "track"
    bot_piece.track_position = 20
    game.available_moves = list(GameRules().available_bonus_moves(game))
    assert game.available_moves
    legal_piece_ids = {option.piece_id for option in game.available_moves}
    await room_repository.save(room)

    change = await room_manager.run_autopilot_step(credentials.room_code)

    assert change is not None
    assert change.event_type == "PIECE_MOVED"
    assert change.payload["pieceId"] in legal_piece_ids


@pytest.mark.asyncio
async def test_game_action_does_not_deepcopy_response_after_caching(
    room_manager,
    monkeypatch,
):
    credentials = await start_social_game(room_manager)
    identity = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    copied_changes = []
    original_deepcopy = copy.deepcopy

    def count_change_copies(value, memo=None):
        if isinstance(value, RoomChange):
            copied_changes.append(value)
        return original_deepcopy(value, memo)

    monkeypatch.setattr(
        room_manager_module,
        "copy",
        SimpleNamespace(copy=copy.copy, deepcopy=count_change_copies),
    )

    change = await room_manager.roll_dice(identity, "roll-without-extra-copy")

    assert change.event_type == "DICE_ROLLED"
    assert len(copied_changes) == 1


@pytest.mark.asyncio
async def test_play_again_restarts_practice_with_same_seats_and_colors(
    room_manager,
    room_repository,
):
    credentials = await room_manager.create_practice_room("Felipe", 5, "purple")
    room = await room_manager.get_room(credentials.room_code)
    original_seats = [(player.id, player.color) for player in room.players]
    room.status = "finished"
    assert room.game_state is not None
    room.game_state.status = "finished"
    room.game_state.current_player_id = None
    await room_repository.save(room)

    change = await room_manager.play_again(
        SessionIdentity(credentials.room_code, credentials.player_id),
        "again-practice",
    )

    assert change.event_type == "GAME_STARTED"
    assert change.state.mode == "practice"
    assert change.state.status == "playing"
    assert [(player.id, player.color) for player in change.state.players] == original_seats
    assert change.state.game_state is not None
    assert change.state.game_state.current_player_id == credentials.player_id
    assert change.state.game_state.finish_order == []


@pytest.mark.asyncio
async def test_practice_cannot_return_to_a_lobby_that_cannot_start(room_manager, room_repository):
    credentials = await room_manager.create_practice_room("Felipe", 4, "green")
    room = await room_manager.get_room(credentials.room_code)
    room.status = "finished"
    assert room.game_state is not None
    room.game_state.status = "finished"
    await room_repository.save(room)

    with pytest.raises(RoomError) as error:
        await room_manager.return_to_lobby(
            SessionIdentity(credentials.room_code, credentials.player_id),
            "lobby-practice",
        )

    assert error.value.code == "PRACTICE_NO_LOBBY"
    assert (await room_manager.get_room(credentials.room_code)).status == "finished"


@pytest.mark.asyncio
async def test_join_assigns_first_available_color_and_seat(room_manager):
    host = await room_manager.create_room("Host", 4, "green")
    guest = await room_manager.join_room(host.room_code, "Guest", None)
    room = await room_manager.get_room(host.room_code)

    assert guest.player_id != host.player_id
    assert room.players[1].seat_index == 1
    assert room.players[1].color == "red"


@pytest.mark.asyncio
async def test_join_rejects_duplicate_name_and_color(room_manager):
    host = await room_manager.create_room("Host", 4, "green")

    with pytest.raises(RoomError) as duplicate_name:
        await room_manager.join_room(host.room_code, "host", "red")
    assert duplicate_name.value.code == "INVALID_NAME"

    with pytest.raises(RoomError) as duplicate_color:
        await room_manager.join_room(host.room_code, "Guest", "green")
    assert duplicate_color.value.code == "COLOR_UNAVAILABLE"


@pytest.mark.asyncio
async def test_disconnect_reserves_seat_and_authenticate_reconnects(room_manager):
    host = await room_manager.create_room("Host", 4, "green")
    session = await room_manager.authenticate(host.room_code, host.player_token)

    await room_manager.disconnect(session)
    room = await room_manager.get_room(host.room_code)
    assert room.players[0].is_connected is False
    assert room.players[0].reservation_expires_at is not None

    reconnected = await room_manager.authenticate(host.room_code, host.player_token)
    assert reconnected.identity == session.identity
    assert (await room_manager.get_room(host.room_code)).players[0].is_connected is True


@pytest.mark.asyncio
async def test_expired_reservation_frees_seat(room_manager, clock):
    host = await room_manager.create_room("Host", 4, "green")
    session = await room_manager.authenticate(host.room_code, host.player_token)
    await room_manager.disconnect(session)

    clock.advance(seconds=601)
    await room_manager.prune_expired_reservations(host.room_code)

    with pytest.raises(RoomError) as missing:
        await room_manager.authenticate(host.room_code, host.player_token)
    assert missing.value.code == "UNAUTHENTICATED"


@pytest.mark.asyncio
async def test_expired_host_reservation_transfers_host(room_manager, clock):
    host = await room_manager.create_room("Host", 4, "green")
    guest = await room_manager.join_room(host.room_code, "Guest", "red")
    host_session = await room_manager.authenticate(host.room_code, host.player_token)
    await room_manager.authenticate(guest.room_code, guest.player_token)
    await room_manager.disconnect(host_session)

    clock.advance(seconds=601)
    await room_manager.prune_expired_reservations(host.room_code)
    room = await room_manager.get_room(host.room_code)

    assert room.host_player_id == guest.player_id
    assert room.players[0].id == guest.player_id
    assert room.players[0].is_host is True


@pytest.mark.asyncio
async def test_start_requires_full_ready_room_and_host(room_manager):
    host = await room_manager.create_room("Host", 4, "green")
    players = [host]
    for name, color in [("P2", "red"), ("P3", "blue"), ("P4", "yellow")]:
        players.append(await room_manager.join_room(host.room_code, name, color))

    with pytest.raises(RoomError) as not_ready:
        await room_manager.start_game(
            SessionIdentity(host.room_code, host.player_id),
            "start-1",
        )
    assert not_ready.value.code == "PLAYER_NOT_READY"

    for credentials in players:
        await room_manager.set_ready(
            SessionIdentity(credentials.room_code, credentials.player_id),
            True,
            f"ready-{credentials.player_id}",
        )

    change = await room_manager.start_game(
        SessionIdentity(host.room_code, host.player_id),
        "start-2",
    )
    assert change.event_type == "GAME_STARTED"
    assert change.state.status == "playing"


@pytest.mark.parametrize("player_count", [4, 5, 6])
@pytest.mark.asyncio
async def test_create_room_supports_configured_player_counts(room_manager, player_count):
    credentials = await room_manager.create_room("  Host  ", player_count, None)
    room = await room_manager.get_room(credentials.room_code)

    assert room.max_players == player_count
    assert room.host_player_id == credentials.player_id
    assert room.players[0].display_name == "Host"
    assert room.players[0].seat_index == 0
    assert room.players[0].color == "green"
    assert room.players[0].is_host is True
    assert room.players[0].token_hash != credentials.player_token


@pytest.mark.parametrize("player_count", [4, 5, 6])
@pytest.mark.asyncio
async def test_room_capacity_reserves_unique_colors_and_contiguous_seats(
    clock,
    player_count,
):
    manager = make_room_manager(clock)
    host = await manager.create_room("P1", player_count, None)

    for player_number in range(2, player_count + 1):
        await manager.join_room(host.room_code, f"P{player_number}", None)

    room = await manager.get_room(host.room_code)
    assert [player.seat_index for player in room.players] == list(range(player_count))
    assert len({player.color for player in room.players}) == player_count

    with pytest.raises(RoomError) as full:
        await manager.join_room(host.room_code, "Overflow", None)
    assert full.value.code == "ROOM_FULL"


@pytest.mark.asyncio
async def test_create_retries_atomic_room_code_collision(clock):
    class CollideOnceRepository(MemoryRoomRepository):
        def __init__(self):
            super().__init__()
            self.should_collide = True

        async def create(self, room):
            if self.should_collide:
                self.should_collide = False
                raise RoomCodeCollisionError(room.room_code)
            await super().create(room)

    room_codes = iter(("AB7K2", "CD3E4"))
    manager = RoomManager(
        repository=CollideOnceRepository(),
        code_generator=lambda: next(room_codes),
        token_generator=lambda: "token-1",
        clock=clock,
    )
    credentials = await manager.create_room("Host", 4, "green")

    assert credentials.room_code == "CD3E4"
    assert (await manager.get_room("CD3E4")).host_player_id == credentials.player_id


@pytest.mark.parametrize("display_name", [" ", "A", "x" * 21])
@pytest.mark.asyncio
async def test_create_rejects_invalid_trimmed_name(room_manager, display_name):
    with pytest.raises(RoomError) as invalid:
        await room_manager.create_room(display_name, 4, "green")
    assert invalid.value.code == "INVALID_NAME"


@pytest.mark.asyncio
async def test_room_code_and_color_validation_happen_at_service_boundary(room_manager):
    host = await room_manager.create_room("Host", 4, "green")

    with pytest.raises(RoomError) as invalid_code:
        await room_manager.join_room("abc12", "Guest", "red")
    assert invalid_code.value.code == "INVALID_ROOM_CODE"

    with pytest.raises(RoomError) as invalid_color:
        await room_manager.join_room(host.room_code, "Guest", "pink")
    assert invalid_color.value.code == "COLOR_UNAVAILABLE"


@pytest.mark.asyncio
async def test_authenticate_distinguishes_first_connection_and_reconnection(room_manager):
    host = await room_manager.create_room("Host", 4, "green")

    first_connection = await room_manager.authenticate(host.room_code, host.player_token)
    assert first_connection.is_reconnect is False

    await room_manager.disconnect(first_connection)
    reconnect = await room_manager.authenticate(host.room_code, host.player_token)
    assert reconnect.is_reconnect is True
    assert reconnect.identity == first_connection.identity


@pytest.mark.asyncio
async def test_authenticate_rejects_unknown_token_without_exposing_room(room_manager):
    host = await room_manager.create_room("Host", 4, "green")

    with pytest.raises(RoomError) as unauthenticated:
        await room_manager.authenticate(host.room_code, "wrong-token")
    assert unauthenticated.value.code == "UNAUTHENTICATED"

    with pytest.raises(RoomError) as missing_room:
        await room_manager.authenticate("CD3E4", host.player_token)
    assert missing_room.value.code == "UNAUTHENTICATED"

    with pytest.raises(RoomError) as malformed_token:
        await room_manager.authenticate(host.room_code, None)
    assert malformed_token.value.code == "UNAUTHENTICATED"


@pytest.mark.asyncio
async def test_commands_reject_malformed_room_code_before_lookup(room_manager):
    identity = SessionIdentity("abc12", "player-1")

    with pytest.raises(RoomError) as ready_error:
        await room_manager.set_ready(identity, True, "ready-1")
    assert ready_error.value.code == "INVALID_ROOM_CODE"

    with pytest.raises(RoomError) as start_error:
        await room_manager.start_game(identity, "start-1")
    assert start_error.value.code == "INVALID_ROOM_CODE"


@pytest.mark.asyncio
async def test_expired_seat_is_reused_without_displacing_valid_reservation(
    room_manager,
    clock,
):
    host = await room_manager.create_room("Host", 4, "green")
    guest = await room_manager.join_room(host.room_code, "Guest", "red")
    host_session = await room_manager.authenticate(host.room_code, host.player_token)
    guest_session = await room_manager.authenticate(guest.room_code, guest.player_token)
    await room_manager.disconnect(host_session)
    await room_manager.disconnect(guest_session)

    clock.advance(seconds=599)
    newcomer = await room_manager.join_room(host.room_code, "Newcomer", None)
    room = await room_manager.get_room(host.room_code)
    assert next(player for player in room.players if player.id == newcomer.player_id).seat_index == 2

    clock.advance(seconds=2)
    replacement = await room_manager.join_room(host.room_code, "Replacement", None)
    room = await room_manager.get_room(host.room_code)
    assert next(player for player in room.players if player.id == replacement.player_id).seat_index == 0


@pytest.mark.parametrize("accessor", ["get_room", "public_room"])
@pytest.mark.asyncio
async def test_room_reads_prune_expired_reservations(
    room_manager,
    room_repository,
    clock,
    accessor,
):
    host = await room_manager.create_room("Host", 4, "green")
    guest = await room_manager.join_room(host.room_code, "Guest", "red")
    host_session = await room_manager.authenticate(host.room_code, host.player_token)
    await room_manager.disconnect(host_session)
    clock.advance(seconds=601)

    result = await getattr(room_manager, accessor)(host.room_code)

    if accessor == "get_room":
        assert [player.id for player in result.players] == [guest.player_id]
        assert result.host_player_id == guest.player_id
    else:
        assert [player["id"] for player in result["players"]] == [guest.player_id]
        assert result["hostPlayerId"] == guest.player_id
    persisted = await room_repository.get(host.room_code)
    assert [player.id for player in persisted.players] == [guest.player_id]


@pytest.mark.parametrize("operation", ["disconnect", "set_ready", "start_game"])
@pytest.mark.asyncio
async def test_mutations_reject_expired_player_without_persisting_prune(
    room_manager,
    room_repository,
    clock,
    operation,
):
    host = await room_manager.create_room("Host", 4, "green")
    session = await room_manager.authenticate(host.room_code, host.player_token)
    await room_manager.disconnect(session)
    clock.advance(seconds=601)
    before = copy.deepcopy(await room_repository.get(host.room_code))

    with pytest.raises(RoomError) as expired:
        if operation == "disconnect":
            await room_manager.disconnect(session)
        elif operation == "set_ready":
            await room_manager.set_ready(session, True, "expired-ready")
        else:
            await room_manager.start_game(session, "expired-start")

    assert expired.value.code == "UNAUTHENTICATED"
    assert await room_repository.get(host.room_code) == before


@pytest.mark.asyncio
async def test_duplicate_join_does_not_persist_expiry_side_effects(
    room_manager,
    room_repository,
    clock,
):
    host = await room_manager.create_room("Host", 4, "green")
    guest = await room_manager.join_room(host.room_code, "Guest", "red")
    guest_session = await room_manager.authenticate(guest.room_code, guest.player_token)
    await room_manager.disconnect(guest_session)
    clock.advance(seconds=601)
    before = copy.deepcopy(await room_repository.get(host.room_code))

    with pytest.raises(RoomError) as duplicate:
        await room_manager.join_room(host.room_code, " host ", "blue")

    assert duplicate.value.code == "INVALID_NAME"
    assert await room_repository.get(host.room_code) == before


@pytest.mark.asyncio
async def test_invalid_authentication_does_not_persist_expiry_side_effects(
    room_manager,
    room_repository,
    clock,
):
    host = await room_manager.create_room("Host", 4, "green")
    session = await room_manager.authenticate(host.room_code, host.player_token)
    await room_manager.disconnect(session)
    clock.advance(seconds=601)
    before = copy.deepcopy(await room_repository.get(host.room_code))

    with pytest.raises(RoomError) as invalid:
        await room_manager.authenticate(host.room_code, "wrong-token")

    assert invalid.value.code == "UNAUTHENTICATED"
    assert await room_repository.get(host.room_code) == before


@pytest.mark.asyncio
async def test_room_recreation_waits_for_deletion_lock_lifecycle(clock):
    class PausingRemovalManager(RoomManager):
        def __init__(self, **kwargs):
            super().__init__(**kwargs)
            self.removal_started = asyncio.Event()
            self.allow_removal = asyncio.Event()

        async def _remove_lock(self, room_code, room_lock):
            self.removal_started.set()
            await self.allow_removal.wait()
            await super()._remove_lock(room_code, room_lock)

    token_ids = count(1)
    manager = PausingRemovalManager(
        repository=MemoryRoomRepository(),
        code_generator=lambda: "AB7K2",
        token_generator=lambda: f"token-{next(token_ids)}",
        clock=clock,
    )
    original = await manager.create_room("Original", 4, "green")
    session = await manager.authenticate(original.room_code, original.player_token)
    await manager.disconnect(session)
    clock.advance(seconds=601)

    prune_task = asyncio.create_task(
        manager.prune_expired_reservations(original.room_code)
    )
    await manager.removal_started.wait()
    recreate_task = asyncio.create_task(
        manager.create_room("Replacement", 4, "red")
    )
    await asyncio.sleep(0)
    await asyncio.sleep(0)
    recreation_was_serialized = not recreate_task.done()

    manager.allow_removal.set()
    await prune_task
    replacement = await recreate_task

    assert recreation_was_serialized is True
    assert replacement.room_code == original.room_code
    assert original.room_code in manager._room_locks


@pytest.mark.asyncio
async def test_ready_request_is_idempotent_and_cached_change_is_a_snapshot(room_manager):
    host = await room_manager.create_room("Host", 4, "green")
    guest = await room_manager.join_room(host.room_code, "Guest", "red")
    host_identity = SessionIdentity(host.room_code, host.player_id)
    guest_identity = SessionIdentity(guest.room_code, guest.player_id)

    first = await room_manager.set_ready(host_identity, True, "ready-1")
    repeated = await room_manager.set_ready(host_identity, False, "ready-1")
    await room_manager.set_ready(guest_identity, True, "ready-1")

    room = await room_manager.get_room(host.room_code)
    assert first.payload == {"playerId": host.player_id, "ready": True}
    assert repeated.payload == first.payload
    assert first.state.state_version == 2
    assert repeated.state.state_version == 2
    assert room.state_version == 3
    assert room.players[0].is_ready is True
    assert room.players[1].is_ready is True


@pytest.mark.asyncio
async def test_processed_request_cache_is_capped_at_128(room_manager):
    host = await room_manager.create_room("Host", 4, "green")
    identity = SessionIdentity(host.room_code, host.player_id)

    for request_number in range(129):
        await room_manager.set_ready(identity, request_number % 2 == 0, f"req-{request_number}")

    room = await room_manager.get_room(host.room_code)
    assert len(room.processed_changes) == 128
    assert (host.player_id, "req-0") not in room.processed_changes
    assert (host.player_id, "req-128") in room.processed_changes


@pytest.mark.asyncio
async def test_start_rejects_non_host_and_incomplete_room(room_manager):
    host = await room_manager.create_room("Host", 4, "green")
    guest = await room_manager.join_room(host.room_code, "Guest", "red")

    with pytest.raises(RoomError) as not_host:
        await room_manager.start_game(
            SessionIdentity(guest.room_code, guest.player_id),
            "start-guest",
        )
    assert not_host.value.code == "NOT_HOST"

    with pytest.raises(RoomError) as insufficient:
        await room_manager.start_game(
            SessionIdentity(host.room_code, host.player_id),
            "start-host",
        )
    assert insufficient.value.code == "INSUFFICIENT_PLAYERS"


@pytest.mark.asyncio
async def test_public_room_has_only_v1_public_fields(room_manager):
    credentials = await room_manager.create_room("Host", 4, "green")
    public = await room_manager.public_room(credentials.room_code)

    assert set(public) == {
        "roomCode",
        "mode",
        "status",
        "maxPlayers",
        "hostPlayerId",
        "players",
        "stateVersion",
        "gameState",
        "lastGameResult",
    }
    assert set(public["players"][0]) == {
        "id",
        "displayName",
        "color",
        "seatIndex",
        "isHost",
        "isBot",
        "isReady",
        "isConnected",
        "reservationExpiresAt",
        "diceSkinId",
        "pieceSkinId",
        "lastReceivedGiftId",
    }
    assert public["mode"] == "friends"
    assert public["players"][0]["isBot"] is False
    assert "token" not in repr(public).casefold()


@pytest.mark.asyncio
async def test_public_player_defaults_to_classic_skins_and_no_received_gift(room_manager):
    credentials = await room_manager.create_room("Host", 4, "green")

    public = await room_manager.public_room(credentials.room_code)
    player = public["players"][0]

    assert player.get("diceSkinId") == "classic"
    assert player.get("pieceSkinId") == "classic"
    assert player.get("lastReceivedGiftId") is None
    assert "tokenHash" not in player
    assert "token" not in repr(public).casefold()


@pytest.mark.asyncio
async def test_chat_message_is_normalized_and_history_keeps_only_last_fifty(
    room_manager,
    clock,
):
    credentials = await start_social_game(room_manager)
    sender = SessionIdentity(credentials[0].room_code, credentials[0].player_id)

    for index in range(51):
        if index > 0 and index % 5 == 0:
            clock.advance(seconds=10)
        await social_action(
            room_manager,
            "send_chat_message",
            sender,
            f"chat-{index}",
            "  Hola\x00 👨‍👩‍👧‍👦\x7f \t",
        )

    history = await social_action(room_manager, "recent_chat_history", sender)

    assert len(history) == 50
    assert history[0]["text"] == "Hola 👨‍👩‍👧‍👦"
    assert history[-1]["text"] == "Hola 👨‍👩‍👧‍👦"
    assert len({message["messageId"] for message in history}) == 50


@pytest.mark.asyncio
async def test_chat_request_id_replay_returns_same_message_without_duplicate(room_manager):
    credentials = await start_social_game(room_manager)
    sender = SessionIdentity(credentials[0].room_code, credentials[0].player_id)

    first = await social_action(
        room_manager, "send_chat_message", sender, "same-request", "first"
    )
    replay = await social_action(
        room_manager, "send_chat_message", sender, "same-request", "different"
    )
    history = await social_action(room_manager, "recent_chat_history", sender)

    assert replay.payload["messageId"] == first.payload["messageId"]
    assert replay.payload["text"] == "first"
    assert [message["text"] for message in history] == ["first"]


@pytest.mark.asyncio
async def test_social_chat_and_reactions_require_active_game_without_mutation(
    room_manager,
):
    host = await room_manager.create_room("Host", 4, "green")
    identity = SessionIdentity(host.room_code, host.player_id)
    before = await room_manager.public_room(host.room_code)

    for method, args in (
        ("send_chat_message", (identity, "lobby-chat", "hello")),
        ("send_reaction", (identity, "lobby-reaction", "laugh")),
    ):
        with pytest.raises(RoomError) as rejected:
            await social_action(room_manager, method, *args)
        assert rejected.value.code == "GAME_NOT_ACTIVE"

    assert await room_manager.public_room(host.room_code) == before
    assert getattr(await room_manager.get_room(host.room_code), "chat_messages", []) == []


@pytest.mark.asyncio
async def test_gift_updates_only_other_recipient_and_publishes_snapshot(room_manager):
    credentials = await start_social_game(room_manager)
    sender = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    recipient_id = credentials[1].player_id

    gift = await social_action(
        room_manager, "send_gift", sender, "gift-1", recipient_id, "rose"
    )
    room = room_manager.public_room_from_state(gift.state)
    events = make_change_events(gift, room)

    assert gift.event_type == "GIFT_SENT"
    assert gift.payload == {
        "fromPlayerId": credentials[0].player_id,
        "toPlayerId": recipient_id,
        "giftId": "rose",
    }
    assert room["players"][1]["lastReceivedGiftId"] == "rose"
    assert events[-1]["type"] == "GAME_STATE_SYNC"


@pytest.mark.asyncio
async def test_transient_chat_and_reaction_do_not_emit_game_state_sync(room_manager):
    credentials = await start_social_game(room_manager)
    sender = SessionIdentity(credentials[0].room_code, credentials[0].player_id)

    chat = await social_action(
        room_manager, "send_chat_message", sender, "chat-1", "hello"
    )
    reaction = await social_action(
        room_manager, "send_reaction", sender, "reaction-1", "laugh"
    )
    chat_events = make_change_events(
        chat, room_manager.public_room_from_state(chat.state)
    )
    reaction_events = make_change_events(
        reaction, room_manager.public_room_from_state(reaction.state)
    )

    assert chat.include_state_sync is False
    assert reaction.include_state_sync is False
    assert [event["type"] for event in chat_events] == ["CHAT_MESSAGE"]
    assert [event["type"] for event in reaction_events] == ["REACTION_SENT"]
    assert chat.state.state_version == reaction.state.state_version


@pytest.mark.asyncio
async def test_social_commands_use_identity_and_reject_invalid_targets_without_mutation(
    room_manager,
):
    credentials = await start_social_game(room_manager)
    sender = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    before = await room_manager.public_room(credentials[0].room_code)

    for request_id, target_id, gift_id in (
        ("self-gift", credentials[0].player_id, "rose"),
        ("missing-player", "not-in-room", "rose"),
        ("invalid-gift", credentials[1].player_id, "not-a-gift"),
    ):
        with pytest.raises(RoomError):
            await social_action(
                room_manager, "send_gift", sender, request_id, target_id, gift_id
            )

    with pytest.raises(RoomError):
        await social_action(
            room_manager, "send_reaction", sender, "invalid-reaction", "not-a-reaction"
        )
    with pytest.raises(RoomError):
        await social_action(
            room_manager,
            "set_cosmetics",
            sender,
            "invalid-skin",
            "not-a-skin",
            "classic",
        )

    assert await room_manager.public_room(credentials[0].room_code) == before


@pytest.mark.asyncio
async def test_cosmetics_can_change_in_lobby_and_game_but_freeze_when_finished(
    room_manager,
    room_repository,
):
    credentials = await create_ready_room(room_manager, 4)
    host = SessionIdentity(credentials[0].room_code, credentials[0].player_id)

    lobby_change = await social_action(
        room_manager, "set_cosmetics", host, "skin-lobby", "brass", "walnut"
    )
    assert lobby_change.state.players[0].dice_skin_id == "brass"
    await room_manager.start_game(host, "social-start")
    game_change = await social_action(
        room_manager, "set_cosmetics", host, "skin-game", "midnight", "glow"
    )
    assert game_change.state.players[0].piece_skin_id == "glow"

    finished = await room_manager.get_room(host.room_code)
    finished.status = "finished"
    assert finished.game_state is not None
    finished.game_state.status = "finished"
    await room_repository.save(finished)
    before = await room_manager.public_room(host.room_code)
    with pytest.raises(RoomError) as rejected:
        await social_action(
            room_manager, "set_cosmetics", host, "skin-finished", "jade", "porcelain"
        )

    assert rejected.value.code == "GAME_FINISHED"
    assert await room_manager.public_room(host.room_code) == before


@pytest.mark.asyncio
async def test_chat_rate_limit_rejects_sixth_message_in_ten_seconds(room_manager):
    credentials = await start_social_game(room_manager)
    sender = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    initial_version = (await room_manager.get_room(sender.room_code)).state_version

    for index in range(5):
        await social_action(
            room_manager, "send_chat_message", sender, f"chat-{index}", f"message {index}"
        )
    with pytest.raises(RoomError) as rejected:
        await social_action(
            room_manager, "send_chat_message", sender, "chat-5", "too many"
        )

    room = await room_manager.get_room(sender.room_code)
    assert rejected.value.code == "RATE_LIMITED"
    assert len(room.chat_messages) == 5
    assert room.state_version == initial_version


@pytest.mark.asyncio
async def test_reaction_rate_limit_rejects_ninth_reaction_in_five_seconds(room_manager):
    credentials = await start_social_game(room_manager)
    sender = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    initial_version = (await room_manager.get_room(sender.room_code)).state_version

    for index in range(8):
        await social_action(
            room_manager, "send_reaction", sender, f"reaction-{index}", "laugh"
        )
    with pytest.raises(RoomError) as rejected:
        await social_action(
            room_manager, "send_reaction", sender, "reaction-8", "laugh"
        )

    room = await room_manager.get_room(sender.room_code)
    assert rejected.value.code == "RATE_LIMITED"
    assert room.state_version == initial_version


@pytest.mark.asyncio
async def test_gift_rate_limit_rejects_fourth_gift_in_ten_seconds(room_manager):
    credentials = await start_social_game(room_manager)
    sender = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    recipient_id = credentials[1].player_id

    for index, gift_id in enumerate(("rose", "tomato", "applause")):
        await social_action(
            room_manager,
            "send_gift",
            sender,
            f"gift-{index}",
            recipient_id,
            gift_id,
        )
    before = await room_manager.public_room(sender.room_code)
    with pytest.raises(RoomError) as rejected:
        await social_action(
            room_manager, "send_gift", sender, "gift-3", recipient_id, "fire"
        )

    assert rejected.value.code == "RATE_LIMITED"
    assert await room_manager.public_room(sender.room_code) == before


@pytest.mark.asyncio
@pytest.mark.parametrize("seat_count", [4, 5, 6])
async def test_start_creates_game_and_public_snapshot(room_manager, seat_count):
    credentials = await create_ready_room(room_manager, seat_count)
    room_code = credentials[0].room_code
    identity = SessionIdentity(room_code, credentials[0].player_id)

    change = await room_manager.start_game(identity, f"start-{seat_count}")
    public = room_manager.public_room_from_state(change.state)

    assert change.state.game_state.current_player_id == credentials[0].player_id
    assert change.state.game_state.player_order == [
        player.player_id for player in credentials
    ]
    assert len(public["gameState"]["pieces"]) == seat_count * 4
    assert public["lastGameResult"] is None
    assert "token_hash" not in repr(public)


@pytest.mark.asyncio
async def test_expired_game_token_keeps_seat_and_cannot_reconnect(
    room_manager,
    room_repository,
    clock,
):
    credentials = await create_ready_room(room_manager, 4)
    identity = SessionIdentity(credentials[0].room_code, credentials[0].player_id)
    await room_manager.start_game(identity, "start")
    finished = await room_manager.get_room(identity.room_code)
    finished.status = "finished"
    finished.game_state.status = "finished"
    finished.game_state.turn_phase = "finished"
    finished.game_state.current_player_id = None
    await room_repository.save(finished)
    await room_manager.disconnect(identity)

    clock.advance(seconds=601)
    await room_manager.prune_expired_reservations(identity.room_code)
    expired_version = (await room_manager.get_room(identity.room_code)).state_version
    room = await room_manager.get_room(identity.room_code)

    assert room.status == "finished"
    assert len(room.players) == 4
    assert room.players[0].id == credentials[0].player_id
    assert room.players[0].reservation_expired is True
    assert room.state_version == expired_version
    with pytest.raises(RoomError, match="Invalid room credentials"):
        await room_manager.authenticate(identity.room_code, credentials[0].player_token)


@pytest.mark.asyncio
async def test_play_again_preserves_result_and_seats_and_readies_requester(
    room_manager,
    room_repository,
):
    credentials = await create_ready_room(room_manager, 4)
    room_code = credentials[0].room_code
    room = await room_manager.get_room(room_code)
    room.status = "finished"
    room.game_state = make_game_state(turn_phase="finished")
    room.game_state.status = "finished"
    room.game_state.current_player_id = None
    room.last_game_result = GameResult(
        winner_id=credentials[0].player_id,
        placements=[
            PlayerPlacement(player.player_id, rank)
            for rank, player in enumerate(credentials, start=1)
        ],
    )
    await room_repository.save(room)

    change = await room_manager.play_again(
        SessionIdentity(room_code, credentials[0].player_id),
        "again",
    )

    assert change.event_type == "GAME_RESET"
    assert change.payload == {
        "status": "lobby",
        "requestedReplay": True,
        "requesterId": credentials[0].player_id,
    }
    assert change.state.status == "lobby"
    assert change.state.game_state is None
    assert change.state.last_game_result is not None
    assert [player.id for player in change.state.players] == [
        player.player_id for player in credentials
    ]
    assert change.state.players[0].is_ready
    assert all(not player.is_ready for player in change.state.players[1:])


@pytest.mark.asyncio
async def test_return_to_lobby_preserves_result_and_resets_readiness(
    room_manager,
    room_repository,
):
    credentials = await create_ready_room(room_manager, 4)
    room_code = credentials[0].room_code
    room = await room_manager.get_room(room_code)
    room.status = "finished"
    room.game_state = make_game_state(turn_phase="finished")
    room.game_state.status = "finished"
    room.game_state.current_player_id = None
    room.last_game_result = GameResult(
        winner_id=credentials[0].player_id,
        placements=[
            PlayerPlacement(player.player_id, rank)
            for rank, player in enumerate(credentials, start=1)
        ],
    )
    await room_repository.save(room)

    change = await room_manager.return_to_lobby(
        SessionIdentity(room_code, credentials[0].player_id),
        "return",
    )

    assert change.payload == {
        "status": "lobby",
        "requestedReplay": False,
        "requesterId": credentials[0].player_id,
    }
    assert change.state.status == "lobby"
    assert change.state.game_state is None
    assert change.state.last_game_result is not None
    assert all(not player.is_ready for player in change.state.players)


def test_snapshot_change_does_not_copy_processed_changes():
    class CachedChangeMustNotBeCopied:
        def __deepcopy__(self, memo):
            raise AssertionError("idempotency cache should not be copied into a snapshot")

    room = RoomState(
        room_code="AB7K2",
        max_players=4,
        host_player_id="player-1",
        players=[],
    )
    room.processed_changes[("player-1", "old-request")] = cast(
        RoomChange,
        CachedChangeMustNotBeCopied(),
    )

    change = RoomManager._snapshot_change(room, "DICE_ROLLED", {"value": 5})

    assert not change.state.processed_changes
    assert list(room.processed_changes) == [("player-1", "old-request")]


@pytest.mark.asyncio
async def test_room_credentials_validate_from_service_data_and_forbid_extras(room_manager):
    credentials = await room_manager.create_room("Host", 4, "green")
    response = RoomCredentials.model_validate(credentials)
    assert response.model_dump(by_alias=True)["roomCode"] == credentials.room_code

    with pytest.raises(ValidationError):
        CreateRoomRequest.model_validate(
            {
                "displayName": "Host",
                "playerCount": 4,
                "color": "green",
                "seatIndex": 0,
            }
        )
