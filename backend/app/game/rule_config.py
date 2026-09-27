from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True, slots=True)
class GameRulesConfig:
    pieces_per_player: int = 4
    dice_count: int = 2
    die_sides: int = 6
    exit_value: int = 5
    exact_finish: bool = True
    capture_bonus_steps: int = 20
    goal_bonus_steps: int = 10
    blockades_enabled: bool = True
    blockade_size: int = 2
    extra_turn_condition: Literal["doubles"] = "doubles"
