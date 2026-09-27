import copy

import pytest

from app.game.board import BoardFactory
from app.game.models import PendingBonus
from app.game.rules import GameRules, IllegalMoveError
from app.game.rule_config import GameRulesConfig
from game_support import SequenceDice, make_game_state, make_players


def test_new_game_creates_four_pieces_per_player_in_seat_order():
    for seat_count in (4, 5, 6):
        state = GameRules().new_game("AB7K2", make_players(seat_count))

        assert state.seat_count == seat_count
        assert state.player_order == [f"p{seat + 1}" for seat in range(seat_count)]
        assert len(state.pieces) == seat_count * 4
        assert [piece.id for piece in state.pieces[:4]] == [
            "p1-piece-1",
            "p1-piece-2",
            "p1-piece-3",
            "p1-piece-4",
        ]
        assert state.current_player_id == "p1"
        assert state.turn_phase == "waiting_for_roll"


def test_roll_uses_injected_server_dice_and_returns_only_legal_options():
    rules = GameRules(dice=SequenceDice([(2, 3)]))
    state = rules.new_game("AB7K2", make_players(4))

    transition = rules.roll_dice(state, "p1")

    assert transition.state.dice_values == (2, 3)
    assert transition.state.turn_phase == "waiting_for_move"
    assert all(option.steps in (2, 3, 5) for option in transition.state.available_moves)
    assert all(option.piece_id.startswith("p1-") for option in transition.state.available_moves)


def test_first_die_options_preserve_a_complete_two_move_plan():
    state = make_game_state(
        dice_values=(2, 4),
        track_by_player={"p1": (10, 40), "p2": (12, 12)},
    )

    options = GameRules(dice=SequenceDice([])).available_moves(state)

    assert options
    assert all(len(option.dice_indices) == 1 for option in options)
    assert all(option.completes_split_plan for option in options)
    assert not any(option.dice_indices == (0, 1) for option in options)


def test_exit_requires_a_single_five_or_a_two_dice_sum_of_five():
    rules = GameRules(dice=SequenceDice([(2, 3), (1, 2)]))
    state = rules.new_game("AB7K2", make_players(4))

    exit_options = rules.roll_dice(state, "p1").state.available_moves
    assert {option.dice_indices for option in exit_options} == {(0, 1)}
    assert {option.steps for option in exit_options} == {5}

    no_exit = rules.roll_dice(
        rules.new_game("CD3E4", make_players(4)),
        "p1",
    )
    assert no_exit.state.current_player_id == "p2"
    assert no_exit.state.available_moves == []


def test_five_forces_a_home_exit_before_other_legal_moves():
    state = make_game_state(
        dice_values=(5, 2),
        track_by_player={"p1": (10, 20)},
    )

    options = GameRules().available_moves(state)

    assert options
    assert all(option.leaves_home for option in options)
    assert all(option.dice_indices == (0,) for option in options)


def test_five_rejects_a_board_move_while_a_home_exit_is_available():
    state = make_game_state(
        dice_values=(5, 2),
        track_by_player={"p1": (10, 20)},
    )

    with pytest.raises(IllegalMoveError):
        GameRules().move_piece(state, "p1", "p1-piece-1", (1,))


def test_two_dice_summing_to_five_force_a_home_exit_using_both_dice():
    state = make_game_state(
        dice_values=(2, 3),
        track_by_player={"p1": (10, 20)},
    )

    options = GameRules().available_moves(state)

    assert options
    assert all(option.leaves_home for option in options)
    assert all(option.dice_indices == (0, 1) for option in options)


def test_a_five_is_not_forced_when_all_of_the_players_pieces_are_out():
    state = make_game_state(
        dice_values=(5, 2),
        track_by_player={"p1": (10, 20, 30, 40)},
    )

    options = GameRules().available_moves(state)

    assert options
    assert all(not option.leaves_home for option in options)


def test_blocked_home_exit_does_not_hide_other_legal_moves():
    start = BoardFactory.create(4).start_cells_by_seat[0]
    state = make_game_state(
        dice_values=(2, 3),
        track_by_player={"p1": (start, start, 20)},
    )

    options = GameRules().available_moves(state)

    assert options
    assert all(not option.leaves_home for option in options)


