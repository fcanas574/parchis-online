import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, createRoom, getRoom } from "./api";

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
