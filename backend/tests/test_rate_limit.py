from app.security.rate_limit import FixedWindowRateLimiter


def test_fixed_window_allows_twenty_requests_and_resets_after_sixty_seconds(clock):
    limiter = FixedWindowRateLimiter(limit=20, window_seconds=60, clock=clock)

    assert [limiter.allow("127.0.0.1") for _ in range(20)] == [True] * 20
    assert limiter.allow("127.0.0.1") is False

    clock.advance(seconds=60)
    assert limiter.allow("127.0.0.1") is True