def test_single_die_five_exit_leaves_the_other_die_available():
    state = make_game_state(
        dice_values=(5, 2),
        track_by_player={"p1": (10,)},
    )

    transition = GameRules().move_piece(state, "p1", "p1-piece-2", (0,))

    assert transition.state.turn_phase == "waiting_for_move"
    assert transition.state.used_dice_indices == [0]
    assert transition.state.available_moves
    assert all(option.dice_indices == (1,) for option in transition.state.available_moves)


@pytest.mark.parametrize("invalid_roll", [(0, 4), (7, 1), (2,), (1, 2, 3)])
def test_roll_rejects_invalid_injected_dice(invalid_roll):
    rules = GameRules(dice=SequenceDice([invalid_roll]))
    state = rules.new_game("AB7K2", make_players(4))

    with pytest.raises(ValueError, match="dice"):
        rules.roll_dice(state, "p1")


def test_only_current_player_can_roll():
    rules = GameRules(dice=SequenceDice([(5, 2)]))
    state = rules.new_game("AB7K2", make_players(4))

    with pytest.raises(IllegalMoveError):
        rules.roll_dice(state, "p2")


@pytest.mark.parametrize("blockade_cell", [12, 14])
def test_move_rejects_crossing_or_landing_on_an_opponent_blockade(blockade_cell):
    rules = GameRules(dice=SequenceDice([]))
    state = make_game_state(
        dice_values=(4, 2),
        track_by_player={"p1": (10,), "p2": (blockade_cell, blockade_cell)},
    )
    before = copy.deepcopy(state)

    with pytest.raises(IllegalMoveError):
        rules.move_piece(state, "p1", "p1-piece-1", (0,))

    assert state == before


def test_safe_cell_prevents_capture_and_ordinary_cell_captures():
    safe_state = make_game_state(
        dice_values=(1, 3),
        track_by_player={"p1": (6,), "p2": (7,)},
    )
    capture_state = make_game_state(
        dice_values=(1, 2),
        track_by_player={"p1": (10,), "p2": (11,)},
    )

    safe = GameRules().move_piece(safe_state, "p1", "p1-piece-1", (0,))
    captured = GameRules().move_piece(
        capture_state,
        "p1",
        "p1-piece-1",
        (0,),
    )

    assert not any(event.type == "PIECE_CAPTURED" for event in safe.events)
    assert sum(
        piece.state == "track" and piece.track_position == 7
        for piece in safe.state.pieces
    ) == 2
    assert any(event.type == "PIECE_CAPTURED" for event in captured.events)
    assert next(piece for piece in captured.state.pieces if piece.player_id == "p2").state == "yard"


def test_safe_cell_rejects_a_third_occupant_from_another_player():
    state = make_game_state(
        dice_values=(1, 4),
        track_by_player={"p1": (6,), "p2": (7,), "p3": (7,)},
    )

    options = GameRules().available_moves(state)

    assert not any(
        option.piece_id == "p1-piece-1" and option.dice_indices == (0,)
        for option in options
    )


def test_ordinary_cell_rejects_a_third_friendly_occupant():
    state = make_game_state(
        dice_values=(1, 4),
        track_by_player={"p1": (10, 11, 11)},
    )

    with pytest.raises(IllegalMoveError):
        GameRules().move_piece(state, "p1", "p1-piece-1", (0,))


def test_yard_exit_does_not_capture_a_lone_enemy_on_the_safe_start_cell():
    start = BoardFactory.create(4).start_cells_by_seat[0]
    state = make_game_state(
        dice_values=(5, 2),
        track_by_player={"p2": (start,)},
    )

    transition = GameRules().move_piece(state, "p1", "p1-piece-1", (0,))

    assert not any(event.type == "PIECE_CAPTURED" for event in transition.events)
    assert transition.state.pending_bonuses == []
    assert next(
        piece for piece in transition.state.pieces if piece.id == "p2-piece-1"
    ).track_position == start
    assert sum(
        piece.state == "track" and piece.track_position == start
        for piece in transition.state.pieces
    ) == 2


