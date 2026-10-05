import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gameRoomFixture, gameStateFixture, gameSyncEvent, pieceMoveEvent } from "@/test/game-fixtures";
import type { GameState, PiecePosition } from "@/types/game";
import type { ServerEvent } from "@/types/protocol";
import type { ConnectionState } from "@/stores/gameStore";
import { usePiecePresentation } from "@/hooks/usePiecePresentation";

const track = (trackPosition: number): PiecePosition => ({
  state: "track",
  trackPosition,
  finishProgress: null,
});

function gameAt(positions: Record<string, PiecePosition>): GameState {
  const game = gameStateFixture();
  return {
    ...game,
    pieces: game.pieces.map((piece) => {
      const position = positions[piece.id];
      return position
        ? {
            ...piece,
            state: position.state,
            trackPosition: position.trackPosition,
            finishProgress: position.finishProgress,
          }
        : piece;
    }),
  };
}

function sync(game: GameState, stateVersion: number) {
  const room = gameRoomFixture({
    status: game.status,
    stateVersion,
    gameState: game,
  });
  return gameSyncEvent({ room, stateVersion });
}

function viewPosition(result: { current: ReturnType<typeof usePiecePresentation> }, pieceId = "p1-piece-1") {
  const piece = result.current.visualPieces.find((candidate) => candidate.id === pieceId);
  if (!piece) throw new Error(`Missing visual piece ${pieceId}`);
  return {
    state: piece.state,
    trackPosition: piece.trackPosition,
    finishProgress: piece.finishProgress,
  } satisfies PiecePosition;
}

const initialEvents: readonly ServerEvent[] = [];

