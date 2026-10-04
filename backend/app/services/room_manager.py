import asyncio
import copy
import hashlib
import hmac
import re
import secrets
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from app.game.autoplayer import AutopilotPolicy, NoLegalMoveError
from app.game.models import (
    AuthenticatedSession,
    DomainEvent,
    GameParticipant,
    GameResult,
    GameState,
    GameTransition,
    MoveOption,
    PiecePosition,
    PlayerState,
    RoomChange,
    RoomCredentialData,
    RoomState,
    SocialChatMessage,
    SessionIdentity,
)
from app.game.rules import GameRules, IllegalMoveError
from app.repositories.room_repository import RoomCodeCollisionError, RoomRepository
from app.schemas.rooms import PlayerColor, PlayerCount
from app.security.rate_limit import FixedWindowRateLimiter
from app.services.social_policy import (
    DICE_SKIN_IDS,
    GIFT_IDS,
    PIECE_SKIN_IDS,
    REACTION_IDS,
    normalize_chat_text,
)


ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
PLAYER_COLORS = ("green", "red", "blue", "yellow", "purple", "orange")
ROOM_CODE_LENGTH = 5
MAX_PROCESSED_CHANGES = 128
_ROOM_CODE_PATTERN = re.compile(
    rf"^[{re.escape(ROOM_CODE_ALPHABET)}]{{{ROOM_CODE_LENGTH}}}$"
)


@dataclass(slots=True)
class _RoomLockEntry:
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    users: int = 0
    remove_when_unused: bool = False


class RoomError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def hash_player_token(player_token: str) -> str:
    return hashlib.sha256(player_token.encode("utf-8")).hexdigest()


def tokens_match(expected_hash: str, supplied_token: str) -> bool:
    return hmac.compare_digest(expected_hash, hash_player_token(supplied_token))


