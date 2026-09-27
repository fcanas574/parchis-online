from fastapi import APIRouter, Depends, Request, status
from fastapi.responses import JSONResponse

from app.api.rooms import (
    _enforce_rate_limit,
    _error_response,
    get_room_manager,
    get_room_rate_limiter,
)
from app.config import settings
from app.schemas.rooms import CreateRoomRequest, RoomCredentials
from app.security.rate_limit import FixedWindowRateLimiter
from app.services.room_manager import RoomError, RoomManager


router = APIRouter(tags=["practice"])


@router.post("/api/practice", response_model=RoomCredentials, status_code=status.HTTP_201_CREATED)
async def create_practice(
    request_body: CreateRoomRequest,
    request: Request,
    manager: RoomManager = Depends(get_room_manager),
    limiter: FixedWindowRateLimiter = Depends(get_room_rate_limiter),
):
    if not settings.practice_mode_enabled:
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={
                "code": "PRACTICE_DISABLED",
                "message": "Practice mode is disabled on this server.",
            },
        )
    try:
        _enforce_rate_limit(request, limiter)
        return await manager.create_practice_room(
            display_name=request_body.display_name,
            player_count=request_body.player_count,
            color=request_body.color,
        )
    except RoomError as error:
        return _error_response(error)
