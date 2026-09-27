from app.game.models import GameState, MoveOption


class NoLegalMoveError(ValueError):
    """Raised when the game engine offers no action for the autopilot."""


class AutopilotPolicy:
    """Choose a predictable action without duplicating any game rules."""

    def choose_move(self, state: GameState) -> MoveOption:
        if not state.available_moves:
            raise NoLegalMoveError("The game engine did not offer a legal move.")
        return min(state.available_moves, key=self._priority_key)

    def choose_bonus_move(self, state: GameState) -> str | None:
        if (
            state.status != "playing"
            or state.turn_phase != "waiting_for_bonus"
            or not state.pending_bonuses
            or state.current_player_id != state.pending_bonuses[0].player_id
            or not state.available_moves
        ):
            return None
        return min(state.available_moves, key=self._priority_key).piece_id

    @staticmethod
    def _priority_key(option: MoveOption) -> tuple[object, ...]:
        destination = option.destination
        return (
            -int(option.completes_piece),
            -int(option.captures),
            -int(option.lands_safe),
            -int(option.leaves_home),
            -option.progress,
            option.piece_id,
            option.dice_indices,
            destination.state,
            destination.track_position
            if destination.track_position is not None
            else -1,
            destination.finish_progress
            if destination.finish_progress is not None
            else -1,
        )
