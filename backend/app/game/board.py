from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal, Mapping


SeatCount = Literal[4, 5, 6]


@dataclass(frozen=True, slots=True)
class BoardDefinition:
    seat_count: SeatCount
    track_length: int
    board_path: tuple[int, ...]
    start_cells_by_seat: Mapping[int, int]
    goal_entry_cells_by_seat: Mapping[int, int]
    safe_cells: frozenset[int]
    home_paths_by_seat: Mapping[int, tuple[str, ...]]
    finish_cells_by_seat: Mapping[int, tuple[str, ...]]


class BoardFactory:
    @staticmethod
    def create(seat_count: SeatCount) -> BoardDefinition:
        if type(seat_count) is not int or seat_count not in (4, 5, 6):
            raise ValueError("seat_count must be 4, 5, or 6")

        track_length = 17 * seat_count
        starts = {seat: seat * 17 for seat in range(seat_count)}
        entries = {
            seat: (starts[seat] - 5) % track_length
            for seat in range(seat_count)
        }
        safe_cells = frozenset(
            (starts[seat] + offset) % track_length
            for seat in range(seat_count)
            for offset in (0, 7, -5)
        )

        return BoardDefinition(
            seat_count=seat_count,
            track_length=track_length,
            board_path=tuple(range(track_length)),
            start_cells_by_seat=MappingProxyType(starts),
            goal_entry_cells_by_seat=MappingProxyType(entries),
            safe_cells=safe_cells,
            home_paths_by_seat=MappingProxyType(
                {
                    seat: tuple(f"home:{seat}:{node}" for node in range(4))
                    for seat in range(seat_count)
                }
            ),
            finish_cells_by_seat=MappingProxyType(
                {
                    seat: tuple(f"finish:{seat}:{node}" for node in range(7))
                    for seat in range(seat_count)
                }
            ),
        )
