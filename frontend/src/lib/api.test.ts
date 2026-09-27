import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createPracticeRoom, createRoom, getRoom } from "./api";

const createPayload = {
  displayName: "Felipe",
  playerCount: 4 as const,
};

const response = (body: unknown, init: Partial<Response> = {}) => ({
  ok: true,
  status: 200,
  statusText: "OK",
  json: vi.fn().mockResolvedValue(body),
  ...init,
});

describe("room API response validation", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_API_ORIGIN = "http://localhost:8000";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects an incomplete 2xx room credentials response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({})));

    await expect(createRoom(createPayload)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      message: "Room service returned an invalid response.",
    });
  });

  it("creates a practice through its dedicated endpoint and validates credentials", async () => {
    const credentials = {
      roomCode: "AB7K2",
      playerId: "p1",
      playerToken: "secret-token",
      isHost: true,
      wsPath: "/api/ws/rooms/AB7K2",
    };
    const fetchMock = vi.fn().mockResolvedValue(response(credentials, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await createPracticeRoom({
      displayName: "Felipe",
      playerCount: 5,
      color: "purple",
    });

    expect(result).toEqual(credentials);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/api/practice", "http://localhost:8000"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ displayName: "Felipe", playerCount: 5, color: "purple" }),
      }),
    );
  });

  it("rejects malformed practice credentials and preserves disabled-mode errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ roomCode: "AB7K2" }, { status: 201 })));
    await expect(createPracticeRoom(createPayload)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response(
        { code: "PRACTICE_DISABLED", message: "Practice mode is disabled on this server." },
        { ok: false, status: 403, statusText: "Forbidden" },
      )),
    );
    await expect(createPracticeRoom(createPayload)).rejects.toMatchObject({
      code: "PRACTICE_DISABLED",
      message: "Practice mode is disabled on this server.",
    });
  });

  it("rejects an incomplete 2xx public room response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          roomCode: "AB7K2",
          status: "lobby",
          maxPlayers: 4,
          hostPlayerId: "p1",
          players: [],
        }),
      ),
    );

    await expect(getRoom("AB7K2")).rejects.toBeInstanceOf(ApiError);
    await expect(getRoom("AB7K2")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("requires mode and bot flags in public room responses", async () => {
    const publicRoom = {
      roomCode: "AB7K2",
      mode: "practice",
      status: "playing",
      maxPlayers: 4,
      hostPlayerId: "p1",
      players: [{
        id: "p1", displayName: "Felipe", color: "green", seatIndex: 0,
        isHost: true, isBot: false, isReady: false, isConnected: true,
        reservationExpiresAt: null,
      }],
      stateVersion: 1,
      gameState: null,
      lastGameResult: null,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response(publicRoom)));
    await expect(getRoom("AB7K2")).resolves.toMatchObject({ mode: "practice" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ ...publicRoom, mode: undefined })));
    await expect(getRoom("AB7K2")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      ...publicRoom,
      players: [{ ...publicRoom.players[0], isBot: undefined }],
    })));
    await expect(getRoom("AB7K2")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("preserves structured non-2xx API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          { code: "ROOM_FULL", message: "The room is full." },
          { ok: false, status: 409, statusText: "Conflict" },
        ),
      ),
    );

    await expect(createRoom(createPayload)).rejects.toMatchObject({
      code: "ROOM_FULL",
      message: "The room is full.",
    });
  });
});
