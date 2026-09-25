import { describe, expect, it } from "vitest";
import { isServerEvent } from "./useGameSocket";

const syncMessage = (overrides: Record<string, unknown> = {}) => ({
  type: "GAME_STATE_SYNC",
  version: 1,
  roomCode: "AB7K2",
  stateVersion: 4,
  eventId: "evt-4",
  serverTime: "2026-09-14T18:30:00Z",
  payload: {
    room: {
      roomCode: "AB7K2",
      status: "lobby",
      maxPlayers: 4,
      hostPlayerId: "p1",
      players: [],
      stateVersion: 4,
    },
  },
  ...overrides,
});

describe("WebSocket server-event validation", () => {
  it("rejects a snapshot whose room identity or version disagrees with its envelope", () => {
    expect(
      isServerEvent(
        syncMessage({
          payload: {
            room: {
              roomCode: "ZZ9Y8",
              status: "lobby",
              maxPlayers: 4,
              hostPlayerId: "p1",
              players: [],
              stateVersion: 3,
            },
          },
        }),
      ),
    ).toBe(false);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects a non-finite or non-integer event state version: %s",
    (stateVersion) => {
      expect(isServerEvent(syncMessage({ stateVersion }))).toBe(false);
    },
  );

  it("accepts a consistent authoritative snapshot", () => {
    expect(isServerEvent(syncMessage())).toBe(true);
  });
});
