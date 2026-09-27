import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  gameRoomFixture,
  gameStateFixture,
  gameSyncEvent,
} from "@/test/game-fixtures";
import { useGameStore } from "@/stores/gameStore";

const { createRoomSocketMock } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_ORIGIN ??= "http://localhost:8000";
  return { createRoomSocketMock: vi.fn() };
});

vi.mock("@/lib/websocket", () => ({ createRoomSocket: createRoomSocketMock }));

import { isServerEvent, useGameSocket } from "./useGameSocket";

type FakeSocket = {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const createFakeSocket = (): FakeSocket => ({
  readyState: WebSocket.CONNECTING,
  onopen: null,
  onmessage: null,
  onerror: null,
  onclose: null,
  send: vi.fn(),
  close: vi.fn(),
});

const snapshotEvent = gameSyncEvent({
  room: gameRoomFixture({ stateVersion: 4 }),
  stateVersion: 4,
});

beforeEach(() => {
  useGameStore.getState().reset();
  createRoomSocketMock.mockReset();
});

const syncMessage = (overrides: Record<string, unknown> = {}) => ({
  ...snapshotEvent,
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

  it("waits for an authoritative snapshot before reporting a connected room", () => {
    const socket = createFakeSocket();
    createRoomSocketMock.mockReturnValue(socket as unknown as WebSocket);
    useGameStore.getState().setSession({
      roomCode: "AB7K2",
      playerId: "p1",
      playerToken: "player-token",
      isHost: true,
    });

    const { unmount } = renderHook(() => useGameSocket("AB7K2"));
    expect(useGameStore.getState().connectionState).toBe("connecting");

    act(() => {
      socket.readyState = WebSocket.OPEN;
      socket.onopen?.(new Event("open"));
    });

    expect(useGameStore.getState().connectionState).toBe("connecting");
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: "RECONNECT",
        version: 1,
        roomCode: "AB7K2",
        playerToken: "player-token",
      }),
    );

    act(() => {
      socket.onmessage?.({ data: JSON.stringify(snapshotEvent) } as MessageEvent);
    });

    expect(useGameStore.getState().connectionState).toBe("connected");
    expect(useGameStore.getState().room?.stateVersion).toBe(4);
    unmount();
  });

  it("keeps the last valid snapshot and reports an inconsistent game sync", () => {
    const game = gameStateFixture();
    const room = gameRoomFixture({
      status: "playing",
      stateVersion: 4,
      gameState: game,
    });
    const validSnapshot = gameSyncEvent({ room, stateVersion: 4 });
    const socket = createFakeSocket();
    createRoomSocketMock.mockReturnValue(socket as unknown as WebSocket);
    useGameStore.getState().setSession({
      roomCode: "AB7K2",
      playerId: "p1",
      playerToken: "player-token",
      isHost: true,
    });
    const { unmount } = renderHook(() => useGameSocket("AB7K2"));

    act(() => {
      socket.readyState = WebSocket.OPEN;
      socket.onopen?.(new Event("open"));
      socket.onmessage?.({
        data: JSON.stringify(validSnapshot),
      } as MessageEvent);
    });
    const lastValidRoom = useGameStore.getState().room;
    const inconsistentSnapshot = {
      ...validSnapshot,
      stateVersion: 5,
      eventId: "evt-inconsistent",
      payload: {
        ...validSnapshot.payload,
        game: { ...game, currentPlayerId: "p2" },
      },
    };

    act(() => {
      socket.onmessage?.({
        data: JSON.stringify(inconsistentSnapshot),
      } as MessageEvent);
    });

    expect(useGameStore.getState().room).toBe(lastValidRoom);
    expect(useGameStore.getState().lastError?.code).toBe("INVALID_MESSAGE");
    expect(useGameStore.getState().connectionState).toBe("connected");
    unmount();
  });

  it("sends gameplay intents and waits for sync before changing local pieces", () => {
    const initialGame = gameStateFixture();
    const initialRoom = gameRoomFixture({
      status: "playing",
      stateVersion: 4,
      gameState: initialGame,
    });
    const initialSnapshot = gameSyncEvent({ room: initialRoom, stateVersion: 4 });
    const socket = createFakeSocket();
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce("req-roll")
      .mockReturnValueOnce("req-move")
      .mockReturnValueOnce("req-bonus")
      .mockReturnValueOnce("req-lobby")
      .mockReturnValueOnce("req-again");
    vi.stubGlobal("crypto", { randomUUID });
    createRoomSocketMock.mockReturnValue(socket as unknown as WebSocket);
    useGameStore.getState().setSession({
      roomCode: "AB7K2",
      playerId: "p1",
      playerToken: "player-token",
      isHost: true,
    });

    const { result, unmount } = renderHook(() => useGameSocket("AB7K2"));
    act(() => {
      socket.readyState = WebSocket.OPEN;
      socket.onopen?.(new Event("open"));
      socket.onmessage?.({ data: JSON.stringify(initialSnapshot) } as MessageEvent);
    });
    const originalPieces = initialGame.pieces;

    act(() => {
      expect(result.current.sendRollDice()).toBe(true);
      expect(result.current.sendMovePiece("p1-piece-1", [0])).toBe(true);
      expect(result.current.sendMoveBonusPiece("p1-piece-1")).toBe(true);
      expect(result.current.sendReturnToLobby()).toBe(true);
      expect(result.current.sendPlayAgain()).toBe(true);
    });

    const commands = socket.send.mock.calls
      .slice(1)
      .map(([raw]) => JSON.parse(raw as string) as Record<string, unknown>);
    expect(commands).toEqual([
      { type: "ROLL_DICE", version: 1, requestId: "req-roll" },
      {
        type: "MOVE_PIECE",
        version: 1,
        requestId: "req-move",
        pieceId: "p1-piece-1",
        diceIndices: [0],
      },
      {
        type: "MOVE_BONUS_PIECE",
        version: 1,
        requestId: "req-bonus",
        pieceId: "p1-piece-1",
      },
      { type: "RETURN_TO_LOBBY", version: 1, requestId: "req-lobby" },
      { type: "PLAY_AGAIN", version: 1, requestId: "req-again" },
    ]);
    expect(useGameStore.getState().room?.gameState?.pieces).toEqual(originalPieces);

    act(() => {
      socket.onmessage?.({
        data: JSON.stringify({
          type: "PIECE_MOVED",
          version: 1,
          roomCode: "AB7K2",
          stateVersion: 5,
          eventId: "evt-move",
          serverTime: "2026-09-25T18:30:00Z",
          payload: {
            pieceId: "p1-piece-1",
            from: { state: "yard", trackPosition: null, finishProgress: null },
            to: { state: "track", trackPosition: 0, finishProgress: null },
            diceIndices: [0],
            path: [{ state: "track", trackPosition: 0, finishProgress: null }],
          },
        }),
      } as MessageEvent);
    });
    expect(useGameStore.getState().room?.gameState?.pieces).toEqual(originalPieces);

    const movedGame = gameStateFixture({
      pieces: originalPieces.map((piece) =>
        piece.id === "p1-piece-1"
          ? { ...piece, state: "track", trackPosition: 0 }
          : piece,
      ),
    });
    const movedRoom = gameRoomFixture({
      status: "playing",
      stateVersion: 6,
      gameState: movedGame,
    });
    act(() => {
      socket.onmessage?.({
        data: JSON.stringify(gameSyncEvent({ room: movedRoom, stateVersion: 6 })),
      } as MessageEvent);
    });
    expect(useGameStore.getState().room?.gameState?.pieces).toEqual(
      movedGame.pieces,
    );

    unmount();
    vi.unstubAllGlobals();
  });

  it("closes a socket with a malformed movement path and rehandshakes for a snapshot", () => {
    vi.useFakeTimers();
    try {
      const firstSocket = createFakeSocket();
      const nextSocket = createFakeSocket();
      createRoomSocketMock
        .mockReturnValueOnce(firstSocket as unknown as WebSocket)
        .mockReturnValueOnce(nextSocket as unknown as WebSocket);
      useGameStore.getState().setSession({
        roomCode: "AB7K2", playerId: "p1", playerToken: "player-token", isHost: true,
      });
      const { unmount } = renderHook(() => useGameSocket("AB7K2"));

      act(() => {
        firstSocket.readyState = WebSocket.OPEN;
        firstSocket.onopen?.(new Event("open"));
        firstSocket.onmessage?.({ data: JSON.stringify(snapshotEvent) } as MessageEvent);
        firstSocket.onmessage?.({
          data: JSON.stringify({
            type: "PIECE_MOVED", version: 1, roomCode: "AB7K2", stateVersion: 5,
            eventId: "malformed-route", serverTime: "2026-09-26T01:00:00Z",
            payload: {
              pieceId: "p1-piece-1",
              from: { state: "track", trackPosition: 10, finishProgress: null },
              to: { state: "track", trackPosition: 12, finishProgress: null },
              diceIndices: [0],
              path: [],
            },
          }),
        } as MessageEvent);
      });

      expect(firstSocket.close).toHaveBeenCalledOnce();
      expect(useGameStore.getState().room?.stateVersion).toBe(4);
      act(() => firstSocket.onclose?.(new CloseEvent("close")));
      act(() => vi.advanceTimersByTime(500));
      expect(createRoomSocketMock).toHaveBeenCalledTimes(2);
      act(() => {
        nextSocket.readyState = WebSocket.OPEN;
        nextSocket.onopen?.(new Event("open"));
      });
      expect(nextSocket.send).toHaveBeenCalledWith(JSON.stringify({
        type: "RECONNECT", version: 1, roomCode: "AB7K2", playerToken: "player-token",
      }));
      unmount();
    } finally {
      vi.useRealTimers();
    }
  });
});
