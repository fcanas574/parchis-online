from dataclasses import FrozenInstanceError

import pytest

from app.game.models import (
    GameState,
    PieceState,
    RoomState,
)
from app.game.rule_config import GameRulesConfig


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


def test_game_domain_models_represent_piece_locations_and_initial_turn():
    pieces = [
        PieceState("yard-piece", "p1", "yard", None, None),
        PieceState("track-piece", "p1", "track", 12, None),
        PieceState("finish-piece", "p1", "finish_path", None, 3),
        PieceState("finished-piece", "p1", "finished", None, None),
    ]
    game = GameState(
        room_code="AB7K2",
        seat_count=4,
        player_order=["p1", "p2", "p3", "p4"],
        status="playing",
        current_player_id="p1",
        turn_phase="waiting_for_roll",
        dice_values=None,
        used_dice_indices=[],
        available_moves=[],
        pending_bonuses=[],
        pieces=pieces,
        finish_order=[],
        winner_id=None,
        result=None,
        requires_split_plan=False,
    )

    assert [piece.state for piece in game.pieces] == [
        "yard",
        "track",
        "finish_path",
        "finished",
    ]
    assert game.turn_phase == "waiting_for_roll"
    assert getattr(game, "turn_number", None) == 1
    assert getattr(game, "last_rolls_by_player_id", None) == {}


def test_default_game_rules_config_matches_the_approved_variant():
    rules = GameRulesConfig()

    assert rules.pieces_per_player == 4
    assert rules.dice_count == 2
    assert rules.die_sides == 6
    assert rules.exit_value == 5
    assert rules.exact_finish is True
    assert rules.capture_bonus_steps == 20
    assert rules.goal_bonus_steps == 10
    assert rules.blockades_enabled is True
    assert rules.blockade_size == 2
    assert rules.extra_turn_condition == "doubles"
    with pytest.raises(FrozenInstanceError):
        rules.goal_bonus_steps = 30
