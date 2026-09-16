from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse

from app.config import settings
from app.repositories.memory_room_repository import MemoryRoomRepository
from app.schemas.rooms import CreateRoomRequest, JoinRoomRequest, RoomCredentials
from app.security.rate_limit import FixedWindowRateLimiter, utc_now
from app.services.room_manager import RoomError, RoomManager


router = APIRouter(prefix="/api/rooms", tags=["rooms"])

_room_repository = MemoryRoomRepository()
_room_manager = RoomManager(
    repository=_room_repository,
    reservation_ttl_seconds=settings.reservation_ttl_seconds,
)
_room_rate_limiter = FixedWindowRateLimiter(
    limit=settings.room_requests_per_minute,
    window_seconds=60,
    clock=utc_now,
)

_ERROR_STATUS_CODES = {
    "ROOM_NOT_FOUND": status.HTTP_404_NOT_FOUND,
    "ROOM_FULL": status.HTTP_409_CONFLICT,
    "COLOR_UNAVAILABLE": status.HTTP_409_CONFLICT,
    "ROOM_ALREADY_STARTED": status.HTTP_409_CONFLICT,
    "INVALID_NAME": status.HTTP_409_CONFLICT,
    "RATE_LIMITED": status.HTTP_429_TOO_MANY_REQUESTS,
}


def get_room_manager() -> RoomManager:
    return _room_manager


def get_room_rate_limiter() -> FixedWindowRateLimiter:
    return _room_rate_limiter


def _error_response(error: RoomError) -> JSONResponse:
    return JSONResponse(
        status_code=_ERROR_STATUS_CODES.get(error.code, status.HTTP_400_BAD_REQUEST),
        content={"code": error.code, "message": error.message},
    )


def _enforce_rate_limit(
    request: Request,
    limiter: FixedWindowRateLimiter,
) -> None:
    client_host = request.client.host if request.client is not None else "unknown"
    if not limiter.allow(client_host):
        raise RoomError(
            "RATE_LIMITED",
            "Too many room requests. Try again later.",
        )


@router.post("", response_model=RoomCredentials, status_code=status.HTTP_201_CREATED)
async def create_room(
    request_body: CreateRoomRequest,
    request: Request,
    manager: RoomManager = Depends(get_room_manager),
    limiter: FixedWindowRateLimiter = Depends(get_room_rate_limiter),
):
    try:
        _enforce_rate_limit(request, limiter)
        return await manager.create_room(
            display_name=request_body.display_name,
            player_count=request_body.player_count,
            color=request_body.color,
        )
    except RoomError as error:
        return _error_response(error)


@router.post(
    "/{room_code}/join",
    response_model=RoomCredentials,
    status_code=status.HTTP_201_CREATED,
)
async def join_room(
    room_code: str,
    request_body: JoinRoomRequest,
    request: Request,
    manager: RoomManager = Depends(get_room_manager),
    limiter: FixedWindowRateLimiter = Depends(get_room_rate_limiter),
):
    try:
        _enforce_rate_limit(request, limiter)
        return await manager.join_room(
            room_code=room_code,
            display_name=request_body.display_name,
            color=request_body.color,
        )
    except RoomError as error:
        return _error_response(error)


@router.get("/{room_code}")
async def get_room(
    room_code: str,
    manager: RoomManager = Depends(get_room_manager),
):
    try:
        return await manager.public_room(room_code)
    except RoomError as error:
        return _error_response(error)
