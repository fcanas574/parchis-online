import { describe, expect, it } from "vitest";
import {
  gameWithLegalOptions,
  gameRoomFixture,
  gameStateFixture,
  gameSyncEvent,
  pieceMoveEvent,
} from "@/test/game-fixtures";
import { isServerEvent } from "@/types/protocol";

describe("v1 server-event validation", () => {
  it("accepts practice mode and bot flags in the authoritative room snapshot", () => {
    const room = gameRoomFixture();
    const practiceRoom = {
      ...room,
      mode: "practice",
      players: room.players.map((player, index) => ({
        ...player,
        isBot: index > 0,
      })),
    };
    const event: unknown = {
      ...gameSyncEvent(),
      payload: { room: practiceRoom, game: null },
    };

    expect(isServerEvent(event)).toBe(true);
    expect(isServerEvent({
      ...event as object,
      payload: { room: { ...practiceRoom, mode: "unknown" }, game: null },
    })).toBe(false);
    expect(isServerEvent({
      ...event as object,
      payload: { room: { ...practiceRoom, players: [{ ...practiceRoom.players[0], isBot: "yes" }] }, game: null },
    })).toBe(false);
  });

  it("accepts a complete game snapshot whose room and game agree", () => {
    const game = gameStateFixture();
    const room = gameRoomFixture({
      status: "playing",
      stateVersion: 12,
      gameState: game,
    });

    expect(isServerEvent(gameSyncEvent({ room, stateVersion: 12 }))).toBe(true);
  });

  it("rejects a snapshot when the duplicated game state disagrees", () => {
    const game = gameStateFixture();
    const room = gameRoomFixture({
      status: "playing",
      stateVersion: 12,
      gameState: game,
    });
    const snapshot = gameSyncEvent({ room, stateVersion: 12 });
    const invalid: unknown = {
      ...snapshot,
      payload: {
        ...snapshot.payload,
        game: { ...game, currentPlayerId: "p2" },
      },
    };

    expect(isServerEvent(invalid)).toBe(false);
  });

  it("rejects incomplete game state and private fields in public snapshots", () => {
    const game = gameStateFixture();
    const incompleteGame: Partial<typeof game> = { ...game };
    delete incompleteGame.pieces;
    const room = gameRoomFixture({
      status: "playing",
      stateVersion: 12,
      gameState: game,
    });
    const incomplete: unknown = {
      ...gameSyncEvent({ room, stateVersion: 12 }),
      payload: { room, game: incompleteGame },
    };
    const privateSnapshot: unknown = {
      ...gameSyncEvent({ room, stateVersion: 12 }),
      payload: {
        room: { ...room, playerToken: "must-not-be-public" },
        game,
      },
    };

    expect(isServerEvent(incomplete)).toBe(false);
    expect(isServerEvent(privateSnapshot)).toBe(false);
  });

  it("validates gameplay event payloads rather than accepting unknown event types", () => {
    const event: unknown = {
      type: "DICE_ROLLED",
      version: 1,
      roomCode: "AB7K2",
      stateVersion: 13,
      eventId: "evt-roll",
      serverTime: "2026-09-25T18:30:00Z",
      requestId: "roll-1",
      payload: { playerId: "p1", values: [0, 2], availableMoves: [] },
    };

    expect(isServerEvent(event)).toBe(false);
    expect(isServerEvent({ ...event as object, type: "UNSUPPORTED_EVENT" })).toBe(false);
  });

  it("accepts a well-formed authoritative dice result", () => {
    const event: unknown = {
      type: "DICE_ROLLED",
      version: 1,
      roomCode: "AB7K2",
      stateVersion: 13,
      eventId: "evt-roll",
      serverTime: "2026-09-25T18:30:00Z",
      requestId: "roll-1",
      payload: {
        playerId: "p1",
        values: [5, 2],
        availableMoves: gameWithLegalOptions(["p1-piece-1"]).availableMoves,
      },
    };

    expect(isServerEvent(event)).toBe(true);
  });

  it("accepts a move path ending at the authoritative destination", () => {
    expect(isServerEvent(pieceMoveEvent())).toBe(true);
  });

  it.each(["missing", "empty", "malformed"] as const)(
    "rejects a %s move path",
    (invalidKind) => {
      const event = pieceMoveEvent();
      let payload: unknown = event.payload;
      if (invalidKind === "missing") {
        const { path: _path, ...withoutPath } = event.payload;
        payload = withoutPath;
      } else if (invalidKind === "empty") {
        payload = { ...event.payload, path: [] };
      } else {
        payload = {
          ...event.payload,
          path: [{ ...event.payload.path[0]!, trackPosition: -1 }],
        };
      }

      expect(isServerEvent({ ...event, payload })).toBe(false);
    },
  );

  it("rejects a move path whose final point disagrees with its destination", () => {
    const event = pieceMoveEvent();

    expect(isServerEvent({
      ...event,
      payload: {
        ...event.payload,
        to: { state: "track", trackPosition: 12, finishProgress: null },
      },
    })).toBe(false);
  });

  it("validates replay intent and requester in a game-reset event", () => {
    const event: unknown = {
      type: "GAME_RESET",
      version: 1,
      roomCode: "AB7K2",
      stateVersion: 14,
      eventId: "evt-reset",
      serverTime: "2026-09-25T18:30:00Z",
      requestId: "again-1",
      payload: {
        status: "lobby",
        requestedReplay: true,
        requesterId: "p1",
      },
    };
    const missingRequester: unknown = {
      ...event as object,
      payload: { status: "lobby", requestedReplay: true },
    };
    const invalidIntent: unknown = {
      ...event as object,
      payload: { status: "lobby", requestedReplay: "yes", requesterId: "p1" },
    };

    expect(isServerEvent(event)).toBe(true);
    expect(isServerEvent(missingRequester)).toBe(false);
    expect(isServerEvent(invalidIntent)).toBe(false);
  });
});