describe("usePiecePresentation", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("visits a three-step route one cell per 90 ms tick", () => {
    vi.useFakeTimers();
    const game = gameAt({ "p1-piece-1": track(10) });
    const { result, rerender, unmount } = renderHook(
      (props: { game: GameState; stateVersion: number; events: readonly ServerEvent[] }) =>
        usePiecePresentation(props.game, "AB7K2", props.stateVersion, "p1", props.events, "connected"),
      { initialProps: { game, stateVersion: 2, events: initialEvents } },
    );

    act(() => rerender({
      game,
      stateVersion: 3,
      events: [pieceMoveEvent({
        stateVersion: 3,
        eventId: "three-step",
        from: track(10),
        to: track(13),
        path: [track(11), track(12), track(13)],
      })],
    }));
    expect(viewPosition(result).trackPosition).toBe(10);
    act(() => vi.advanceTimersByTime(89));
    expect(viewPosition(result).trackPosition).toBe(10);
    act(() => vi.advanceTimersByTime(1));
    expect(viewPosition(result).trackPosition).toBe(11);
    act(() => vi.advanceTimersByTime(90));
    expect(viewPosition(result).trackPosition).toBe(12);
    act(() => vi.advanceTimersByTime(90));
    expect(viewPosition(result).trackPosition).toBe(13);
    expect(result.current.isAnimating).toBe(false);
    unmount();
  });

  it("logs the start and completion of a real piece animation with its event id", () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    window.history.replaceState({}, "", "/room/AB7K2?realtime-debug=1");
    const start = gameAt({ "p1-piece-1": track(10) });
    const destination = gameAt({ "p1-piece-1": track(11) });
    const move = pieceMoveEvent({
      stateVersion: 3,
      eventId: "browser-trace-move",
      from: track(10),
      to: track(11),
      path: [track(11)],
    });
    const { result, rerender, unmount } = renderHook(
      (props: { game: GameState; stateVersion: number; events: readonly ServerEvent[] }) =>
        usePiecePresentation(props.game, "AB7K2", props.stateVersion, "p1", props.events, "connected"),
      { initialProps: { game: start, stateVersion: 2, events: initialEvents } },
    );

    act(() => rerender({ game: destination, stateVersion: 3, events: [move] }));
    expect(result.current.isAnimating).toBe(true);
    act(() => vi.advanceTimersByTime(90));

    const diagnostics = log.mock.calls.map(([, serialized]) =>
      JSON.parse(serialized as string) as Record<string, unknown>,
    );
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ event: "piece_animation_started", eventId: "browser-trace-move" }),
      expect.objectContaining({ event: "piece_animation_completed", eventId: "browser-trace-move" }),
    ]));
    expect(result.current.isAnimating).toBe(false);

    unmount();
    window.history.replaceState({}, "", "/");
    log.mockRestore();
  });

  it("caps a long route at 1600 ms", () => {
    vi.useFakeTimers();
    const game = gameAt({ "p1-piece-1": track(10) });
    const path = Array.from({ length: 20 }, (_, index) => track(index + 11));
    const { result, rerender, unmount } = renderHook(
      (props: { events: readonly ServerEvent[] }) =>
        usePiecePresentation(game, "AB7K2", 2, "p1", props.events, "connected"),
      { initialProps: { events: initialEvents } },
    );

    act(() => rerender({
      events: [pieceMoveEvent({
        stateVersion: 3,
        eventId: "long-route",
        from: track(10),
        to: track(30),
        path,
      })],
    }));
    act(() => vi.advanceTimersByTime(1599));
    expect(viewPosition(result).trackPosition).not.toBe(30);
    act(() => vi.advanceTimersByTime(1));

    expect(viewPosition(result).trackPosition).toBe(30);
    expect(result.current.isAnimating).toBe(false);
    unmount();
  });

  it("keeps the current animation through a matching-version game sync", () => {
    vi.useFakeTimers();
    const start = gameAt({ "p1-piece-1": track(10) });
    const destination = gameAt({ "p1-piece-1": track(13) });
    const move = pieceMoveEvent({
      stateVersion: 3,
      eventId: "move-before-sync",
      from: track(10),
      to: track(13),
      path: [track(11), track(12), track(13)],
    });
    const { result, rerender, unmount } = renderHook(
      (props: { game: GameState; stateVersion: number; events: readonly ServerEvent[] }) =>
        usePiecePresentation(props.game, "AB7K2", props.stateVersion, "p1", props.events, "connected"),
      { initialProps: { game: start, stateVersion: 2, events: initialEvents } },
    );

    act(() => rerender({
      game: destination,
      stateVersion: 3,
      events: [move, sync(destination, 3)],
    }));
    expect(viewPosition(result).trackPosition).toBe(10);
    expect(result.current.isAnimating).toBe(true);
    act(() => vi.advanceTimersByTime(90));
    expect(viewPosition(result).trackPosition).toBe(11);
    unmount();
  });

  it("snaps to the latest snapshot during reconnection instead of replaying old movement", () => {
    vi.useFakeTimers();
    const start = gameAt({ "p1-piece-1": track(10) });
    const destination = gameAt({ "p1-piece-1": track(13) });
    const move = pieceMoveEvent({
      stateVersion: 3,
      eventId: "move-before-reconnect",
      from: track(10),
      to: track(13),
      path: [track(11), track(12), track(13)],
    });
    const events = [move, sync(destination, 3)];
    const { result, rerender } = renderHook(
      (props: { game: GameState; stateVersion: number; events: readonly ServerEvent[]; connectionState: ConnectionState }) =>
        usePiecePresentation(props.game, "AB7K2", props.stateVersion, "p1", props.events, props.connectionState),
      { initialProps: { game: start, stateVersion: 2, events: initialEvents, connectionState: "connected" as ConnectionState } },
    );
    act(() => rerender({ game: destination, stateVersion: 3, events, connectionState: "connected" }));
    expect(result.current.isAnimating).toBe(true);

    act(() => rerender({ game: destination, stateVersion: 3, events, connectionState: "reconnecting" }));

    expect(viewPosition(result).trackPosition).toBe(13);
    expect(result.current.isAnimating).toBe(false);
  });

  it("does not rerender repeatedly while disconnected when the event list is recreated", () => {
    const game = gameAt({ "p1-piece-1": track(10) });
    let renderCount = 0;
    const { result } = renderHook(() => {
      renderCount += 1;
      return usePiecePresentation(game, "AB7K2", 2, "p1", [], "reconnecting");
    });

    expect(result.current.isAnimating).toBe(false);
    expect(renderCount).toBe(1);
  });

  it("snaps directly to the destination when reduced motion is enabled", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const game = gameAt({ "p1-piece-1": track(10) });
    const destination = gameAt({ "p1-piece-1": track(13) });
    const { result, rerender } = renderHook(
      (props: { game: GameState; events: readonly ServerEvent[] }) =>
        usePiecePresentation(props.game, "AB7K2", 2, "p1", props.events, "connected"),
      { initialProps: { game, events: initialEvents } },
    );

    act(() => rerender({
      game: destination,
      events: [pieceMoveEvent({
        stateVersion: 3,
        eventId: "reduced-motion",
        from: track(10),
        to: track(13),
        path: [track(11), track(12), track(13)],
      })],
    }));

    expect(viewPosition(result).trackPosition).toBe(13);
    expect(result.current.isAnimating).toBe(false);
  });

  it("queues rapid moves and completes them in receipt order", () => {
    vi.useFakeTimers();
    const game = gameAt({ "p1-piece-1": track(10), "p2-piece-1": track(20) });
    const { result, rerender } = renderHook(
      (props: { events: readonly ServerEvent[] }) =>
        usePiecePresentation(game, "AB7K2", 2, "p1", props.events, "connected"),
      { initialProps: { events: initialEvents } },
    );
    const events = [
      pieceMoveEvent({
        stateVersion: 3,
        eventId: "queued-one",
        from: track(10),
        to: track(12),
        path: [track(11), track(12)],
      }),
      pieceMoveEvent({
        stateVersion: 4,
        eventId: "queued-two",
        pieceId: "p2-piece-1",
        from: track(20),
        to: track(22),
        path: [track(21), track(22)],
      }),
    ];

    act(() => rerender({ events }));
    expect(result.current.isAnimating).toBe(true);
    act(() => vi.advanceTimersByTime(90));
    expect(viewPosition(result).trackPosition).toBe(11);
    expect(viewPosition(result, "p2-piece-1").trackPosition).toBe(20);
    act(() => vi.advanceTimersByTime(180));
    expect(viewPosition(result, "p2-piece-1").trackPosition).toBe(21);
    act(() => vi.advanceTimersByTime(90));
    expect(viewPosition(result, "p2-piece-1").trackPosition).toBe(22);
    expect(result.current.isAnimating).toBe(false);
  });
});
