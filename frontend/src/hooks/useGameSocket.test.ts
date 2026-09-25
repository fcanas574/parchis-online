import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const snapshotEvent = {
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
};

beforeEach(() => {
  useGameStore.getState().reset();
  createRoomSocketMock.mockReset();
});

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
});
