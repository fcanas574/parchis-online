from itertools import count

import pytest
from pydantic import ValidationError

from app.game.models import SessionIdentity
from app.repositories.memory_room_repository import MemoryRoomRepository
from app.repositories.room_repository import RoomCodeCollisionError
from app.schemas.rooms import CreateRoomRequest, RoomCredentials
from app.services.room_manager import RoomError, RoomManager


def make_room_manager(clock, reservation_ttl_seconds=600):
    token_ids = count(1)
    return RoomManager(
        repository=MemoryRoomRepository(),
        code_generator=lambda: "AB7K2",
        token_generator=lambda: f"token-{next(token_ids)}",
        clock=clock,
        reservation_ttl_seconds=reservation_ttl_seconds,
    )


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
        "status",
        "maxPlayers",
        "hostPlayerId",
        "players",
        "stateVersion",
    }
    assert set(public["players"][0]) == {
        "id",
        "displayName",
        "color",
        "seatIndex",
        "isHost",
        "isReady",
        "isConnected",
        "reservationExpiresAt",
    }
    assert "token" not in repr(public).casefold()


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
