from dataclasses import replace

import pytest

from app.game.autoplayer import AutopilotPolicy, NoLegalMoveError
from app.game.models import PendingBonus
from app.game.rules import GameRules
from game_support import make_game_state


def test_autopilot_prioritizes_finish_capture_safe_exit_then_progress():
    state = make_game_state(dice_values=(5, 5))
    template = state.available_moves[0]
    state.available_moves = [
        replace(template, piece_id="progress", progress=2),
        replace(template, piece_id="exit", leaves_home=True),
        replace(template, piece_id="safe", lands_safe=True),
        replace(template, piece_id="capture", captures=True),
        replace(
            template,
            piece_id="finish",
            completes_piece=True,
            lands_safe=True,
        ),
    ]

    assert AutopilotPolicy().choose_move(state).piece_id == "finish"

    state.available_moves.pop()
    assert AutopilotPolicy().choose_move(state).piece_id == "capture"

    state.available_moves.pop()
    assert AutopilotPolicy().choose_move(state).piece_id == "safe"

    state.available_moves.pop()
    assert AutopilotPolicy().choose_move(state).piece_id == "exit"


def test_autopilot_uses_progress_and_deterministic_tie_breaking():
    state = make_game_state(dice_values=(5, 5))
    template = state.available_moves[0]
    state.available_moves = [
        replace(template, piece_id="p1-piece-2", progress=10),
        replace(template, piece_id="p1-piece-3", progress=4),
        replace(template, piece_id="p1-piece-1", progress=10),
    ]
    policy = AutopilotPolicy()

    selected = policy.choose_move(state)

    assert selected == policy.choose_move(state)
    assert selected == state.available_moves[2]


def test_autopilot_never_invents_a_move_when_engine_has_no_options():
    state = make_game_state(dice_values=None)

    with pytest.raises(NoLegalMoveError):
        AutopilotPolicy().choose_move(state)


def test_autopilot_selects_bonus_only_from_engine_offered_moves():
    state = make_game_state(
        dice_values=(1, 2),
        track_by_player={"p1": (10,)},
        pending_bonuses=(PendingBonus("p1", 20, "capture"),),
        turn_phase="waiting_for_bonus",
    )
    state.used_dice_indices = [0, 1]
    state.available_moves = list(GameRules().available_bonus_moves(state))

    selected_piece_id = AutopilotPolicy().choose_bonus_move(state)

    assert selected_piece_id in {move.piece_id for move in state.available_moves}


def test_autopilot_returns_none_when_bonus_has_no_legal_options():
    state = make_game_state(dice_values=None)
    state.turn_phase = "waiting_for_bonus"
    state.pending_bonuses = [PendingBonus("p1", 20, "capture")]

    assert AutopilotPolicy().choose_bonus_move(state) is None