@pytest.mark.parametrize("seat_count", [4, 5, 6])
def test_each_player_exits_at_their_own_start_cell(seat_count):
    board = BoardFactory.create(seat_count)
    state = make_game_state(seat_count, dice_values=(5, 2))
    state.current_player_id = "p2"

    transition = GameRules().move_piece(state, "p2", "p2-piece-1", (0,))

    exited_piece = next(
        piece for piece in transition.state.pieces if piece.id == "p2-piece-1"
    )
    assert exited_piece.track_position == board.start_cells_by_seat[1]
    assert exited_piece.track_position != board.start_cells_by_seat[0]


def test_yard_exit_captures_the_most_recent_enemy_to_arrive():
    board = BoardFactory.create(4)
    start = board.start_cells_by_seat[0]
    rules = GameRules()
    state = make_game_state(
        dice_values=(5, 1),
        track_by_player={
            "p2": (start,),
            "p3": (start,),
        },
    )
    next(piece for piece in state.pieces if piece.id == "p2-piece-1").track_arrival_order = 4
    next(piece for piece in state.pieces if piece.id == "p3-piece-1").track_arrival_order = 5

    transition = rules.move_piece(state, "p1", "p1-piece-1", (0,))

    captured = [event for event in transition.events if event.type == "PIECE_CAPTURED"]
    assert len(captured) == 1
    assert captured[0].payload["capturedPieceId"] == "p3-piece-1"
    assert captured[0].payload["bonusSteps"] == 20
    assert transition.state.pending_bonuses == [PendingBonus("p1", 20, "capture")]
    assert next(
        piece for piece in transition.state.pieces if piece.id == "p2-piece-1"
    ).track_position == start
    assert next(
        piece for piece in transition.state.pieces if piece.id == "p3-piece-1"
    ).state == "yard"


def test_yard_exit_captures_one_enemy_from_a_blockade_on_its_start_cell():
    start = BoardFactory.create(4).start_cells_by_seat[0]
    state = make_game_state(
        dice_values=(5, 2),
        track_by_player={"p2": (start, start)},
    )

    transition = GameRules().move_piece(state, "p1", "p1-piece-1", (0,))

    assert sum(
        piece.player_id == "p2" and piece.state == "track" and piece.track_position == start
        for piece in transition.state.pieces
    ) == 1
    captured = [event for event in transition.events if event.type == "PIECE_CAPTURED"]
    assert len(captured) == 1
    assert captured[0].payload["capturedPieceId"] == "p2-piece-2"
    assert captured[0].payload["bonusSteps"] == 20
    assert transition.state.pending_bonuses == [PendingBonus("p1", 20, "capture")]
    assert sum(
        piece.state == "track" and piece.track_position == start
        for piece in transition.state.pieces
    ) == 2


def test_yard_exit_captures_enemy_beside_an_existing_friendly_piece():
    start = BoardFactory.create(4).start_cells_by_seat[0]
    state = make_game_state(
        dice_values=(5, 2),
        track_by_player={"p1": (start,), "p2": (start,)},
    )

    transition = GameRules().move_piece(state, "p1", "p1-piece-2", (0,))

    assert next(
        piece for piece in transition.state.pieces if piece.id == "p2-piece-1"
    ).state == "yard"
    assert sum(
        piece.player_id == "p1" and piece.state == "track" and piece.track_position == start
        for piece in transition.state.pieces
    ) == 2


def test_yard_exit_is_blocked_by_two_friendly_pieces_on_its_start_cell():
    start = BoardFactory.create(4).start_cells_by_seat[0]
    state = make_game_state(
        dice_values=(5, 2),
        track_by_player={"p1": (start, start)},
    )

    options = GameRules().available_moves(state)

    assert not any(option.piece_id == "p1-piece-3" and option.leaves_home for option in options)


def test_valid_move_consumes_only_selected_die_and_emits_destination():
    state = make_game_state(
        dice_values=(3, 4),
        track_by_player={"p1": (10,)},
    )

    transition = GameRules().move_piece(state, "p1", "p1-piece-1", (0,))

    moved = next(piece for piece in transition.state.pieces if piece.id == "p1-piece-1")
    assert moved.state == "track"
    assert moved.track_position == 13
    assert transition.state.used_dice_indices == [0]
    assert transition.state.turn_phase == "waiting_for_move"
    assert any(event.type == "PIECE_MOVED" for event in transition.events)
    move_event = next(event for event in transition.events if event.type == "PIECE_MOVED")
    assert move_event.payload["path"] == [
        {"state": "track", "trackPosition": 11, "finishProgress": None},
        {"state": "track", "trackPosition": 12, "finishProgress": None},
        {"state": "track", "trackPosition": 13, "finishProgress": None},
    ]
    assert state.used_dice_indices == []
    assert next(piece for piece in state.pieces if piece.id == "p1-piece-1").track_position == 10