class RoomManager:
    def __init__(
        self,
        repository: RoomRepository,
        code_generator: Callable[[], str] | None = None,
        token_generator: Callable[[], str] | None = None,
        clock: Callable[[], datetime] | None = None,
        reservation_ttl_seconds: int = 600,
        game_rules: GameRules | None = None,
        autopilot: AutopilotPolicy | None = None,
    ) -> None:
        self._repository = repository
        self._code_generator = code_generator or self._generate_room_code
        self._token_generator = token_generator or self._generate_player_token
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._reservation_ttl_seconds = reservation_ttl_seconds
        self._game_rules = game_rules or GameRules()
        self._autopilot = autopilot or AutopilotPolicy()
        self._chat_rate_limiter = FixedWindowRateLimiter(
            limit=5,
            window_seconds=10,
            clock=self._now,
        )
        self._reaction_rate_limiter = FixedWindowRateLimiter(
            limit=8,
            window_seconds=5,
            clock=self._now,
        )
        self._gift_rate_limiter = FixedWindowRateLimiter(
            limit=3,
            window_seconds=10,
            clock=self._now,
        )
        self._room_locks: dict[str, _RoomLockEntry] = {}
        self._locks_guard = asyncio.Lock()

    async def create_room(
        self,
        display_name: str,
        player_count: PlayerCount,
        color: PlayerColor | None,
    ) -> RoomCredentialData:
        normalized_name = self._validate_display_name(display_name)
        if player_count not in (4, 5, 6):
            raise RoomError(
                "INVALID_PLAYER_COUNT",
                "Player count must be 4, 5, or 6.",
            )
        selected_color = self._select_color(color, set())
        player_id = self._generate_player_id()
        player_token = self._token_generator()

        while True:
            room_code = self._code_generator()
            self._validate_room_code(room_code)
            async with self._locked_room(room_code) as lock_entry:
                if await self._repository.get(room_code) is not None:
                    continue

                player = PlayerState(
                    id=player_id,
                    display_name=normalized_name,
                    color=selected_color,
                    seat_index=0,
                    is_host=True,
                    token_hash=hash_player_token(player_token),
                    is_connected=True,
                )
                room = RoomState(
                    room_code=room_code,
                    max_players=player_count,
                    host_player_id=player_id,
                    players=[player],
                    created_at=self._now(),
                )
                try:
                    await self._repository.create(room)
                except RoomCodeCollisionError:
                    continue

                await self._keep_lock(room_code, lock_entry)
                return self._credentials(room_code, player_id, player_token, True)

    async def create_practice_room(
        self,
        display_name: str,
        player_count: PlayerCount,
        color: PlayerColor | None,
    ) -> RoomCredentialData:
        normalized_name = self._validate_display_name(display_name)
        if player_count not in (4, 5, 6):
            raise RoomError(
                "INVALID_PLAYER_COUNT",
                "Player count must be 4, 5, or 6.",
            )
        selected_color = self._select_color(color, set())
        host_id = self._generate_player_id()
        host_token = self._token_generator()
        bot_colors = [candidate for candidate in PLAYER_COLORS if candidate != selected_color]

        while True:
            room_code = self._code_generator()
            self._validate_room_code(room_code)
            async with self._locked_room(room_code) as lock_entry:
                if await self._repository.get(room_code) is not None:
                    continue

                host = PlayerState(
                    id=host_id,
                    display_name=normalized_name,
                    color=selected_color,
                    seat_index=0,
                    is_host=True,
                    token_hash=hash_player_token(host_token),
                    is_connected=True,
                )
                bots = [
                    PlayerState(
                        id=self._generate_player_id(),
                        display_name=f"Bot {seat_index}",
                        color=bot_colors[seat_index - 1],
                        seat_index=seat_index,
                        is_host=False,
                        token_hash=secrets.token_hex(32),
                        is_bot=True,
                        is_ready=True,
                    )
                    for seat_index in range(1, player_count)
                ]
                players = [host, *bots]
                room = RoomState(
                    room_code=room_code,
                    max_players=player_count,
                    host_player_id=host_id,
                    players=players,
                    mode="practice",
                    status="playing",
                    created_at=self._now(),
                    game_state=self._game_rules.new_game(
                        room_code,
                        [GameParticipant(player.id, player.seat_index) for player in players],
                    ),
                )
                try:
                    await self._repository.create(room)
                except RoomCodeCollisionError:
                    continue

                await self._keep_lock(room_code, lock_entry)
                return self._credentials(room_code, host_id, host_token, True)

    async def join_room(
        self,
        room_code: str,
        display_name: str,
        color: PlayerColor | None,
    ) -> RoomCredentialData:
        self._validate_room_code(room_code)
        normalized_name = self._validate_display_name(display_name)
        async with self._locked_room(room_code):
            room = await self._require_room(room_code)
            self._prune_expired(room)
            if not room.players:
                raise RoomError("ROOM_NOT_FOUND", "Room not found.")

            if room.mode == "practice":
                raise RoomError("ROOM_NOT_JOINABLE", "Practice rooms do not accept guests.")

            if room.status != "lobby":
                raise RoomError("ROOM_ALREADY_STARTED", "The room has already started.")
            if len(room.players) >= room.max_players:
                raise RoomError("ROOM_FULL", "The room is full.")
            if any(
                player.display_name.casefold() == normalized_name.casefold()
                for player in room.players
            ):
                raise RoomError("INVALID_NAME", "That display name is already in use.")

            selected_color = self._select_color(
                color,
                {player.color for player in room.players},
            )
            seat_index = self._first_available_seat(room)
            player_id = self._generate_player_id()
            player_token = self._token_generator()
            room.players.append(
                PlayerState(
                    id=player_id,
                    display_name=normalized_name,
                    color=selected_color,
                    seat_index=seat_index,
                    is_host=False,
                    token_hash=hash_player_token(player_token),
                    is_connected=True,
                )
            )
            room.players.sort(key=lambda player: player.seat_index)
            room.state_version += 1
            await self._repository.save(room)
            return self._credentials(room_code, player_id, player_token, False)

    async def get_room(self, room_code: str) -> RoomState:
        self._validate_room_code(room_code)
        async with self._locked_room(room_code) as lock_entry:
            room = await self._require_room(room_code)
            pruned = self._prune_expired(room)
            if not room.players:
                await self._repository.delete(room_code)
                await self._remove_lock(room_code, lock_entry)
                raise RoomError("ROOM_NOT_FOUND", "Room not found.")
            if pruned:
                await self._repository.save(room)
            return copy.deepcopy(room)

    async def public_room(self, room_code: str) -> dict:
        self._validate_room_code(room_code)
        async with self._locked_room(room_code) as lock_entry:
            room = await self._require_room(room_code)
            pruned = self._prune_expired(room)
            if not room.players:
                await self._repository.delete(room_code)
                await self._remove_lock(room_code, lock_entry)
                raise RoomError("ROOM_NOT_FOUND", "Room not found.")
            if pruned:
                await self._repository.save(room)
            return self.public_room_from_state(room)

    def public_room_from_state(self, state: RoomState) -> dict:
        return {
            "roomCode": state.room_code,
            "mode": state.mode,
            "status": state.status,
            "maxPlayers": state.max_players,
            "hostPlayerId": state.host_player_id,
            "players": [
                {
                    "id": player.id,
                    "displayName": player.display_name,
                    "color": player.color,
                    "seatIndex": player.seat_index,
                    "isHost": player.is_host,
                    "isBot": player.is_bot,
                    "isReady": player.is_ready,
                    "isConnected": player.is_connected,
                    "reservationExpiresAt": self._isoformat(
                        player.reservation_expires_at
                    ),
                    "diceSkinId": player.dice_skin_id,
                    "pieceSkinId": player.piece_skin_id,
                    "lastReceivedGiftId": player.last_received_gift_id,
                }
                for player in sorted(state.players, key=lambda item: item.seat_index)
            ],
            "stateVersion": state.state_version,
            "gameState": self._public_game_state(state.game_state),
            "lastGameResult": self._public_game_result(state.last_game_result),
        }

    @classmethod
    def _public_game_state(cls, game: GameState | None) -> dict | None:
        if game is None:
            return None
        return {
            "roomCode": game.room_code,
            "seatCount": game.seat_count,
            "status": game.status,
            "playerOrder": list(game.player_order),
            "currentPlayerId": game.current_player_id,
            "turnPhase": game.turn_phase,
            "diceValues": (
                list(game.dice_values) if game.dice_values is not None else None
            ),
            "usedDiceIndices": list(game.used_dice_indices),
            "availableMoves": [
                cls._public_move_option(option) for option in game.available_moves
            ],
            "pendingBonuses": [
                {
                    "playerId": bonus.player_id,
                    "steps": bonus.steps,
                    "reason": bonus.reason,
                }
                for bonus in game.pending_bonuses
            ],
            "pieces": [
                {
                    "id": piece.id,
                    "playerId": piece.player_id,
                    "state": piece.state,
                    "trackPosition": piece.track_position,
                    "finishProgress": piece.finish_progress,
                }
                for piece in game.pieces
            ],
            "finishOrder": list(game.finish_order),
            "winnerId": game.winner_id,
            "result": cls._public_game_result(game.result),
            "requiresSplitPlan": game.requires_split_plan,
            "turnNumber": game.turn_number,
            "lastRollsByPlayerId": {
                player_id: {
                    "values": list(last_roll.values),
                    "turnNumber": last_roll.turn_number,
                }
                for player_id, last_roll in game.last_rolls_by_player_id.items()
            },
        }

    @staticmethod
    def _public_position(position: PiecePosition) -> dict[str, object]:
        return {
            "state": position.state,
            "trackPosition": position.track_position,
            "finishProgress": position.finish_progress,
        }

    @classmethod
    def _public_move_option(cls, option: MoveOption) -> dict[str, object]:
        return {
            "pieceId": option.piece_id,
            "diceIndices": list(option.dice_indices),
            "steps": option.steps,
            "destination": cls._public_position(option.destination),
            "capturePieceId": option.capture_piece_id,
            "completesPiece": option.completes_piece,
            "captures": option.captures,
            "landsSafe": option.lands_safe,
            "leavesHome": option.leaves_home,
            "progress": option.progress,
            "completesSplitPlan": option.completes_split_plan,
        }

    @staticmethod
    def _public_game_result(result: GameResult | None) -> dict | None:
        if result is None:
            return None
        return {
            "winnerId": result.winner_id,
            "placements": [
                {"playerId": placement.player_id, "rank": placement.rank}
                for placement in result.placements
            ],
        }

    async def authenticate(
        self,
        room_code: str,
        player_token: str,
    ) -> AuthenticatedSession:
        self._validate_room_code(room_code)
        if not isinstance(player_token, str) or not player_token:
            raise self._unauthenticated()
        async with self._locked_room(room_code):
            persisted_room = await self._repository.get(room_code)
            if persisted_room is None:
                raise self._unauthenticated()
            room = copy.deepcopy(persisted_room)
            pruned = self._prune_expired(room)
            if pruned and room.game_state is not None:
                await self._repository.save(room)

            player = next(
                (
                    candidate
                    for candidate in room.players
                    if tokens_match(candidate.token_hash, player_token)
                ),
                None,
            )
            if player is None:
                raise self._unauthenticated()
            if player.is_bot:
                raise self._unauthenticated()
            if player.reservation_expired:
                raise self._unauthenticated()

            is_reconnect = player.has_connected and not player.is_connected
            changed = (
                not player.has_connected
                or not player.is_connected
                or player.reservation_expires_at is not None
            )
            player.has_connected = True
            player.is_connected = True
            player.reservation_expires_at = None
            player.reservation_expired = False
            if changed:
                room.state_version += 1
            if pruned or changed:
                await self._repository.save(room)

            return AuthenticatedSession(
                identity=SessionIdentity(room_code, player.id),
                is_reconnect=is_reconnect,
            )

    async def disconnect(
        self,
        session: AuthenticatedSession | SessionIdentity,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            self._prune_expired(room)
            player = self._require_player(room, identity.player_id)
            expires_at = self._now() + timedelta(
                seconds=self._reservation_ttl_seconds
            )
            player.is_connected = False
            player.is_ready = False
            player.reservation_expires_at = expires_at
            player.reservation_expired = False
            room.state_version += 1
            await self._repository.save(room)
            return self._snapshot_change(
                room,
                "PLAYER_LEFT",
                {
                    "playerId": player.id,
                    "reservationExpiresAt": self._isoformat(expires_at),
                },
            )

    async def send_chat_message(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
        text: str,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        if not isinstance(text, str) or len(text) > 280:
            raise RoomError("INVALID_MESSAGE", "Chat messages must be at most 280 characters.")
        normalized_text = normalize_chat_text(text)
        if not normalized_text:
            raise RoomError("INVALID_MESSAGE", "Chat messages cannot be empty.")

        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            player = self._require_connected_player(room, identity.player_id)
            cached = self._cached_change(room, player.id, request_id)
            if cached is not None:
                return cached
            self._require_active_game(room)
            if not self._chat_rate_limiter.allow(self._social_rate_key(identity)):
                raise RoomError("RATE_LIMITED", "Chat message rate limit exceeded.")

            message = SocialChatMessage(
                message_id=uuid4().hex,
                player_id=player.id,
                display_name=player.display_name,
                text=normalized_text,
                sent_at=self._now(),
            )
            room.chat_messages.append(message)
            del room.chat_messages[:-50]
            change = self._snapshot_change(
                room,
                "CHAT_MESSAGE",
                self._public_chat_message(message),
                request_id,
                include_state_sync=False,
            )
            self._cache_change(room, player.id, request_id, change)
            await self._repository.save(room)
            return copy.deepcopy(change)

    async def send_reaction(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
        reaction_id: str,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        if not isinstance(reaction_id, str) or reaction_id not in REACTION_IDS:
            raise RoomError("INVALID_REACTION", "Reaction is not available.")

        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            player = self._require_connected_player(room, identity.player_id)
            cached = self._cached_change(room, player.id, request_id)
            if cached is not None:
                return cached
            self._require_active_game(room)
            if not self._reaction_rate_limiter.allow(self._social_rate_key(identity)):
                raise RoomError("RATE_LIMITED", "Reaction rate limit exceeded.")

            change = self._snapshot_change(
                room,
                "REACTION_SENT",
                {"playerId": player.id, "reactionId": reaction_id},
                request_id,
                include_state_sync=False,
            )
            self._cache_change(room, player.id, request_id, change)
            await self._repository.save(room)
            return copy.deepcopy(change)

    async def send_gift(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
        recipient_id: str,
        gift_id: str,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        if not isinstance(gift_id, str) or gift_id not in GIFT_IDS:
            raise RoomError("INVALID_GIFT", "Gift is not available.")
        if not isinstance(recipient_id, str) or not recipient_id:
            raise RoomError("INVALID_GIFT_TARGET", "Gift recipient is invalid.")

        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            player = self._require_connected_player(room, identity.player_id)
            cached = self._cached_change(room, player.id, request_id)
            if cached is not None:
                return cached
            self._require_active_game(room)
            recipient = next(
                (candidate for candidate in room.players if candidate.id == recipient_id),
                None,
            )
            if recipient is None or recipient.id == player.id:
                raise RoomError("INVALID_GIFT_TARGET", "Choose another player in this room.")
            if not self._gift_rate_limiter.allow(self._social_rate_key(identity)):
                raise RoomError("RATE_LIMITED", "Gift rate limit exceeded.")

            recipient.last_received_gift_id = gift_id
            room.state_version += 1
            change = self._snapshot_change(
                room,
                "GIFT_SENT",
                {
                    "fromPlayerId": player.id,
                    "toPlayerId": recipient.id,
                    "giftId": gift_id,
                },
                request_id,
            )
            self._cache_change(room, player.id, request_id, change)
            await self._repository.save(room)
            return copy.deepcopy(change)

    async def set_cosmetics(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
        dice_skin_id: str,
        piece_skin_id: str,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        if (
            not isinstance(dice_skin_id, str)
            or dice_skin_id not in DICE_SKIN_IDS
            or not isinstance(piece_skin_id, str)
            or piece_skin_id not in PIECE_SKIN_IDS
        ):
            raise RoomError("INVALID_COSMETICS", "One or more selected skins are unavailable.")

        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            player = self._require_connected_player(room, identity.player_id)
            cached = self._cached_change(room, player.id, request_id)
            if cached is not None:
                return cached
            if room.status == "finished":
                raise RoomError("GAME_FINISHED", "Cosmetics cannot change after the game ends.")

            player.dice_skin_id = dice_skin_id
            player.piece_skin_id = piece_skin_id
            room.state_version += 1
            change = self._snapshot_change(
                room,
                "PLAYER_COSMETICS_UPDATED",
                {
                    "playerId": player.id,
                    "diceSkinId": dice_skin_id,
                    "pieceSkinId": piece_skin_id,
                },
                request_id,
            )
            self._cache_change(room, player.id, request_id, change)
            await self._repository.save(room)
            return copy.deepcopy(change)

    async def recent_chat_history(
        self,
        session: AuthenticatedSession | SessionIdentity,
    ) -> list[dict[str, object]]:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            self._require_connected_player(room, identity.player_id)
            return [self._public_chat_message(message) for message in room.chat_messages[-50:]]

    async def set_ready(
        self,
        session: AuthenticatedSession | SessionIdentity,
        ready: bool,
        request_id: str,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            self._prune_expired(room)
            player = self._require_player(room, identity.player_id)
            cached = self._cached_change(room, identity.player_id, request_id)
            if cached is not None:
                return cached
            if room.status != "lobby":
                raise RoomError("ROOM_ALREADY_STARTED", "The room has already started.")
            if not isinstance(ready, bool):
                raise RoomError("INVALID_MESSAGE", "Ready must be a boolean.")

            player.is_ready = ready
            room.state_version += 1
            change = self._snapshot_change(
                room,
                "PLAYER_READY",
                {"playerId": player.id, "ready": ready},
                request_id,
            )
            self._cache_change(room, player.id, request_id, change)
            await self._repository.save(room)
            return copy.deepcopy(change)

    async def start_game(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            self._prune_expired(room)
            self._require_player(room, identity.player_id)
            cached = self._cached_change(room, identity.player_id, request_id)
            if cached is not None:
                return cached
            if room.status != "lobby":
                raise RoomError("ROOM_ALREADY_STARTED", "The room has already started.")
            if identity.player_id != room.host_player_id:
                raise RoomError("NOT_HOST", "Only the host can start the game.")
            if len(room.players) != room.max_players:
                raise RoomError(
                    "INSUFFICIENT_PLAYERS",
                    "The room must have exactly the configured number of players.",
                )
            if not all(player.is_connected for player in room.players):
                raise RoomError(
                    "PLAYER_NOT_READY",
                    "Every player must be connected before the game starts.",
                )
            if not all(player.is_ready for player in room.players):
                raise RoomError(
                    "PLAYER_NOT_READY",
                    "Every player must be ready before the game starts.",
                )

            room.game_state = self._game_rules.new_game(
                room.room_code,
                [
                    GameParticipant(player.id, player.seat_index)
                    for player in room.players
                ],
            )
            room.last_game_result = None
            room.status = "playing"
            room.state_version += 1
            change = self._snapshot_change(
                room,
                "GAME_STARTED",
                {"status": "playing"},
                request_id,
            )
            self._cache_change(room, identity.player_id, request_id, change)
            await self._repository.save(room)
            return copy.deepcopy(change)

    async def roll_dice(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
    ) -> RoomChange:
        return await self._game_action(
            session,
            request_id,
            lambda state, player_id: self._game_rules.roll_dice(state, player_id),
        )

    async def move_piece(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
        piece_id: str,
        dice_indices: tuple[int, ...],
    ) -> RoomChange:
        return await self._game_action(
            session,
            request_id,
            lambda state, player_id: self._game_rules.move_piece(
                state,
                player_id,
                piece_id,
                dice_indices,
            ),
        )

    async def move_bonus_piece(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
        piece_id: str,
    ) -> RoomChange:
        return await self._game_action(
            session,
            request_id,
            lambda state, player_id: self._game_rules.move_bonus_piece(
                state,
                player_id,
                piece_id,
            ),
        )

    async def return_to_lobby(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
    ) -> RoomChange:
        return await self._reset_to_lobby(session, request_id, ready_requester=False)

    async def play_again(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            if room.mode == "practice":
                requester = self._require_player(room, identity.player_id)
                if not requester.is_connected:
                    raise self._unauthenticated()
                cached = self._cached_change(room, requester.id, request_id)
                if cached is not None:
                    return cached
                if room.status != "finished":
                    raise RoomError("GAME_NOT_FINISHED", "The game must be finished before replay.")
                room.game_state = self._game_rules.new_game(
                    room.room_code,
                    [GameParticipant(player.id, player.seat_index) for player in room.players],
                )
                room.status = "playing"
                room.last_game_result = None
                room.state_version += 1
                change = self._snapshot_change(
                    room,
                    "GAME_STARTED",
                    {"status": "playing"},
                    request_id,
                )
                self._cache_change(room, requester.id, request_id, change)
                await self._repository.save(room)
                return copy.deepcopy(change)
        return await self._reset_to_lobby(session, request_id, ready_requester=True)

    async def run_autopilot_step(self, room_code: str) -> RoomChange | None:
        self._validate_room_code(room_code)
        async with self._locked_room(room_code):
            room = await self._require_room(room_code)
            pruned = self._prune_expired(room)
            if room.status != "playing" or room.game_state is None:
                if pruned:
                    await self._repository.save(room)
                return None

            game = room.game_state
            current_player = next(
                (
                    player
                    for player in room.players
                    if player.id == game.current_player_id
                ),
                None,
            )
            if current_player is None or (
                current_player.is_connected and not current_player.is_bot
            ):
                if pruned:
                    await self._repository.save(room)
                return None

            if game.turn_phase == "waiting_for_roll":
                transition = self._game_rules.roll_dice(game, current_player.id)
            elif game.turn_phase == "waiting_for_move":
                try:
                    option = self._autopilot.choose_move(game)
                except NoLegalMoveError:
                    if pruned:
                        await self._repository.save(room)
                    return None
                transition = self._game_rules.move_piece(
                    game,
                    current_player.id,
                    option.piece_id,
                    option.dice_indices,
                )
            elif game.turn_phase == "waiting_for_bonus":
                piece_id = self._autopilot.choose_bonus_move(game)
                if piece_id is None:
                    if pruned:
                        await self._repository.save(room)
                    return None
                transition = self._game_rules.move_bonus_piece(
                    game,
                    current_player.id,
                    piece_id,
                )
            else:
                if pruned:
                    await self._repository.save(room)
                return None

            change = self._apply_game_transition(room, transition)
            await self._repository.save(room)
            return copy.deepcopy(change)

    async def _game_action(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
        action: Callable[[GameState, str], GameTransition],
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            self._prune_expired(room)
            player = self._require_player(room, identity.player_id)
            if not player.is_connected:
                raise self._unauthenticated()

            cached = self._cached_change(room, identity.player_id, request_id)
            if cached is not None:
                return cached
            if room.status != "playing" or room.game_state is None:
                raise RoomError("GAME_NOT_ACTIVE", "The game is not active.")

            try:
                transition = action(room.game_state, player.id)
            except IllegalMoveError as error:
                raise RoomError("INVALID_GAME_ACTION", str(error)) from error

            change = self._apply_game_transition(
                room,
                transition,
                request_id=request_id,
                player_id=player.id,
            )
            await self._repository.save(room)
            # _apply_game_transition already builds a detached snapshot, and
            # _cache_change stores its own copy. The command handler only reads
            # this response, so another deep copy here duplicates every game
            # action's most expensive work.
            return change

    async def _reset_to_lobby(
        self,
        session: AuthenticatedSession | SessionIdentity,
        request_id: str,
        *,
        ready_requester: bool,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        async with self._locked_room(identity.room_code):
            room = await self._require_room(identity.room_code)
            self._prune_expired(room)
            requester = self._require_player(room, identity.player_id)
            if not requester.is_connected:
                raise self._unauthenticated()
            cached = self._cached_change(room, requester.id, request_id)
            if cached is not None:
                return cached
            if room.status != "finished":
                raise RoomError(
                    "GAME_NOT_FINISHED",
                    "The game must be finished before returning to the lobby.",
                )
            if room.mode == "practice":
                raise RoomError("PRACTICE_NO_LOBBY", "Practice rooms have no lobby.")

            if room.last_game_result is None and room.game_state is not None:
                room.last_game_result = copy.deepcopy(room.game_state.result)
            room.game_state = None
            room.status = "lobby"
            for player in room.players:
                player.is_ready = False
            if ready_requester:
                requester.is_ready = True
            room.state_version += 1
            change = self._snapshot_change(
                room,
                "GAME_RESET",
                {
                    "status": "lobby",
                    "requestedReplay": ready_requester,
                    "requesterId": requester.id,
                },
                request_id,
            )
            self._cache_change(room, requester.id, request_id, change)
            await self._repository.save(room)
            return copy.deepcopy(change)

    def _apply_game_transition(
        self,
        room: RoomState,
        transition: GameTransition,
        *,
        request_id: str | None = None,
        player_id: str | None = None,
    ) -> RoomChange:
        if not transition.events:
            raise RuntimeError("Game transitions must include a semantic event.")
        room.game_state = transition.state
        if transition.state.status == "finished":
            room.status = "finished"
            if transition.state.result is not None:
                room.last_game_result = copy.deepcopy(transition.state.result)
        else:
            room.status = "playing"

        room.state_version += 1
        primary, *additional = transition.events
        change = self._snapshot_change(
            room,
            primary.type,
            primary.payload,
            request_id,
            additional_events=tuple(additional),
        )
        if request_id is not None and player_id is not None:
            self._cache_change(room, player_id, request_id, change)
        return change

    async def prune_expired_reservations(self, room_code: str) -> None:
        self._validate_room_code(room_code)
        async with self._locked_room(room_code) as lock_entry:
            persisted_room = await self._repository.get(room_code)
            if persisted_room is None:
                return
            room = copy.deepcopy(persisted_room)
            if not self._prune_expired(room):
                return
            if not room.players:
                await self._repository.delete(room_code)
                await self._remove_lock(room_code, lock_entry)
                return
            await self._repository.save(room)

    def _prune_expired(self, room: RoomState) -> bool:
        now = self._now()
        expired_ids = {
            player.id
            for player in room.players
            if player.reservation_expires_at is not None
            and player.reservation_expires_at <= now
        }
        if not expired_ids:
            return False

        if room.game_state is not None:
            changed = False
            for player in room.players:
                if player.id in expired_ids and not player.reservation_expired:
                    player.reservation_expired = True
                    changed = True
            if changed:
                room.state_version += 1
            return changed

        host_expired = room.host_player_id in expired_ids
        room.players = [
            player for player in room.players if player.id not in expired_ids
        ]
        for cache_key in list(room.processed_changes):
            if cache_key[0] in expired_ids:
                room.processed_changes.pop(cache_key)
        if not room.players:
            return True

        if host_expired:
            connected_players = [
                player for player in room.players if player.is_connected
            ]
            candidates = connected_players or room.players
            new_host = min(candidates, key=lambda player: player.seat_index)
            room.host_player_id = new_host.id
            for player in room.players:
                player.is_host = player.id == new_host.id

        room.players.sort(key=lambda player: player.seat_index)
        room.state_version += 1
        return True

    async def _require_room(self, room_code: str) -> RoomState:
        room = await self._repository.get(room_code)
        if room is None:
            raise RoomError("ROOM_NOT_FOUND", "Room not found.")
        return copy.deepcopy(room)

    @staticmethod
    def _require_player(room: RoomState, player_id: str) -> PlayerState:
        player = next(
            (candidate for candidate in room.players if candidate.id == player_id),
            None,
        )
        if player is None or player.is_bot:
            raise RoomError("UNAUTHENTICATED", "Invalid room credentials.")
        return player

    @classmethod
    def _require_connected_player(cls, room: RoomState, player_id: str) -> PlayerState:
        player = cls._require_player(room, player_id)
        if not player.is_connected:
            raise cls._unauthenticated()
        return player

    @staticmethod
    def _require_active_game(room: RoomState) -> None:
        if room.status != "playing" or room.game_state is None:
            raise RoomError("GAME_NOT_ACTIVE", "The game is not active.")

    @staticmethod
    def _social_rate_key(identity: SessionIdentity) -> str:
        return f"{identity.room_code}:{identity.player_id}"

    @classmethod
    def _public_chat_message(
        cls,
        message: SocialChatMessage,
    ) -> dict[str, object]:
        return {
            "messageId": message.message_id,
            "playerId": message.player_id,
            "displayName": message.display_name,
            "text": message.text,
            "sentAt": cls._isoformat(message.sent_at),
        }

    @asynccontextmanager
    async def _locked_room(
        self,
        room_code: str,
    ) -> AsyncIterator[_RoomLockEntry]:
        async with self._locks_guard:
            entry = self._room_locks.setdefault(room_code, _RoomLockEntry())
            entry.users += 1

        acquired = False
        try:
            await entry.lock.acquire()
            acquired = True
            yield entry
        finally:
            if acquired:
                entry.lock.release()
            async with self._locks_guard:
                entry.users -= 1
                if (
                    entry.users == 0
                    and entry.remove_when_unused
                    and self._room_locks.get(room_code) is entry
                ):
                    self._room_locks.pop(room_code, None)

    async def _remove_lock(
        self,
        room_code: str,
        room_lock: _RoomLockEntry,
    ) -> None:
        async with self._locks_guard:
            if self._room_locks.get(room_code) is room_lock:
                room_lock.remove_when_unused = True

    async def _keep_lock(
        self,
        room_code: str,
        room_lock: _RoomLockEntry,
    ) -> None:
        async with self._locks_guard:
            if self._room_locks.get(room_code) is room_lock:
                room_lock.remove_when_unused = False

    @staticmethod
    def _validate_display_name(display_name: str) -> str:
        if not isinstance(display_name, str):
            raise RoomError("INVALID_NAME", "Display name must be text.")
        normalized_name = display_name.strip()
        if not 2 <= len(normalized_name) <= 20:
            raise RoomError(
                "INVALID_NAME",
                "Display name must contain between 2 and 20 characters.",
            )
        return normalized_name

    @staticmethod
    def _validate_room_code(room_code: str) -> None:
        if not isinstance(room_code, str) or _ROOM_CODE_PATTERN.fullmatch(room_code) is None:
            raise RoomError("INVALID_ROOM_CODE", "Room code is invalid.")

    @staticmethod
    def _validate_request_id(request_id: str) -> None:
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 64:
            raise RoomError("INVALID_MESSAGE", "Request id is invalid.")

    @staticmethod
    def _select_color(
        requested_color: PlayerColor | None,
        unavailable_colors: set[PlayerColor],
    ) -> PlayerColor:
        if requested_color is not None:
            if requested_color not in PLAYER_COLORS or requested_color in unavailable_colors:
                raise RoomError("COLOR_UNAVAILABLE", "That color is unavailable.")
            return requested_color

        for candidate in PLAYER_COLORS:
            if candidate not in unavailable_colors:
                return candidate
        raise RoomError("COLOR_UNAVAILABLE", "No player color is available.")

    @staticmethod
    def _first_available_seat(room: RoomState) -> int:
        occupied_seats = {player.seat_index for player in room.players}
        return next(
            seat_index
            for seat_index in range(room.max_players)
            if seat_index not in occupied_seats
        )

    @staticmethod
    def _identity_from(
        session: AuthenticatedSession | SessionIdentity,
    ) -> SessionIdentity:
        if isinstance(session, AuthenticatedSession):
            return session.identity
        if isinstance(session, SessionIdentity):
            return session
        raise RoomError("UNAUTHENTICATED", "Invalid room credentials.")

    @staticmethod
    def _snapshot_change(
        room: RoomState,
        event_type: str,
        payload: dict[str, object],
        request_id: str | None = None,
        *,
        additional_events: tuple[DomainEvent, ...] = (),
        include_state_sync: bool = True,
    ) -> RoomChange:
        # Cached changes contain prior room snapshots. They are not part of the
        # published state, and copying them makes each action slower over time.
        state_without_cache = copy.copy(room)
        state_without_cache.processed_changes = type(room.processed_changes)()
        state_snapshot = copy.deepcopy(state_without_cache)
        return RoomChange(
            state=state_snapshot,
            event_type=event_type,
            payload=copy.deepcopy(payload),
            request_id=request_id,
            additional_events=copy.deepcopy(additional_events),
            include_state_sync=include_state_sync,
        )

    @staticmethod
    def _cached_change(
        room: RoomState,
        player_id: str,
        request_id: str,
    ) -> RoomChange | None:
        cached = room.processed_changes.get((player_id, request_id))
        return copy.deepcopy(cached) if cached is not None else None

    @staticmethod
    def _cache_change(
        room: RoomState,
        player_id: str,
        request_id: str,
        change: RoomChange,
    ) -> None:
        # `change` is already detached from the live room. Command and
        # broadcast paths treat it as read-only; replay deep-copies it in
        # `_cached_change` before returning the cached response.
        room.processed_changes[(player_id, request_id)] = change
        while len(room.processed_changes) > MAX_PROCESSED_CHANGES:
            room.processed_changes.popitem(last=False)

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None:
            return now.replace(tzinfo=timezone.utc)
        return now.astimezone(timezone.utc)

    @staticmethod
    def _isoformat(value: datetime | None) -> str | None:
        if value is None:
            return None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")

    @staticmethod
    def _generate_room_code() -> str:
        return "".join(
            secrets.choice(ROOM_CODE_ALPHABET) for _ in range(ROOM_CODE_LENGTH)
        )

    @staticmethod
    def _generate_player_token() -> str:
        return secrets.token_urlsafe(32)

    @staticmethod
    def _generate_player_id() -> str:
        return secrets.token_urlsafe(16)

    @staticmethod
    def _credentials(
        room_code: str,
        player_id: str,
        player_token: str,
        is_host: bool,
    ) -> RoomCredentialData:
        return RoomCredentialData(
            room_code=room_code,
            player_id=player_id,
            player_token=player_token,
            is_host=is_host,
            ws_path=f"/api/ws/rooms/{room_code}",
        )

    @staticmethod
    def _unauthenticated() -> RoomError:
        return RoomError("UNAUTHENTICATED", "Invalid room credentials.")
