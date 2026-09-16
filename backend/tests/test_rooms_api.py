from itertools import chain, count, product

import pytest
from fastapi.testclient import TestClient

from app.api.rooms import get_room_manager, get_room_rate_limiter
from app.main import app
from app.repositories.memory_room_repository import MemoryRoomRepository
from app.security.rate_limit import FixedWindowRateLimiter
from app.services.room_manager import RoomManager


@pytest.fixture
def client(clock):
    generated_codes = chain(
        ("AB7K2",),
        (f"CD3{first}{second}" for first, second in product("ABCDEFGH", repeat=2)),
    )
    generated_tokens = (f"token-{token_id}" for token_id in count(1))
    manager = RoomManager(
        repository=MemoryRoomRepository(),
        code_generator=lambda: next(generated_codes),
        token_generator=lambda: next(generated_tokens),
        clock=clock,
    )
    limiter = FixedWindowRateLimiter(limit=20, window_seconds=60, clock=clock)
    app.dependency_overrides[get_room_manager] = lambda: manager
    app.dependency_overrides[get_room_rate_limiter] = lambda: limiter

    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()


def test_create_room_returns_credentials(client):
    response = client.post(
        "/api/rooms",
        json={"displayName": "Host", "playerCount": 4, "color": "green"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["roomCode"] == "AB7K2"
    assert body["playerId"]
    assert body["playerToken"]
    assert body["isHost"] is True
    assert body["wsPath"] == "/api/ws/rooms/AB7K2"


def test_join_room_returns_credentials_without_exposing_existing_tokens(client):
    created = client.post(
        "/api/rooms",
        json={"displayName": "Host", "playerCount": 4, "color": "green"},
    ).json()

    joined = client.post(
        f"/api/rooms/{created['roomCode']}/join",
        json={"displayName": "Guest", "color": "red"},
    )

    assert joined.status_code == 201
    public = client.get(f"/api/rooms/{created['roomCode']}")
    assert public.status_code == 200
    assert "playerToken" not in public.text


def test_join_unknown_room_returns_structured_error(client):
    response = client.post(
        "/api/rooms/ZZZZZ/join",
        json={"displayName": "Guest"},
    )

    assert response.status_code == 404
    assert response.json()["code"] == "ROOM_NOT_FOUND"


def test_malformed_room_code_returns_bad_request(client):
    response = client.get("/api/rooms/not-a-room")

    assert response.status_code == 400
    assert response.json()["code"] == "INVALID_ROOM_CODE"


def test_admission_conflict_returns_structured_conflict(client):
    created = client.post(
        "/api/rooms",
        json={"displayName": "Host", "playerCount": 4, "color": "green"},
    ).json()

    response = client.post(
        f"/api/rooms/{created['roomCode']}/join",
        json={"displayName": "Guest", "color": "green"},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "COLOR_UNAVAILABLE"
    assert response.json()["message"]


def test_configured_origin_receives_cors_headers(client):
    response = client.options(
        "/api/rooms",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == (
        "http://localhost:3000"
    )


def test_room_mutations_are_rate_limited_per_client_host(client):
    for request_number in range(20):
        response = client.post(
            "/api/rooms",
            json={
                "displayName": f"Host {request_number}",
                "playerCount": 4,
                "color": "green",
            },
        )
        assert response.status_code == 201

    limited = client.post(
        "/api/rooms",
        json={"displayName": "Limited", "playerCount": 4, "color": "green"},
    )

    assert limited.status_code == 429
    assert limited.json()["code"] == "RATE_LIMITED"


def test_join_attempts_are_rate_limited_per_client_host(client):
    for _ in range(20):
        response = client.post(
            "/api/rooms/ZZZZZ/join",
            json={"displayName": "Guest"},
        )
        assert response.status_code == 404

    limited = client.post(
        "/api/rooms/ZZZZZ/join",
        json={"displayName": "Guest"},
    )

    assert limited.status_code == 429
    assert limited.json()["code"] == "RATE_LIMITED"
