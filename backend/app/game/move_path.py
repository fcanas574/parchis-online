"""Pure logical traces for already-authorized piece movements."""

from app.game.board import BoardDefinition
from app.game.models import PiecePosition


def trace_move(
    board: BoardDefinition,
    seat_index: int,
    origin: PiecePosition,
    destination: PiecePosition,
    steps: int,
) -> tuple[PiecePosition, ...]:
    """Return every logical position after ``origin`` through ``destination``.

    This function does not decide whether a move is legal. It only traces a move
    already selected by ``GameRules`` and fails closed if its inputs disagree.
    Leaving the yard is represented by one visible step, regardless of the die
    value used to authorize the exit.
    """
    if type(seat_index) is not int or seat_index not in board.start_cells_by_seat:
        raise ValueError("seat_index is not defined for this board")
    if type(steps) is not int or steps <= 0:
        raise ValueError("steps must be a positive integer")

    if origin.state == "yard":
        if origin.track_position is not None or origin.finish_progress is not None:
            raise ValueError("yard origin cannot include a track or finish position")
        expected = PiecePosition(
            "track",
            board.start_cells_by_seat[seat_index],
            None,
        )
        if destination != expected:
            raise ValueError("destination disagrees with yard exit")
        return (expected,)

    path: list[PiecePosition] = []
    current = origin
    finish_path_length = len(board.finish_cells_by_seat[seat_index])

    if origin.state == "track":
        if (
            origin.track_position is None
            or not 0 <= origin.track_position < board.track_length
            or origin.finish_progress is not None
        ):
            raise ValueError("track origin has an invalid position")
        goal_entry = board.goal_entry_cells_by_seat[seat_index]
        for _ in range(steps):
            if current.state == "finish_path" and current.finish_progress is not None:
                progress = current.finish_progress + 1
                if progress == finish_path_length:
                    current = PiecePosition("finished", None, None)
                else:
                    current = PiecePosition("finish_path", None, progress)
            elif current.state == "track" and current.track_position is not None:
                if current.track_position == goal_entry:
                    current = PiecePosition("finish_path", None, 0)
                else:
                    current = PiecePosition(
                        "track",
                        (current.track_position + 1) % board.track_length,
                        None,
                    )
            else:
                raise ValueError("move continues after reaching the finish")
            path.append(current)
    elif origin.state == "finish_path":
        if (
            origin.track_position is not None
            or origin.finish_progress is None
            or not 0 <= origin.finish_progress < finish_path_length
        ):
            raise ValueError("finish-path origin has an invalid position")
        for _ in range(steps):
            if current.state != "finish_path" or current.finish_progress is None:
                raise ValueError("move continues after reaching the finish")
            progress = current.finish_progress + 1
            if progress == finish_path_length:
                current = PiecePosition("finished", None, None)
            else:
                current = PiecePosition("finish_path", None, progress)
            path.append(current)
    else:
        raise ValueError("a finished piece cannot be moved")

    if not path or path[-1] != destination:
        raise ValueError("destination disagrees with traced movement")
    return tuple(path)
