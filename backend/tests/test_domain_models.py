from app.game.models import RoomState


def test_new_room_starts_in_lobby_with_zero_state_version():
    room = RoomState(
        room_code="AB7K2",
        max_players=4,
        host_player_id="p1",
        players=[],
    )

    assert room.status == "lobby"
    assert room.state_version == 0
    assert room.processed_changes == {}
