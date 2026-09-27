import pytest

from app.game.board import BoardFactory
from app.game.models import PiecePosition
from app.game.move_path import trace_move


@pytest.mark.parametrize("seat_count", [4, 5, 6])
def test_yard_exit_is_one_visible_step_to_the_player_start(seat_count):
    board = BoardFactory.create(seat_count)
    seat_index = seat_count - 1
    destination = PiecePosition(
        "track",
        board.start_cells_by_seat[seat_index],
        None,
    )

    path = trace_move(
        board,
        seat_index,
        PiecePosition("yard", None, None),
        destination,
        steps=5,
    )

    assert path == (destination,)


@pytest.mark.parametrize("seat_count", [4, 5, 6])
def test_track_trace_wraps_at_the_end_of_each_board(seat_count):
    board = BoardFactory.create(seat_count)
    destination = PiecePosition("track", 1, None)

    path = trace_move(
        board,
        seat_index=0,
        origin=PiecePosition("track", board.track_length - 2, None),
        destination=destination,
        steps=3,
    )

    assert path == (
        PiecePosition("track", board.track_length - 1, None),
        PiecePosition("track", 0, None),
        destination,
    )


def test_ordinary_track_trace_visits_each_cell_between_origin_and_destination():
    board = BoardFactory.create(4)
    destination = PiecePosition("track", 13, None)

    path = trace_move(
        board,
        seat_index=0,
        origin=PiecePosition("track", 10, None),
        destination=destination,
        steps=3,
    )

    assert path == (
        PiecePosition("track", 11, None),
        PiecePosition("track", 12, None),
        destination,
    )


def test_track_trace_enters_finish_lane_after_passing_goal_entry():
    board = BoardFactory.create(4)
    seat_index = 1
    goal_entry = board.goal_entry_cells_by_seat[seat_index]
    origin = PiecePosition("track", (goal_entry - 2) % board.track_length, None)
    destination = PiecePosition("finish_path", None, 0)

    path = trace_move(board, seat_index, origin, destination, steps=3)

    assert path == (
        PiecePosition("track", (goal_entry - 1) % board.track_length, None),
        PiecePosition("track", goal_entry, None),
        destination,
    )


def test_finish_lane_trace_includes_the_final_finished_step():
    board = BoardFactory.create(4)
    origin = PiecePosition("finish_path", None, 4)
    destination = PiecePosition("finished", None, None)

    path = trace_move(board, 0, origin, destination, steps=3)

    assert path == (
        PiecePosition("finish_path", None, 5),
        PiecePosition("finish_path", None, 6),
        destination,
    )


def test_twenty_step_bonus_returns_every_intermediate_position():
    board = BoardFactory.create(4)
    seat_index = 2
    goal_entry = board.goal_entry_cells_by_seat[seat_index]
    origin = PiecePosition("track", 10, None)
    destination = PiecePosition("finish_path", None, 0)

    path = trace_move(board, seat_index, origin, destination, steps=20)

    assert len(path) == 20
    assert path[-1] == destination
    assert path[-2] == PiecePosition("track", goal_entry, None)


def test_trace_rejects_a_destination_that_disagrees_with_the_supplied_move():
    board = BoardFactory.create(4)

    with pytest.raises(ValueError, match="destination"):
        trace_move(
            board,
            seat_index=0,
            origin=PiecePosition("track", 10, None),
            destination=PiecePosition("track", 99, None),
            steps=3,
        )
