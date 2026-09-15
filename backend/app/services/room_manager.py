import asyncio
import copy
import hashlib
import hmac
import re
import secrets
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from app.game.models import (
    AuthenticatedSession,
    PlayerState,
    RoomChange,
    RoomCredentialData,
    RoomState,
    SessionIdentity,
)
from app.repositories.room_repository import RoomCodeCollisionError, RoomRepository
from app.schemas.rooms import PlayerColor, PlayerCount


ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
PLAYER_COLORS = ("green", "red", "blue", "yellow", "purple", "orange")
ROOM_CODE_LENGTH = 5
MAX_PROCESSED_CHANGES = 128
_ROOM_CODE_PATTERN = re.compile(
    rf"^[{re.escape(ROOM_CODE_ALPHABET)}]{{{ROOM_CODE_LENGTH}}}$"
)


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
    ) -> None:
        self._repository = repository
        self._code_generator = code_generator or self._generate_room_code
        self._token_generator = token_generator or self._generate_player_token
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._reservation_ttl_seconds = reservation_ttl_seconds
        self._room_locks: dict[str, asyncio.Lock] = {}
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
            room_lock = await self._lock_for(room_code)
            async with room_lock:
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

                return self._credentials(room_code, player_id, player_token, True)

    async def join_room(
        self,
        room_code: str,
        display_name: str,
        color: PlayerColor | None,
    ) -> RoomCredentialData:
        self._validate_room_code(room_code)
        normalized_name = self._validate_display_name(display_name)
        room_lock = await self._lock_for(room_code)

        async with room_lock:
            room = await self._require_room(room_code)
            await self._prune_expired_locked(room)
            room = await self._require_room(room_code)

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
        room_lock = await self._lock_for(room_code)
        async with room_lock:
            return copy.deepcopy(await self._require_room(room_code))

    async def public_room(self, room_code: str) -> dict:
        self._validate_room_code(room_code)
        room_lock = await self._lock_for(room_code)
        async with room_lock:
            return self.public_room_from_state(await self._require_room(room_code))

    def public_room_from_state(self, state: RoomState) -> dict:
        return {
            "roomCode": state.room_code,
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
                    "isReady": player.is_ready,
                    "isConnected": player.is_connected,
                    "reservationExpiresAt": self._isoformat(
                        player.reservation_expires_at
                    ),
                }
                for player in sorted(state.players, key=lambda item: item.seat_index)
            ],
            "stateVersion": state.state_version,
        }

    async def authenticate(
        self,
        room_code: str,
        player_token: str,
    ) -> AuthenticatedSession:
        self._validate_room_code(room_code)
        if not isinstance(player_token, str) or not player_token:
            raise self._unauthenticated()
        room_lock = await self._lock_for(room_code)
        room_deleted = False
        try:
            async with room_lock:
                room = await self._repository.get(room_code)
                if room is None:
                    raise self._unauthenticated()

                room_deleted = await self._prune_expired_locked(room)
                if room_deleted:
                    raise self._unauthenticated()

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

                is_reconnect = player.has_connected and not player.is_connected
                changed = (
                    not player.has_connected
                    or not player.is_connected
                    or player.reservation_expires_at is not None
                )
                player.has_connected = True
                player.is_connected = True
                player.reservation_expires_at = None
                if changed:
                    room.state_version += 1
                    await self._repository.save(room)

                return AuthenticatedSession(
                    identity=SessionIdentity(room_code, player.id),
                    is_reconnect=is_reconnect,
                )
        finally:
            if room_deleted:
                await self._remove_lock(room_code, room_lock)

    async def disconnect(
        self,
        session: AuthenticatedSession | SessionIdentity,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        room_lock = await self._lock_for(identity.room_code)
        async with room_lock:
            room = await self._require_room(identity.room_code)
            player = self._require_player(room, identity.player_id)
            expires_at = self._now() + timedelta(
                seconds=self._reservation_ttl_seconds
            )
            player.is_connected = False
            player.is_ready = False
            player.reservation_expires_at = expires_at
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

    async def set_ready(
        self,
        session: AuthenticatedSession | SessionIdentity,
        ready: bool,
        request_id: str,
    ) -> RoomChange:
        identity = self._identity_from(session)
        self._validate_room_code(identity.room_code)
        self._validate_request_id(request_id)
        room_lock = await self._lock_for(identity.room_code)
        async with room_lock:
            room = await self._require_room(identity.room_code)
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
        room_lock = await self._lock_for(identity.room_code)
        async with room_lock:
            room = await self._require_room(identity.room_code)
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

    async def prune_expired_reservations(self, room_code: str) -> None:
        self._validate_room_code(room_code)
        room_lock = await self._lock_for(room_code)
        room_deleted = False
        async with room_lock:
            room = await self._repository.get(room_code)
            if room is not None:
                room_deleted = await self._prune_expired_locked(room)
        if room_deleted:
            await self._remove_lock(room_code, room_lock)

    async def _prune_expired_locked(self, room: RoomState) -> bool:
        now = self._now()
        expired_ids = {
            player.id
            for player in room.players
            if player.reservation_expires_at is not None
            and player.reservation_expires_at <= now
        }
        if not expired_ids:
            return False

        host_expired = room.host_player_id in expired_ids
        room.players = [
            player for player in room.players if player.id not in expired_ids
        ]
        if not room.players:
            await self._repository.delete(room.room_code)
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
        await self._repository.save(room)
        return False

    async def _require_room(self, room_code: str) -> RoomState:
        room = await self._repository.get(room_code)
        if room is None:
            raise RoomError("ROOM_NOT_FOUND", "Room not found.")
        return room

    @staticmethod
    def _require_player(room: RoomState, player_id: str) -> PlayerState:
        player = next(
            (candidate for candidate in room.players if candidate.id == player_id),
            None,
        )
        if player is None:
            raise RoomError("UNAUTHENTICATED", "Invalid room credentials.")
        return player

    async def _lock_for(self, room_code: str) -> asyncio.Lock:
        async with self._locks_guard:
            return self._room_locks.setdefault(room_code, asyncio.Lock())

    async def _remove_lock(self, room_code: str, room_lock: asyncio.Lock) -> None:
        async with self._locks_guard:
            if self._room_locks.get(room_code) is room_lock:
                self._room_locks.pop(room_code, None)

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
    ) -> RoomChange:
        state_snapshot = copy.deepcopy(room)
        state_snapshot.processed_changes.clear()
        return RoomChange(
            state=state_snapshot,
            event_type=event_type,
            payload=copy.deepcopy(payload),
            request_id=request_id,
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
        room.processed_changes[(player_id, request_id)] = copy.deepcopy(change)
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
