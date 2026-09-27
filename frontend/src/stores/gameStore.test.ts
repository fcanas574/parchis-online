import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "@/types/protocol";
import {
  gameRoomFixture,
  gameStateFixture,
  gameSyncEvent,
} from "@/test/game-fixtures";
import { clearSession, readSession, saveSession, type RoomSession } from "@/lib/session";
import { useGameStore } from "./gameStore";

const session = {
  roomCode: "AB7K2",
  playerId: "p1",
  playerToken: "token-123",
  isHost: true,
};

const sessionKey = "parchis:session:v1:AB7K2";

describe("game store", () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it("hydrates the room from GAME_STATE_SYNC", () => {
    useGameStore.getState().applyEvent(
      gameSyncEvent({
        stateVersion: 2,
        room: gameRoomFixture({ stateVersion: 2 }),
      }),
    );

    expect(useGameStore.getState().room?.roomCode).toBe("AB7K2");
    expect(useGameStore.getState().lastStateVersion).toBe(2);
  });

  it("ignores an older state snapshot", () => {
    useGameStore.getState().applyEvent(
      gameSyncEvent({
        stateVersion: 4,
        room: gameRoomFixture({ stateVersion: 4 }),
      }),
    );
    useGameStore.getState().applyEvent(
      gameSyncEvent({
        stateVersion: 3,
        room: gameRoomFixture({ stateVersion: 3 }),
      }),
    );

    expect(useGameStore.getState().lastStateVersion).toBe(4);
    expect(useGameStore.getState().room?.stateVersion).toBe(4);
  });

  it("keeps piece positions unchanged on semantic events until the next snapshot", () => {
    const game = gameStateFixture();
    const room = gameRoomFixture({
      status: "playing",
      stateVersion: 12,
      gameState: game,
    });
    useGameStore.getState().applyEvent(gameSyncEvent({ room, stateVersion: 12 }));

    const event: Extract<ServerEvent, { type: "PIECE_MOVED" }> = {
      type: "PIECE_MOVED",
      version: 1,
      roomCode: "AB7K2",
      stateVersion: 13,
      eventId: "evt-move",
      serverTime: "2026-09-25T18:30:00Z",
      payload: {
        pieceId: "p1-piece-1",
        from: { state: "yard", trackPosition: null, finishProgress: null },
        to: { state: "track", trackPosition: 0, finishProgress: null },
        diceIndices: [0],
        path: [{ state: "track", trackPosition: 0, finishProgress: null }],
      },
    };
    useGameStore.getState().applyEvent(event);

    expect(useGameStore.getState().room?.gameState?.pieces).toEqual(game.pieces);
    expect(useGameStore.getState().lastStateVersion).toBe(13);
    expect(useGameStore.getState().recentEvents.at(-1)).toEqual(event);

    const updatedGame = gameStateFixture({
      pieces: game.pieces.map((piece) =>
        piece.id === "p1-piece-1"
          ? { ...piece, state: "track", trackPosition: 0 }
          : piece,
      ),
    });
    const updatedRoom = gameRoomFixture({
      status: "playing",
      stateVersion: 13,
      gameState: updatedGame,
    });
    useGameStore.getState().applyEvent(
      gameSyncEvent({ room: updatedRoom, stateVersion: 13 }),
    );
    expect(useGameStore.getState().room?.gameState?.pieces).toEqual(
      updatedGame.pieces,
    );
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
