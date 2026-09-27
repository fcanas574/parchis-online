from copy import deepcopy
from dataclasses import replace

from app.game.board import BoardDefinition, BoardFactory
from app.game.dice import DiceSource, SecureDiceSource
from app.game.models import (
    DomainEvent,
    GameResult,
    GameParticipant,
    GameState,
    GameTransition,
    MoveOption,
    PendingBonus,
    PiecePosition,
    PieceState,
    PlayerPlacement,
)
from app.game.move_path import trace_move
from app.game.rule_config import GameRulesConfig


class IllegalMoveError(ValueError):
    """Raised when a game action violates the current authoritative state."""


class GameRules:
    def __init__(
        self,
        dice: DiceSource | None = None,
        config: GameRulesConfig | None = None,
    ) -> None:
        self.config = config or GameRulesConfig()
        self._dice = dice or SecureDiceSource(self.config.die_sides)

    def new_game(
        self,
        room_code: str,
        players: tuple[GameParticipant, ...] | list[GameParticipant],
    ) -> GameState:
        if len(players) not in (4, 5, 6):
            raise ValueError("a game requires 4, 5, or 6 players")
        ordered = tuple(sorted(players, key=lambda player: player.seat_index))
        if [player.seat_index for player in ordered] != list(range(len(ordered))):
            raise ValueError("player seat indices must be unique and contiguous")
        if len({player.id for player in ordered}) != len(ordered):
            raise ValueError("player IDs must be unique")

        pieces = [
            PieceState(
                id=f"{player.id}-piece-{number + 1}",
                player_id=player.id,
                state="yard",
                track_position=None,
                finish_progress=None,
            )
            for player in ordered
            for number in range(self.config.pieces_per_player)
        ]
        return GameState(
            room_code=room_code,
            seat_count=len(ordered),
            player_order=[player.id for player in ordered],
            status="playing",
            current_player_id=ordered[0].id,
            turn_phase="waiting_for_roll",
            dice_values=None,
            used_dice_indices=[],
            available_moves=[],
            pending_bonuses=[],
            pieces=pieces,
            finish_order=[],
            winner_id=None,
            result=None,
            requires_split_plan=False,
        )

    def can_leave_home(self, steps: int) -> bool:
        return steps == self.config.exit_value

    def enter_finish_path(
        self,
        state: GameState,
        piece: PieceState,
        steps: int,
    ) -> PiecePosition | None:
        if steps < 0:
            return None
        if piece.state == "finish_path":
            if piece.finish_progress is None:
                return None
            destination_progress = piece.finish_progress + steps
            if destination_progress < len(
                BoardFactory.create(state.seat_count).finish_cells_by_seat[
                    state.player_order.index(piece.player_id)
                ]
            ):
                return PiecePosition("finish_path", None, destination_progress)
            if destination_progress == len(
                BoardFactory.create(state.seat_count).finish_cells_by_seat[
                    state.player_order.index(piece.player_id)
                ]
            ):
                return PiecePosition("finished", None, None)
            return None
        if piece.state != "track" or piece.track_position is None:
            return None

        board = BoardFactory.create(state.seat_count)
        seat_index = state.player_order.index(piece.player_id)
        entry_cell = board.goal_entry_cells_by_seat[seat_index]
        distance_to_entry = (
            entry_cell - piece.track_position
        ) % board.track_length
        steps_to_finish_lane = distance_to_entry + 1
        if steps < steps_to_finish_lane:
            return PiecePosition(
                "track",
                (piece.track_position + steps) % board.track_length,
                None,
            )

        finish_progress = steps - steps_to_finish_lane
        finish_length = len(board.finish_cells_by_seat[seat_index])
        if finish_progress < finish_length:
            return PiecePosition("finish_path", None, finish_progress)
        if finish_progress == finish_length:
            return PiecePosition("finished", None, None)
        return None

    def available_moves(self, state: GameState) -> tuple[MoveOption, ...]:
        if (
            state.status != "playing"
            or state.turn_phase != "waiting_for_move"
            or state.current_player_id is None
            or state.dice_values is None
        ):
            return ()

        remaining_indices = tuple(
            index
            for index in range(2)
            if index not in state.used_dice_indices
        )
        if not remaining_indices:
            return ()

        single_options = self._single_die_options(state, remaining_indices)
        sum_options: list[MoveOption] = []
        if len(remaining_indices) == 2:
            sum_steps = sum(state.dice_values[index] for index in remaining_indices)
            sum_options = self._options_for_steps(
                state,
                remaining_indices,
                sum_steps,
            )

        forced_single_exits = [
            option for option in single_options if option.leaves_home
        ]
        if forced_single_exits:
            return tuple(self._sort_options(forced_single_exits))

        forced_sum_exits = [option for option in sum_options if option.leaves_home]
        if forced_sum_exits:
            return tuple(self._sort_options(forced_sum_exits))

        if len(remaining_indices) == 2:
            if (
                not state.used_dice_indices
                and state.dice_values[0] == state.dice_values[1]
            ):
                blockade_options = self._blockade_break_options(
                    state,
                    single_options,
                )
                if blockade_options:
                    completable_blockade_options: list[MoveOption] = []
                    for first in blockade_options:
                        simulated = self._simulate_option(state, first)
                        second_indices = tuple(
                            index
                            for index in remaining_indices
                            if index not in first.dice_indices
                        )
                        if self._single_die_options(simulated, second_indices):
                            completable_blockade_options.append(
                                replace(first, completes_split_plan=True)
                            )
                    return tuple(
                        self._sort_options(
                            completable_blockade_options or blockade_options
                        )
                    )

            completable_first_moves: list[MoveOption] = []
            for first in single_options:
                simulated = self._simulate_option(state, first)
                used_after = set(state.used_dice_indices) | set(first.dice_indices)
                second_indices = tuple(
                    index for index in remaining_indices if index not in used_after
                )
                if self._single_die_options(simulated, second_indices):
                    completable_first_moves.append(
                        replace(first, completes_split_plan=True)
                    )
            if completable_first_moves:
                return tuple(self._sort_options(completable_first_moves))

            return tuple(self._sort_options([*single_options, *sum_options]))

        return tuple(self._sort_options(single_options))

    def move_piece(
        self,
        state: GameState,
        player_id: str,
        piece_id: str,
        dice_indices: tuple[int, ...],
    ) -> GameTransition:
        option = self._require_current_legal_option(
            state,
            player_id,
            piece_id,
            dice_indices,
        )
        next_state = deepcopy(state)
        events = self._apply_option(next_state, option)
        events.extend(self._settle_after_dice_move(next_state))
        return GameTransition(next_state, tuple(events))

    def available_bonus_moves(self, state: GameState) -> tuple[MoveOption, ...]:
        if (
            state.status != "playing"
            or state.turn_phase != "waiting_for_bonus"
            or state.current_player_id is None
            or not state.pending_bonuses
        ):
            return ()
        bonus = state.pending_bonuses[0]
        if bonus.player_id != state.current_player_id:
            return ()
        return tuple(
            self._sort_options(
                self._options_for_steps(state, (), bonus.steps)
            )
        )

    def move_bonus_piece(
        self,
        state: GameState,
        player_id: str,
        piece_id: str,
    ) -> GameTransition:
        if state.status != "playing":
            raise IllegalMoveError("The game is not active.")
        if state.current_player_id != player_id:
            raise IllegalMoveError("It is not this player's turn.")
        if state.turn_phase != "waiting_for_bonus" or not state.pending_bonuses:
            raise IllegalMoveError("The game is not waiting for a bonus move.")
        if state.pending_bonuses[0].player_id != player_id:
            raise IllegalMoveError("The pending bonus belongs to another player.")

        option = next(
            (
                candidate
                for candidate in self.available_bonus_moves(state)
                if candidate.piece_id == piece_id
            ),
            None,
        )
        if option is None:
            raise IllegalMoveError("The selected piece cannot make that bonus move.")

        next_state = deepcopy(state)
        next_state.pending_bonuses.pop(0)
        events = self._apply_option(next_state, option)
        events.extend(self._resolve_pending_bonuses(next_state))
        return GameTransition(next_state, tuple(events))

    def roll_dice(self, state: GameState, player_id: str) -> GameTransition:
        if state.status != "playing":
            raise IllegalMoveError("The game is not active.")
        if state.current_player_id != player_id:
            raise IllegalMoveError("It is not this player's turn.")
        if state.turn_phase != "waiting_for_roll":
            raise IllegalMoveError("The dice have already been rolled this turn.")

        values = self._dice.roll_pair()
        if (
            not isinstance(values, tuple)
            or len(values) != self.config.dice_count
            or any(type(value) is not int or not 1 <= value <= self.config.die_sides for value in values)
        ):
            raise ValueError("dice source must return two valid dice values")

        next_state = deepcopy(state)
        next_state.dice_values = values
        next_state.used_dice_indices = []
        next_state.turn_phase = "waiting_for_move"
        next_state.requires_split_plan = False
        next_state.available_moves = list(self.available_moves(next_state))
        events = [
            DomainEvent(
                "DICE_ROLLED",
                {
                    "playerId": player_id,
                    "values": values,
                    "availableMoves": tuple(next_state.available_moves),
                },
            )
        ]

        if next_state.available_moves:
            next_state.requires_split_plan = any(
                option.completes_split_plan for option in next_state.available_moves
            )
        else:
            next_state.used_dice_indices = list(range(self.config.dice_count))
            next_state.requires_split_plan = False
            events.extend(self._resolve_pending_bonuses(next_state))

        return GameTransition(next_state, tuple(events))

    def _single_die_options(
        self,
        state: GameState,
        dice_indices: tuple[int, ...],
    ) -> list[MoveOption]:
        if state.dice_values is None or state.current_player_id is None:
            return []
        options: list[MoveOption] = []
        pieces = [
            piece
            for piece in state.pieces
            if piece.player_id == state.current_player_id
            and piece.state not in ("finished",)
        ]
        for dice_index in dice_indices:
            steps = state.dice_values[dice_index]
            options.extend(
                self._options_for_steps(state, (dice_index,), steps, pieces=pieces)
            )
        return options

    def _blockade_break_options(
        self,
        state: GameState,
        single_options: list[MoveOption],
    ) -> list[MoveOption]:
        if not self.config.blockades_enabled:
            return []
        player_id = state.current_player_id
        if player_id is None:
            return []

        occupants_by_cell: dict[int, list[PieceState]] = {}
        for piece in state.pieces:
            if piece.state == "track" and piece.track_position is not None:
                occupants_by_cell.setdefault(piece.track_position, []).append(piece)

        breakable_piece_ids: set[str] = set()
        for pieces in occupants_by_cell.values():
            own_pieces = [piece for piece in pieces if piece.player_id == player_id]
            if len(own_pieces) >= self.config.blockade_size:
                breakable_piece_ids.update(piece.id for piece in own_pieces)

        return [
            option
            for option in single_options
            if option.piece_id in breakable_piece_ids
            and len(option.dice_indices) == 1
        ]

    def _require_current_legal_option(
        self,
        state: GameState,
        player_id: str,
        piece_id: str,
        dice_indices: tuple[int, ...],
    ) -> MoveOption:
        if state.status != "playing":
            raise IllegalMoveError("The game is not active.")
        if state.current_player_id != player_id:
            raise IllegalMoveError("It is not this player's turn.")
        if state.turn_phase != "waiting_for_move":
            raise IllegalMoveError("The game is not waiting for a piece move.")
        if (
            not isinstance(dice_indices, tuple)
            or dice_indices not in ((0,), (1,), (0, 1))
        ):
            raise IllegalMoveError("Dice indices do not describe a valid move.")

        option = next(
            (
                candidate
                for candidate in self.available_moves(state)
                if candidate.piece_id == piece_id
                and candidate.dice_indices == dice_indices
            ),
            None,
        )
        if option is None:
            raise IllegalMoveError("The selected piece cannot make that move.")
        return option

    def _apply_option(
        self,
        state: GameState,
        option: MoveOption,
    ) -> list[DomainEvent]:
        piece = next(piece for piece in state.pieces if piece.id == option.piece_id)
        previous = PiecePosition(piece.state, piece.track_position, piece.finish_progress)
        seat_index = state.player_order.index(piece.player_id)
        path = trace_move(
            BoardFactory.create(state.seat_count),
            seat_index,
            previous,
            option.destination,
            option.steps,
        )
        piece.state = option.destination.state
        piece.track_position = option.destination.track_position
        piece.finish_progress = option.destination.finish_progress
        if option.destination.state == "track":
            self._mark_track_arrival(state, piece)
        else:
            piece.track_arrival_order = None

        events = [
            DomainEvent(
                "PIECE_MOVED",
                {
                    "pieceId": piece.id,
                    "from": self._public_position(previous),
                    "to": self._public_position(option.destination),
                    "diceIndices": option.dice_indices,
                    "path": [self._public_position(position) for position in path],
                },
            )
        ]
        if option.capture_piece_id is not None:
            captured = next(
                candidate
                for candidate in state.pieces
                if candidate.id == option.capture_piece_id
            )
            captured.state = "yard"
            captured.track_position = None
            captured.finish_progress = None
            captured.track_arrival_order = None
            events.append(
                DomainEvent(
                    "PIECE_CAPTURED",
                    {
                        "capturedPieceId": captured.id,
                        "byPieceId": piece.id,
                        "bonusSteps": self.config.capture_bonus_steps,
                    },
                )
            )
            if self.config.capture_bonus_steps > 0:
                bonus = PendingBonus(
                    player_id=piece.player_id,
                    steps=self.config.capture_bonus_steps,
                    reason="capture",
                )
                state.pending_bonuses.append(bonus)
                events.append(self._bonus_granted_event(bonus))

        if option.destination.state == "finished":
            if self.config.goal_bonus_steps > 0:
                bonus = PendingBonus(
                    player_id=piece.player_id,
                    steps=self.config.goal_bonus_steps,
                    reason="goal",
                )
                state.pending_bonuses.append(bonus)
                events.append(self._bonus_granted_event(bonus))
            events.extend(self._record_player_finished(state, piece.player_id))

        state.used_dice_indices = sorted(
            set(state.used_dice_indices) | set(option.dice_indices)
        )
        return events

    def _settle_after_dice_move(self, state: GameState) -> list[DomainEvent]:
        if state.status != "playing":
            return []
        state.available_moves = list(self.available_moves(state))
        state.requires_split_plan = any(
            option.completes_split_plan for option in state.available_moves
        )
        if state.available_moves:
            return []

        state.used_dice_indices = list(range(self.config.dice_count))
        state.requires_split_plan = False
        return self._resolve_pending_bonuses(state)

    def _resolve_pending_bonuses(self, state: GameState) -> list[DomainEvent]:
        events: list[DomainEvent] = []
        while state.status == "playing" and state.pending_bonuses:
            bonus = state.pending_bonuses[0]
            if bonus.player_id != state.current_player_id:
                state.pending_bonuses.pop(0)
                events.append(
                    DomainEvent(
                        "BONUS_SKIPPED",
                        {
                            "playerId": bonus.player_id,
                            "steps": bonus.steps,
                            "reason": bonus.reason,
                            "skipReason": "player_not_active",
                        },
                    )
                )
                continue

            state.turn_phase = "waiting_for_bonus"
            state.available_moves = list(self.available_bonus_moves(state))
            state.requires_split_plan = False
            if state.available_moves:
                return events

            state.pending_bonuses.pop(0)
            events.append(
                DomainEvent(
                    "BONUS_SKIPPED",
                    {
                        "playerId": bonus.player_id,
                        "steps": bonus.steps,
                        "reason": bonus.reason,
                        "skipReason": "no_legal_moves",
                    },
                )
            )

        if state.status == "playing":
            events.extend(self._close_turn(state))
        return events

    def _record_player_finished(
        self,
        state: GameState,
        player_id: str,
    ) -> list[DomainEvent]:
        if player_id in state.finish_order or any(
            piece.player_id == player_id and piece.state != "finished"
            for piece in state.pieces
        ):
            return []

        state.finish_order.append(player_id)
        events = [
            DomainEvent(
                "PLAYER_FINISHED",
                {"playerId": player_id, "rank": len(state.finish_order)},
            )
        ]
        if len(state.finish_order) < state.seat_count - 1:
            return events

        remaining_player_id = next(
            (
                candidate
                for candidate in state.player_order
                if candidate not in state.finish_order
            ),
            None,
        )
        placements = [
            PlayerPlacement(player_id=ranked_id, rank=rank)
            for rank, ranked_id in enumerate(state.finish_order, start=1)
        ]
        if remaining_player_id is not None:
            placements.append(
                PlayerPlacement(
                    player_id=remaining_player_id,
                    rank=state.seat_count,
                )
            )
        if not placements:
            return events

        state.status = "finished"
        state.turn_phase = "finished"
        state.winner_id = state.finish_order[0]
        state.result = GameResult(
            winner_id=state.winner_id,
            placements=placements,
        )
        state.current_player_id = None
        state.dice_values = None
        state.used_dice_indices = []
        state.available_moves = []
        state.pending_bonuses = []
        state.requires_split_plan = False
        events.append(
            DomainEvent(
                "GAME_FINISHED",
                {
                    "winnerId": state.winner_id,
                    "finishOrder": tuple(state.finish_order),
                    "placements": tuple(
                        {"playerId": item.player_id, "rank": item.rank}
                        for item in placements
                    ),
                },
            )
        )
        return events

    @staticmethod
    def _bonus_granted_event(bonus: PendingBonus) -> DomainEvent:
        return DomainEvent(
            "BONUS_GRANTED",
            {
                "playerId": bonus.player_id,
                "steps": bonus.steps,
                "reason": bonus.reason,
            },
        )

    def _close_turn(self, state: GameState) -> list[DomainEvent]:
        player_id = state.current_player_id
        if player_id is None or state.status != "playing":
            return []

        is_double = (
            self.config.extra_turn_condition == "doubles"
            and state.dice_values is not None
            and state.dice_values[0] == state.dice_values[1]
        )
        keeps_turn = is_double and player_id not in state.finish_order
        events = [
            DomainEvent(
                "TURN_ENDED",
                {"playerId": player_id, "extraTurn": keeps_turn},
            )
        ]

        if keeps_turn:
            next_player_id = player_id
        else:
            current_index = state.player_order.index(player_id)
            next_player_id = next(
                (
                    state.player_order[(current_index + offset) % len(state.player_order)]
                    for offset in range(1, len(state.player_order) + 1)
                    if state.player_order[(current_index + offset) % len(state.player_order)]
                    not in state.finish_order
                ),
                None,
            )

        if next_player_id is None:
            state.status = "finished"
            state.turn_phase = "finished"
            state.current_player_id = None
            return events

        state.current_player_id = next_player_id
        state.turn_phase = "waiting_for_roll"
        state.dice_values = None
        state.used_dice_indices = []
        state.available_moves = []
        state.requires_split_plan = False
        events.append(DomainEvent("TURN_STARTED", {"playerId": next_player_id}))
        return events

    @staticmethod
    def _public_position(position: PiecePosition) -> dict[str, object]:
        return {
            "state": position.state,
            "trackPosition": position.track_position,
            "finishProgress": position.finish_progress,
        }

    def _options_for_steps(
        self,
        state: GameState,
        dice_indices: tuple[int, ...],
        steps: int,
        *,
        pieces: list[PieceState] | None = None,
    ) -> list[MoveOption]:
        if state.current_player_id is None:
            return []
        candidates = pieces if pieces is not None else [
            piece
            for piece in state.pieces
            if piece.player_id == state.current_player_id
            and piece.state != "finished"
        ]
        result: list[MoveOption] = []
        for piece in candidates:
            option = self._make_option(state, piece, dice_indices, steps)
            if option is not None:
                result.append(option)
        return result

    def _make_option(
        self,
        state: GameState,
        piece: PieceState,
        dice_indices: tuple[int, ...],
        steps: int,
    ) -> MoveOption | None:
        board = BoardFactory.create(state.seat_count)
        seat_index = state.player_order.index(piece.player_id)

        if piece.state == "yard":
            if not self.can_leave_home(steps):
                return None
            destination = PiecePosition(
                "track",
                board.start_cells_by_seat[seat_index],
                None,
            )
            capture_id = self._capture_target(
                state,
                piece,
                destination,
                board,
                home_exit=True,
            )
            if capture_id is False:
                return None
            capture_piece_id = capture_id if isinstance(capture_id, str) else None
            if not self._path_is_clear(
                state,
                piece,
                destination,
                (),
                capture_piece_id=capture_piece_id,
                ignore_destination_blockade=True,
            ):
                return None
            return MoveOption(
                piece_id=piece.id,
                dice_indices=dice_indices,
                steps=steps,
                destination=destination,
                capture_piece_id=capture_piece_id,
                captures=capture_piece_id is not None,
                leaves_home=True,
                progress=steps,
            )

        destination = self.enter_finish_path(state, piece, steps)
        if destination is None:
            return None
        track_cells = (
            self._track_cells_traversed(state, piece, steps)
            if piece.state == "track"
            else ()
        )
        capture_id = self._capture_target(state, piece, destination, board)
        if capture_id is False:
            return None
        capture_piece_id = capture_id if isinstance(capture_id, str) else None
        if not self._path_is_clear(
            state,
            piece,
            destination,
            track_cells,
            capture_piece_id=capture_piece_id,
        ):
            return None
        captures = isinstance(capture_id, str)
        return MoveOption(
            piece_id=piece.id,
            dice_indices=dice_indices,
            steps=steps,
            destination=destination,
            capture_piece_id=capture_piece_id,
            completes_piece=destination.state == "finished",
            captures=captures,
            lands_safe=(
                destination.state == "track"
                and destination.track_position in board.safe_cells
            ),
            progress=self._progress_value(destination, steps),
        )

    def _track_cells_traversed(
        self,
        state: GameState,
        piece: PieceState,
        steps: int,
    ) -> tuple[int, ...]:
        assert piece.track_position is not None
        board = BoardFactory.create(state.seat_count)
        seat_index = state.player_order.index(piece.player_id)
        entry = board.goal_entry_cells_by_seat[seat_index]
        distance_to_entry = (entry - piece.track_position) % board.track_length
        common_steps = min(steps, distance_to_entry)
        return tuple(
            (piece.track_position + offset) % board.track_length
            for offset in range(1, common_steps + 1)
        )

    def _path_is_clear(
        self,
        state: GameState,
        moving_piece: PieceState,
        destination: PiecePosition,
        track_cells: tuple[int, ...],
        *,
        capture_piece_id: str | None = None,
        ignore_destination_blockade: bool = False,
    ) -> bool:
        board = BoardFactory.create(state.seat_count)
        final_cell = (
            destination.track_position if destination.state == "track" else None
        )
        for cell in track_cells:
            if not self.config.blockades_enabled:
                break
            occupants = [
                piece
                for piece in state.pieces
                if piece.state == "track" and piece.track_position == cell
            ]
            groups: dict[str, int] = {}
            for occupant in occupants:
                groups[occupant.player_id] = groups.get(occupant.player_id, 0) + 1
            for owner, count in groups.items():
                if count < self.config.blockade_size:
                    continue
                is_destination = cell == final_cell
                if not (is_destination and owner == moving_piece.player_id):
                    return False

        if final_cell is not None:
            occupants = [
                piece
                for piece in state.pieces
                if piece.state == "track" and piece.track_position == final_cell
            ]
            enemy_counts: dict[str, int] = {}
            for occupant in occupants:
                if occupant.player_id != moving_piece.player_id:
                    enemy_counts[occupant.player_id] = (
                        enemy_counts.get(occupant.player_id, 0) + 1
                    )
            if (
                self.config.blockades_enabled
                and not ignore_destination_blockade
                and any(
                    count >= self.config.blockade_size
                    for count in enemy_counts.values()
                )
            ):
                return False
            if len(occupants) + 1 - (capture_piece_id is not None) > 2:
                return False
            if final_cell in board.safe_cells:
                return True
            if sum(
                piece.player_id != moving_piece.player_id for piece in occupants
            ) > 1:
                return False
            if not occupants:
                return True
            # A single opposing piece is capturable only after landing; safe cells
            # are checked above and may contain pieces from multiple players.
            return len(enemy_counts) <= 1
        return True

    def _capture_target(
        self,
        state: GameState,
        moving_piece: PieceState,
        destination: PiecePosition,
        board: BoardDefinition,
        *,
        home_exit: bool = False,
    ) -> str | bool | None:
        if destination.state != "track" or destination.track_position is None:
            return None
        if destination.track_position in board.safe_cells and not home_exit:
            return None
        enemies = [
            piece
            for piece in state.pieces
            if piece.state == "track"
            and piece.track_position == destination.track_position
            and piece.player_id != moving_piece.player_id
        ]
        if not enemies:
            return None
        if home_exit:
            occupants = [
                piece
                for piece in state.pieces
                if piece.state == "track"
                and piece.track_position == destination.track_position
            ]
            if len(occupants) < 2:
                return None
            piece_order = {
                piece.id: index for index, piece in enumerate(state.pieces)
            }
            return max(
                enemies,
                key=lambda enemy: (
                    enemy.track_arrival_order is not None,
                    enemy.track_arrival_order
                    if enemy.track_arrival_order is not None
                    else -1,
                    piece_order[enemy.id],
                ),
            ).id
        if len(enemies) == 1:
            return enemies[0].id
        return False

    @staticmethod
    def _mark_track_arrival(state: GameState, piece: PieceState) -> None:
        piece.track_arrival_order = max(
            (
                candidate.track_arrival_order
                for candidate in state.pieces
                if candidate.track_arrival_order is not None
            ),
            default=-1,
        ) + 1

    def _simulate_option(self, state: GameState, option: MoveOption) -> GameState:
        simulated = deepcopy(state)
        piece = next(piece for piece in simulated.pieces if piece.id == option.piece_id)
        piece.state = option.destination.state
        piece.track_position = option.destination.track_position
        piece.finish_progress = option.destination.finish_progress
        if option.destination.state == "track":
            self._mark_track_arrival(simulated, piece)
        else:
            piece.track_arrival_order = None
        if option.capture_piece_id is not None:
            captured = next(
                piece
                for piece in simulated.pieces
                if piece.id == option.capture_piece_id
            )
            captured.state = "yard"
            captured.track_position = None
            captured.finish_progress = None
            captured.track_arrival_order = None
        simulated.used_dice_indices = sorted(
            set(simulated.used_dice_indices) | set(option.dice_indices)
        )
        return simulated

    def _advance_to_next_player(self, state: GameState) -> GameState:
        next_state = deepcopy(state)
        if not next_state.player_order:
            next_state.current_player_id = None
            next_state.turn_phase = "finished"
            return next_state
        current_index = next_state.player_order.index(next_state.current_player_id)
        next_state.current_player_id = next_state.player_order[
            (current_index + 1) % len(next_state.player_order)
        ]
        next_state.turn_phase = "waiting_for_roll"
        next_state.dice_values = None
        next_state.used_dice_indices = []
        next_state.available_moves = []
        next_state.requires_split_plan = False
        return next_state

    @staticmethod
    def _progress_value(destination: PiecePosition, steps: int) -> int:
        if destination.state == "finished":
            return 10_000
        if destination.state == "finish_path" and destination.finish_progress is not None:
            return 1_000 + destination.finish_progress
        return steps

    @staticmethod
    def _sort_options(options: list[MoveOption]) -> list[MoveOption]:
        return sorted(
            options,
            key=lambda option: (
                option.piece_id,
                option.dice_indices,
                option.destination.state,
                option.destination.track_position
                if option.destination.track_position is not None
                else -1,
                option.destination.finish_progress
                if option.destination.finish_progress is not None
                else -1,
            ),
        )
