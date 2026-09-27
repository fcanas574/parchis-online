from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Mapping
from typing import TYPE_CHECKING, Literal

from app.game.models import (
    GameParticipant,
    GameState,
    PendingBonus,
    PieceState,
    RoomCredentialData,
    SessionIdentity,
    TurnPhase,
)
from app.game.rules import GameRules

if TYPE_CHECKING:
    from app.services.room_manager import RoomManager


class SequenceDice:
    def __init__(self, rolls: Iterable[tuple[int, int]]) -> None:
        self._rolls = deque(rolls)

    def roll_pair(self) -> tuple[int, int]:
        if not self._rolls:
            raise RuntimeError("No deterministic dice rolls remain")
        return self._rolls.popleft()


def make_players(seat_count: int) -> tuple[GameParticipant, ...]:
    if type(seat_count) is not int or seat_count not in (4, 5, 6):
        raise ValueError("seat_count must be 4, 5, or 6")
    return tuple(
        GameParticipant(id=f"p{seat + 1}", seat_index=seat)
        for seat in range(seat_count)
    )


async def create_ready_room(
    manager: RoomManager,
    seat_count: Literal[4, 5, 6],
) -> list[RoomCredentialData]:
    colors = ("green", "red", "blue", "yellow", "purple", "orange")
    players = [await manager.create_room("Player 1", seat_count, colors[0])]
    for seat in range(1, seat_count):
        players.append(
            await manager.join_room(
                players[0].room_code,
                f"Player {seat + 1}",
                colors[seat],
            )
        )
    for player in players:
        await manager.set_ready(
            SessionIdentity(player.room_code, player.player_id),
            True,
            f"ready-{player.player_id}",
        )
    return players


def make_game_state(
    seat_count: int = 4,
    *,
    dice_values: tuple[int, int] | None = (1, 1),
    track_by_player: Mapping[str, tuple[int, ...]] | None = None,
    finished_by_player: Mapping[str, int] | None = None,
    finish_order: tuple[str, ...] = (),
    pending_bonuses: tuple[PendingBonus, ...] = (),
    turn_phase: TurnPhase = "waiting_for_move",
) -> GameState:
    players = make_players(seat_count)
    track_positions = track_by_player or {}
    finished_counts = finished_by_player or {}
    pieces: list[PieceState] = []

    for player in players:
        finished_count = finished_counts.get(player.id, 0)
        positions = track_positions.get(player.id, ())
        if not 0 <= finished_count <= 4 or len(positions) > 4 - finished_count:
            raise ValueError("piece fixture counts must fit within four pieces")

        for number in range(4):
            position_index = number - finished_count
            if number < finished_count:
                piece = PieceState(
                    f"{player.id}-piece-{number + 1}",
                    player.id,
                    "finished",
                    None,
                    None,
                )
            elif position_index < len(positions):
                piece = PieceState(
                    f"{player.id}-piece-{number + 1}",
                    player.id,
                    "track",
                    positions[position_index],
                    None,
                )
            else:
                piece = PieceState(
                    f"{player.id}-piece-{number + 1}",
                    player.id,
                    "yard",
                    None,
                    None,
                )
            pieces.append(piece)

    state = GameState(
        room_code="AB7K2",
        seat_count=seat_count,
        player_order=[player.id for player in players],
        status="playing",
        current_player_id="p1",
        turn_phase=turn_phase,
        dice_values=dice_values,
        used_dice_indices=[],
        available_moves=[],
        pending_bonuses=list(pending_bonuses),
        pieces=pieces,
        finish_order=list(finish_order),
        winner_id=None,
        result=None,
        requires_split_plan=False,
    )
    if dice_values is not None:
        state.available_moves = list(GameRules().available_moves(state))
    return state
