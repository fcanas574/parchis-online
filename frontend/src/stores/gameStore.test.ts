import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage } from "@/types/game";
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

  it("sync hydrates social state without replaying transient events", () => {
    const game = gameStateFixture({
      turnNumber: 9,
      lastRollsByPlayerId: {
        p1: { values: [6, 2], turnNumber: 9 },
      },
    });
    const room = gameRoomFixture({
      status: "playing",
      gameState: game,
      players: gameRoomFixture().players.map((player, index) =>
        index === 0
          ? {
              ...player,
              diceSkinId: "jade",
              pieceSkinId: "glow",
              lastReceivedGiftId: "rose",
            }
          : player,
      ),
    });

    useGameStore.getState().applyEvent(gameSyncEvent({ room }));

    expect(useGameStore.getState().room?.players[0]).toMatchObject({
      diceSkinId: "jade",
      pieceSkinId: "glow",
      lastReceivedGiftId: "rose",
    });
    expect(useGameStore.getState().room?.gameState).toMatchObject({
      turnNumber: 9,
      lastRollsByPlayerId: { p1: { values: [6, 2], turnNumber: 9 } },
    });
    expect(useGameStore.getState().recentEvents).toEqual([]);
  });

  it("reconciles live chat with history by message ID and caps the list at 50", () => {
    const message = (messageId: string, sentAt: string): ChatMessage => ({
      messageId,
      playerId: "p1",
      displayName: "Felipe",
      text: `mensaje ${messageId}`,
      sentAt,
    });
    const staleMessage = message("stale", "2026-09-29T11:00:00Z");
    const firstHistoryMessage = message("message-1", "2026-09-29T12:00:00Z");
    const liveMessage = message("message-2", "2026-09-29T12:01:00Z");
    const liveEvent: Extract<ServerEvent, { type: "CHAT_MESSAGE" }> = {
      type: "CHAT_MESSAGE",
      version: 1,
      roomCode: "AB7K2",
      stateVersion: 2,
      eventId: "evt-live-chat",
      serverTime: liveMessage.sentAt,
      payload: liveMessage,
    };
    const historyEvent: Extract<ServerEvent, { type: "CHAT_HISTORY_SYNC" }> = {
      type: "CHAT_HISTORY_SYNC",
      version: 1,
      roomCode: "AB7K2",
      stateVersion: 2,
      eventId: "evt-chat-history",
      serverTime: liveMessage.sentAt,
      payload: { messages: [firstHistoryMessage, liveMessage] },
    };

    useGameStore.getState().applyEvent({
      ...liveEvent,
      eventId: "evt-stale-chat",
      payload: staleMessage,
    });
    useGameStore.getState().clearTransientEvents();
    useGameStore.getState().applyEvent(liveEvent);
    useGameStore.getState().applyEvent(historyEvent);
    useGameStore.getState().applyEvent(liveEvent);

    expect(useGameStore.getState().chatRoomCode).toBe("AB7K2");
    expect(useGameStore.getState().chatHistoryReady).toBe(true);
    expect(useGameStore.getState().chatMessages).toEqual([
      firstHistoryMessage,
      liveMessage,
    ]);
    expect(useGameStore.getState().recentEvents).toEqual([]);

    const messages = Array.from({ length: 51 }, (_, index) =>
      message(`history-${index}`, `2026-09-29T12:${String(index).padStart(2, "0")}:00Z`),
    );
    useGameStore.getState().clearTransientEvents();
    expect(useGameStore.getState().chatHistoryReady).toBe(false);
    useGameStore.getState().applyEvent({
      ...historyEvent,
      eventId: "evt-full-history",
      payload: { messages },
    });
    expect(useGameStore.getState().chatMessages).toHaveLength(50);
    expect(useGameStore.getState().chatMessages[0]?.messageId).toBe("history-1");
  });

  it("keeps the room identity attached to chat so another room never renders its history", () => {
    const firstMessage: ChatMessage = {
      messageId: "first-room-message",
      playerId: "p1",
      displayName: "Felipe",
      text: "solo para esta sala",
      sentAt: "2026-09-29T12:00:00Z",
    };
    const secondMessage: ChatMessage = {
      ...firstMessage,
      messageId: "second-room-message",
      text: "otra sala",
    };
    const firstHistory: ServerEvent = {
      type: "CHAT_HISTORY_SYNC", version: 1, roomCode: "AB7K2", stateVersion: 1,
      eventId: "history-ab7k2", serverTime: firstMessage.sentAt, payload: { messages: [firstMessage] },
    };
    useGameStore.getState().applyEvent(firstHistory);

    const nextRoom = gameRoomFixture({ roomCode: "CD9JK", stateVersion: 2 });
    useGameStore.getState().applyEvent(gameSyncEvent({ room: nextRoom }));
    expect(useGameStore.getState().room?.roomCode).toBe("CD9JK");
    expect(useGameStore.getState().chatRoomCode).toBe("AB7K2");

    const nextHistory: ServerEvent = {
      type: "CHAT_HISTORY_SYNC", version: 1, roomCode: "CD9JK", stateVersion: 2,
      eventId: "history-cd9jk", serverTime: secondMessage.sentAt, payload: { messages: [secondMessage] },
    };
    useGameStore.getState().applyEvent(nextHistory);
    expect(useGameStore.getState().chatRoomCode).toBe("CD9JK");
    expect(useGameStore.getState().chatMessages).toEqual([secondMessage]);
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
