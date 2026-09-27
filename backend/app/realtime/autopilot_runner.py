import asyncio
import logging
from collections.abc import Awaitable, Callable


logger = logging.getLogger(__name__)


class RoomAutopilotRunner:
    """Keep at most one scheduled autopilot worker per room."""

    def __init__(self) -> None:
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def schedule(
        self,
        room_code: str,
        coroutine_factory: Callable[[], Awaitable[None]],
    ) -> asyncio.Task[None]:
        current = self._tasks.get(room_code)
        if current is not None and not current.done():
            return current

        task = asyncio.create_task(
            coroutine_factory(),
            name=f"parchis-autopilot:{room_code}",
        )
        self._tasks[room_code] = task
        task.add_done_callback(
            lambda completed, code=room_code: self._on_done(code, completed)
        )
        return task

    def _on_done(self, room_code: str, task: asyncio.Task[None]) -> None:
        if self._tasks.get(room_code) is task:
            self._tasks.pop(room_code, None)
        if task.cancelled():
            return

        error = task.exception()
        if error is not None:
            logger.error(
                "Room autopilot worker failed for %s",
                room_code,
                exc_info=(type(error), error, error.__traceback__),
            )