def test_split_dice_moves_each_publish_an_independent_path():
    rules = GameRules()
    state = make_game_state(
        dice_values=(2, 4),
        track_by_player={"p1": (10, 40)},
    )

    first = rules.move_piece(state, "p1", "p1-piece-1", (0,))
    second = rules.move_piece(first.state, "p1", "p1-piece-2", (1,))

    first_path = next(event for event in first.events if event.type == "PIECE_MOVED").payload[
        "path"
    ]
    second_path = next(event for event in second.events if event.type == "PIECE_MOVED").payload[
        "path"
    ]
    assert [point["trackPosition"] for point in first_path] == [11, 12]
    assert [point["trackPosition"] for point in second_path] == [41, 42, 43, 44]


def test_double_roll_breaks_a_movable_own_blockade_with_one_die():
    state = make_game_state(dice_values=(3, 3), track_by_player={"p1": (20, 20)})

    transition = GameRules().move_piece(state, "p1", "p1-piece-1", (0,))

    assert transition.state.used_dice_indices == [0]
    assert transition.state.turn_phase == "waiting_for_move"
    assert transition.state.current_player_id == "p1"
    assert all(option.dice_indices == (1,) for option in transition.state.available_moves)


def test_double_roll_prioritizes_breaking_a_blockade_with_three_own_pieces():
    state = make_game_state(
        dice_values=(3, 3),
        track_by_player={"p1": (20, 20, 20, 40)},
    )

    options = GameRules().available_moves(state)

    assert options
    assert {option.piece_id for option in options} == {
        "p1-piece-1",
        "p1-piece-2",
        "p1-piece-3",
    }


def test_unopenable_own_blockade_does_not_hide_other_double_moves():
    state = make_game_state(
        dice_values=(3, 3),
        track_by_player={"p1": (20, 20, 40), "p2": (23, 23)},
    )

    options = GameRules().available_moves(state)

    assert options
    assert all(option.piece_id == "p1-piece-3" for option in options)


def test_blockade_rule_can_be_disabled_by_game_configuration():
    state = make_game_state(
        dice_values=(4, 2),
        track_by_player={"p1": (10,), "p2": (12, 12)},
    )

    options = GameRules(
        config=GameRulesConfig(blockades_enabled=False)
    ).available_moves(state)

    assert any(
        option.piece_id == "p1-piece-1" and option.dice_indices == (0,)
        for option in options
    )


def test_capture_grants_exactly_twenty_steps_and_keeps_remaining_die_active():
    state = make_game_state(
        dice_values=(1, 2),
        track_by_player={"p1": (10,), "p2": (11,)},
    )

    after_capture = GameRules().move_piece(state, "p1", "p1-piece-1", (0,))

    assert after_capture.state.pending_bonuses == [PendingBonus("p1", 20, "capture")]
    assert after_capture.state.turn_phase == "waiting_for_move"
    assert after_capture.state.used_dice_indices == [0]
    moved = next(event for event in after_capture.events if event.type == "PIECE_MOVED")
    captured = next(event for event in after_capture.events if event.type == "PIECE_CAPTURED")
    assert moved.payload["path"][-1] == moved.payload["to"]
    assert moved.payload["path"] == [
        {"state": "track", "trackPosition": 11, "finishProgress": None}
    ]
    assert after_capture.events.index(moved) < after_capture.events.index(captured)


def test_single_six_does_not_grant_extra_turn_but_doubles_do():
    single_rules = GameRules(dice=SequenceDice([(6, 2)]))
    double_rules = GameRules(dice=SequenceDice([(4, 4)]))
    single_six = single_rules.roll_dice(
        single_rules.new_game("AB7K2", make_players(4)),
        "p1",
    )
    double = double_rules.roll_dice(
        double_rules.new_game("CD3E4", make_players(4)),
        "p1",
    )

    assert single_six.state.current_player_id == "p2"
    assert double.state.current_player_id == "p1"
    assert double.state.turn_phase == "waiting_for_roll"


