from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from threading import Lock


class FixedWindowRateLimiter:
    def __init__(
        self,
        limit: int,
        window_seconds: int,
        clock: Callable[[], datetime],
    ) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self.clock = clock
        self._windows: dict[str, tuple[datetime, int]] = {}
        self._lock = Lock()

    def allow(self, key: str) -> bool:
        now = self.clock()
        with self._lock:
            window_start, request_count = self._windows.get(key, (now, 0))
            if now - window_start >= timedelta(seconds=self.window_seconds):
                window_start = now
                request_count = 0

            if request_count >= self.limit:
                return False

            self._windows[key] = (window_start, request_count + 1)
            return True


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
