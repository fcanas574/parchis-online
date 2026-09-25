import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@/types/protocol";
import { clearSession, readSession, saveSession, type RoomSession } from "@/lib/session";
import { useGameStore } from "./gameStore";

const session = {
  roomCode: "AB7K2",
  playerId: "p1",
  playerToken: "token-123",
  isHost: true,
};

const sessionKey = "parchis:session:v1:AB7K2";

const syncEvent = (stateVersion: number): ServerEvent => ({
  type: "GAME_STATE_SYNC",
  version: 1,
  roomCode: "AB7K2",
  stateVersion,
  eventId: "evt-" + stateVersion,
  serverTime: "2026-09-14T18:30:00Z",
  payload: {
    room: {
      roomCode: "AB7K2",
      status: "lobby",
      maxPlayers: 4,
      hostPlayerId: "p1",
      players: [],
      stateVersion,
    },
  },
});

describe("game store", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it("hydrates the room from GAME_STATE_SYNC", () => {
    useGameStore.getState().applyEvent(syncEvent(2));

    expect(useGameStore.getState().room?.roomCode).toBe("AB7K2");
    expect(useGameStore.getState().lastStateVersion).toBe(2);
  });

  it("ignores an older state snapshot", () => {
    useGameStore.getState().applyEvent(syncEvent(4));
    useGameStore.getState().applyEvent(syncEvent(3));

    expect(useGameStore.getState().lastStateVersion).toBe(4);
    expect(useGameStore.getState().room?.stateVersion).toBe(4);
  });
});

describe("room session", () => {
  let storage: Storage;

  beforeEach(() => {
    const values = new Map<string, string>();
    storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear(),
      key: (index) => [...values.keys()][index] ?? null,
      get length() {
        return values.size;
      },
    };
    vi.stubGlobal("window", { localStorage: storage });
  });

  it("stores only the versioned room session and reads it back", () => {
    saveSession({ ...session, displayName: "must not persist" } as RoomSession);

    expect(storage.getItem(sessionKey)).toBe(JSON.stringify(session));
    expect(readSession("AB7K2")).toEqual(session);

    clearSession("AB7K2");
    expect(storage.getItem(sessionKey)).toBeNull();
  });

  it("removes malformed or incomplete saved data", () => {
    storage.setItem(sessionKey, "not-json");
    expect(readSession("AB7K2")).toBeNull();
    expect(storage.getItem(sessionKey)).toBeNull();

    storage.setItem(sessionKey, JSON.stringify({ roomCode: "AB7K2" }));
    expect(readSession("AB7K2")).toBeNull();
    expect(storage.getItem(sessionKey)).toBeNull();
  });

  it("does not access browser globals while rendering on the server", () => {
    vi.stubGlobal("window", undefined);

    expect(readSession("AB7K2")).toBeNull();
    expect(() => saveSession(session)).not.toThrow();
    expect(() => clearSession("AB7K2")).not.toThrow();
  });
});