def test_bonus_move_uses_exact_steps_without_consuming_dice_again():
    state = make_game_state(
        dice_values=(1, 2),
        track_by_player={"p1": (10,)},
        pending_bonuses=(PendingBonus("p1", 20, "capture"),),
        turn_phase="waiting_for_bonus",
    )
    state.used_dice_indices = [0, 1]

    transition = GameRules().move_bonus_piece(state, "p1", "p1-piece-1")

    moved = next(piece for piece in transition.state.pieces if piece.id == "p1-piece-1")
    assert moved.track_position == 30
    bonus_move = next(event for event in transition.events if event.type == "PIECE_MOVED")
    assert bonus_move.payload["diceIndices"] == ()
    assert [point["trackPosition"] for point in bonus_move.payload["path"]] == list(
        range(11, 31)
    )
    assert bonus_move.payload["path"][-1] == bonus_move.payload["to"]
    assert transition.state.used_dice_indices == []
    assert transition.state.dice_values is None
    assert transition.state.pending_bonuses == []
    assert transition.state.turn_phase == "waiting_for_roll"
    assert transition.state.current_player_id == "p2"


def test_bonus_capture_queues_another_bonus_before_turn_closes():
    state = make_game_state(
        dice_values=(2, 3),
        track_by_player={"p1": (10,), "p2": (30,)},
        pending_bonuses=(PendingBonus("p1", 20, "capture"),),
        turn_phase="waiting_for_bonus",
    )
    state.used_dice_indices = [0, 1]

    transition = GameRules().move_bonus_piece(state, "p1", "p1-piece-1")

    assert next(piece for piece in transition.state.pieces if piece.id == "p2-piece-1").state == "yard"
    assert transition.state.pending_bonuses == [PendingBonus("p1", 20, "capture")]
    assert transition.state.turn_phase == "waiting_for_bonus"
    assert transition.state.current_player_id == "p1"
    assert any(event.type == "PIECE_CAPTURED" for event in transition.events)


def test_bonus_move_rejects_an_opponent_piece_without_mutating_state():
    state = make_game_state(
        track_by_player={"p1": (10,), "p2": (12,)},
        pending_bonuses=(PendingBonus("p1", 20, "capture"),),
        turn_phase="waiting_for_bonus",
    )
    before = copy.deepcopy(state)

    with pytest.raises(IllegalMoveError, match="bonus move"):
        GameRules().move_bonus_piece(state, "p1", "p2-piece-1")

    assert state == before


def test_goal_bonus_is_skipped_when_all_pieces_are_already_finished():
    state = make_game_state(
        dice_values=(1, 2),
        finished_by_player={"p1": 3},
    )
    final_piece = next(piece for piece in state.pieces if piece.id == "p1-piece-4")
    final_piece.state = "finish_path"
    final_piece.finish_progress = 4
    rules = GameRules()
    state.available_moves = list(rules.available_moves(state))

    first = rules.move_piece(state, "p1", "p1-piece-4", (0,))
    second = rules.move_piece(first.state, "p1", "p1-piece-4", (1,))

    assert second.state.finish_order == ["p1"]
    assert second.state.pending_bonuses == []
    assert second.state.current_player_id == "p2"
    assert any(event.type == "BONUS_SKIPPED" for event in second.events)
    assert any(
        event.type == "BONUS_GRANTED"
        and event.payload == {"playerId": "p1", "steps": 10, "reason": "goal"}
        for event in second.events
    )


def test_bonus_chain_finishes_match_at_penultimate_player():
    entry = BoardFactory.create(4).goal_entry_cells_by_seat[2]
    state = make_game_state(
        finished_by_player={"p1": 4, "p2": 4, "p3": 3},
        track_by_player={"p3": ((entry - 2) % 68,)},
        finish_order=("p1", "p2"),
        pending_bonuses=(PendingBonus("p3", 10, "goal"),),
        turn_phase="waiting_for_bonus",
    )
    state.current_player_id = "p3"

    transition = GameRules().move_bonus_piece(state, "p3", "p3-piece-4")

    assert transition.state.finish_order == ["p1", "p2", "p3"]
    assert transition.state.status == "finished"
    assert transition.state.winner_id == "p1"
    assert transition.state.result.placements[-1].rank == 4
