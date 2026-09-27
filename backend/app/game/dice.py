import secrets
from typing import Protocol


class DiceSource(Protocol):
    def roll_pair(self) -> tuple[int, int]: ...


class SecureDiceSource:
    def __init__(self, die_sides: int = 6) -> None:
        if type(die_sides) is not int or die_sides < 2:
            raise ValueError("die_sides must be an integer greater than one")
        self._die_sides = die_sides

    def roll_pair(self) -> tuple[int, int]:
        return (
            secrets.randbelow(self._die_sides) + 1,
            secrets.randbelow(self._die_sides) + 1,
        )
