import asyncio

import pytest

from app.realtime.autopilot_runner import RoomAutopilotRunner


@pytest.mark.asyncio
async def test_autopilot_runner_deduplicates_workers_per_room():
    runner = RoomAutopilotRunner()
    release = asyncio.Event()

    async def wait_for_release():
        await release.wait()

    first = runner.schedule("AB7K2", wait_for_release)
    second = runner.schedule("AB7K2", wait_for_release)

    assert first is second
    release.set()
    await first


@pytest.mark.asyncio
async def test_autopilot_runner_allows_new_worker_after_completion():
    runner = RoomAutopilotRunner()

    async def complete_immediately():
        return None

    first = runner.schedule("AB7K2", complete_immediately)
    await first
    second = runner.schedule("AB7K2", complete_immediately)

    assert second is not first
    await second


@pytest.mark.asyncio
async def test_autopilot_runner_allows_retry_after_worker_failure():
    runner = RoomAutopilotRunner()

    async def fail():
        raise RuntimeError("injected autopilot failure")

    first = runner.schedule("AB7K2", fail)
    with pytest.raises(RuntimeError, match="injected autopilot failure"):
        await first

    async def retry():
        return None

    second = runner.schedule("AB7K2", retry)
    assert second is not first
    await second
