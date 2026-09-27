import pytest

from app.game.board import BoardFactory


@pytest.mark.parametrize("seat_count", [4, 5, 6])
def test_board_defines_symmetric_logical_tracks(seat_count):
    board = BoardFactory.create(seat_count)

    assert board.track_length == 17 * seat_count
    assert board.board_path == tuple(range(board.track_length))
    assert board.start_cells_by_seat == {
        seat: seat * 17 for seat in range(seat_count)
    }
    assert len(board.safe_cells) == 3 * seat_count
    assert all(len(board.home_paths_by_seat[seat]) == 4 for seat in range(seat_count))
    assert all(
        len(board.finish_cells_by_seat[seat]) == 7 for seat in range(seat_count)
    )

    for seat in range(seat_count):
        assert board.goal_entry_cells_by_seat[seat] == (
            board.start_cells_by_seat[seat] - 5
        ) % board.track_length
        assert board.start_cells_by_seat[seat] in board.safe_cells
        assert (
            board.start_cells_by_seat[seat] + 7
        ) % board.track_length in board.safe_cells
        assert board.goal_entry_cells_by_seat[seat] in board.safe_cells


@pytest.mark.parametrize("seat_count", [0, 3, 7])
def test_board_rejects_unsupported_seat_count(seat_count):
    with pytest.raises(ValueError, match="seat_count"):
        BoardFactory.create(seat_count)
