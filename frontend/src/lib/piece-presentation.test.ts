import { describe, expect, it } from "vitest";
import { gameRoomFixture, gameStateFixture, gameSyncEvent, pieceMoveEvent } from "@/test/game-fixtures";
import type { GameState, PiecePosition } from "@/types/game";
import type { ServerEvent } from "@/types/protocol";
import {
  advancePresentation,
  createPiecePresentation,
  receivePresentationEvent,
  resetPiecePresentation,
} from "@/lib/piece-presentation";

const track = (trackPosition: number): PiecePosition => ({
  state: "track",
  trackPosition,
  finishProgress: null,
});

function gameAt(positions: Record<string, PiecePosition>, roomCode = "AB7K2"): GameState {
  const game = gameStateFixture({ roomCode });
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

function syncEvent(game: GameState, stateVersion: number) {
  const room = gameRoomFixture({
    roomCode: game.roomCode,
    status: game.status,
    stateVersion,
    gameState: game,
  });
  return gameSyncEvent({ room, stateVersion });
}

function captureEvent(stateVersion: number): Extract<ServerEvent, { type: "PIECE_CAPTURED" }> {
  return {
    type: "PIECE_CAPTURED",
    version: 1,
    roomCode: "AB7K2",
    stateVersion,
    eventId: `capture-${stateVersion}`,
    serverTime: "2026-09-26T18:30:00Z",
    payload: {
      capturedPieceId: "p2-piece-1",
      byPieceId: "p1-piece-1",
      bonusSteps: 20,
    },
  };
}

describe("piece presentation state", () => {
  it("queues two moves at one version and keeps them through their matching sync", () => {
    const initial = gameAt({ "p1-piece-1": track(10), "p2-piece-1": track(20) });
    let state = createPiecePresentation(initial, "AB7K2", 2);
    state = receivePresentationEvent(
      state,
      pieceMoveEvent({
        stateVersion: 3,
        eventId: "move-one",
        from: track(10),
        to: track(12),
        path: [track(11), track(12)],
      }),
    );
    state = receivePresentationEvent(
      state,
      pieceMoveEvent({
        stateVersion: 3,
        eventId: "move-two",
        pieceId: "p2-piece-1",
        from: track(20),
        to: track(22),
        path: [track(21), track(22)],
      }),
    );
    const authoritative = gameAt({ "p1-piece-1": track(12), "p2-piece-1": track(22) });

    state = receivePresentationEvent(state, syncEvent(authoritative, 3));

    expect(state.queue).toHaveLength(2);
    expect(state.visualPositions["p1-piece-1"]).toEqual(track(10));
    expect(state.authoritativePositions["p1-piece-1"]).toEqual(track(12));
    state = advancePresentation(state);
    expect(state.visualPositions["p1-piece-1"]).toEqual(track(11));
    state = advancePresentation(state);
    expect(state.visualPositions["p1-piece-1"]).toEqual(track(12));
    expect(state.queue).toHaveLength(1);
  });

  it("does not enqueue the same event ID twice", () => {
    const game = gameAt({ "p1-piece-1": track(10) });
    const event = pieceMoveEvent({ stateVersion: 3, eventId: "duplicate" });
    const once = receivePresentationEvent(
      createPiecePresentation(game, "AB7K2", 2),
      event,
    );

    const twice = receivePresentationEvent(once, event);

    expect(twice.queue).toHaveLength(1);
    expect(twice.seenEventIds).toEqual(["duplicate"]);
  });

  it("ignores an event older than the latest accepted version", () => {
    let state = createPiecePresentation(gameAt({ "p1-piece-1": track(10) }), "AB7K2", 2);
    state = receivePresentationEvent(
      state,
      pieceMoveEvent({ stateVersion: 3, eventId: "current" }),
    );
    const queue = state.queue;

    state = receivePresentationEvent(
      state,
      pieceMoveEvent({ stateVersion: 1, eventId: "stale" }),
    );

    expect(state.queue).toBe(queue);
    expect(state.seenEventIds).not.toContain("stale");
  });

  it("snaps to the received destination and waits for sync after a version gap", () => {
    const game = gameAt({ "p1-piece-1": track(10) });
    const event = pieceMoveEvent({
      stateVersion: 4,
      eventId: "gap",
      from: track(10),
      to: track(14),
      path: [track(11), track(12), track(13), track(14)],
    });

    const state = receivePresentationEvent(
      createPiecePresentation(game, "AB7K2", 2),
      event,
    );

    expect(state.queue).toHaveLength(0);
    expect(state.visualPositions["p1-piece-1"]).toEqual(track(14));
    expect(state.needsSync).toBe(true);
  });

  it("resets positions and queued moves when a full sync changes rooms", () => {
    let state = createPiecePresentation(
      gameAt({ "p1-piece-1": track(10) }),
      "AB7K2",
      2,
    );
    state = receivePresentationEvent(
      state,
      pieceMoveEvent({ stateVersion: 3, eventId: "before-room-change" }),
    );
    const nextGame = gameAt({ "p1-piece-1": track(30) }, "CD3E4");

    state = receivePresentationEvent(state, syncEvent(nextGame, 7));

    expect(state.roomCode).toBe("CD3E4");
    expect(state.lastVersion).toBe(7);
    expect(state.queue).toHaveLength(0);
    expect(state.visualPositions["p1-piece-1"]).toEqual(track(30));
  });

  it("does not invalidate piece animation when another player reconnects", () => {
    let state = createPiecePresentation(
      gameAt({ "p1-piece-1": track(10) }),
      "AB7K2",
      2,
    );
    const reconnect: ServerEvent = {
      type: "PLAYER_RECONNECTED",
      version: 1,
      roomCode: "AB7K2",
      stateVersion: 3,
      eventId: "reconnect-3",
      serverTime: "2026-09-26T18:30:00Z",
      payload: { player: gameRoomFixture().players[0]! },
    };

    state = receivePresentationEvent(state, reconnect);
    state = receivePresentationEvent(
      state,
      pieceMoveEvent({
        stateVersion: 4,
        eventId: "move-after-reconnect",
        from: track(10),
        to: track(11),
        path: [track(11)],
      }),
    );

    expect(state.lastVersion).toBe(4);
    expect(state.queue).toHaveLength(1);
    expect(state.visualPositions["p1-piece-1"]).toEqual(track(10));
    expect(state.needsSync).toBe(false);
  });

  it("keeps a captured piece in place until the attacker arrives, then shows the impact before returning it home", () => {
    let state = createPiecePresentation(
      gameAt({ "p1-piece-1": track(10), "p2-piece-1": track(11) }),
      "AB7K2",
      2,
    );
    state = receivePresentationEvent(
      state,
      pieceMoveEvent({
        stateVersion: 3,
        eventId: "capture-move",
        from: track(10),
        to: track(12),
        path: [track(11), track(12)],
      }),
    );
    state = receivePresentationEvent(state, captureEvent(3));

    expect(state.visualPositions["p2-piece-1"]).toEqual(track(11));
    state = advancePresentation(state);
    expect(state.visualPositions["p2-piece-1"]).toEqual(track(11));
    state = advancePresentation(state);
    expect(state.visualPositions["p2-piece-1"]).toEqual(track(11));
    state = advancePresentation(state);
    expect(state.visualPositions["p2-piece-1"]).toEqual(track(12));
    state = advancePresentation(state);

    expect(state.visualPositions["p2-piece-1"]).toEqual({
      state: "yard",
      trackPosition: null,
      finishProgress: null,
    });
    expect(state.queue).toHaveLength(0);
  });

  it("reset replaces prior room presentation with the supplied authority snapshot", () => {
    const initial = gameAt({ "p1-piece-1": track(10) });
    const state = receivePresentationEvent(
      createPiecePresentation(initial, "AB7K2", 2),
      pieceMoveEvent({ stateVersion: 3, eventId: "pending" }),
    );

    const reset = resetPiecePresentation(
      gameAt({ "p1-piece-1": track(40) }, "CD3E4"),
      "CD3E4",
      8,
    );

    expect(state.queue).toHaveLength(1);
    expect(reset.queue).toHaveLength(0);
    expect(reset.visualPositions["p1-piece-1"]).toEqual(track(40));
    expect(reset.seenEventIds).toEqual([]);
  });
});
