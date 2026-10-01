import type {
  DiceIndex,
  GameState,
  PiecePosition,
  PublicRoomState,
} from "@/types/game";
import type { ServerEvent } from "@/types/protocol";

const players: PublicRoomState["players"] = [
  {
    id: "p1",
    displayName: "Felipe",
    color: "green",
    seatIndex: 0,
    isHost: true,
    isBot: false,
    isReady: true,
    isConnected: true,
    reservationExpiresAt: null,
    diceSkinId: "classic",
    pieceSkinId: "classic",
    lastReceivedGiftId: null,
  },
  {
    id: "p2",
    displayName: "Ana",
    color: "red",
    seatIndex: 1,
    isHost: false,
    isBot: false,
    isReady: true,
    isConnected: true,
    reservationExpiresAt: null,
    diceSkinId: "classic",
    pieceSkinId: "classic",
    lastReceivedGiftId: null,
  },
  {
    id: "p3",
    displayName: "Pedro",
    color: "blue",
    seatIndex: 2,
    isHost: false,
    isBot: false,
    isReady: true,
    isConnected: true,
    reservationExpiresAt: null,
    diceSkinId: "classic",
    pieceSkinId: "classic",
    lastReceivedGiftId: null,
  },
  {
    id: "p4",
    displayName: "Kale",
    color: "yellow",
    seatIndex: 3,
    isHost: false,
    isBot: false,
    isReady: true,
    isConnected: true,
    reservationExpiresAt: null,
    diceSkinId: "classic",
    pieceSkinId: "classic",
    lastReceivedGiftId: null,
  },
];

export function gameStateFixture(
  overrides: Partial<GameState> = {},
): GameState {
  return {
    roomCode: "AB7K2",
    seatCount: 4,
    status: "playing",
    playerOrder: ["p1", "p2", "p3", "p4"],
    currentPlayerId: "p1",
    turnPhase: "waiting_for_roll",
    diceValues: null,
    usedDiceIndices: [],
    availableMoves: [],
    pendingBonuses: [],
    pieces: players.flatMap((player) =>
      Array.from({ length: 4 }, (_, index) => ({
        id: `${player.id}-piece-${index + 1}`,
        playerId: player.id,
        state: "yard" as const,
        trackPosition: null,
        finishProgress: null,
      })),
    ),
    finishOrder: [],
    winnerId: null,
    result: null,
    requiresSplitPlan: false,
    turnNumber: 1,
    lastRollsByPlayerId: {},
    ...overrides,
  };
}

export function gameRoomFixture(
  overrides: Partial<PublicRoomState> = {},
): PublicRoomState {
  const stateVersion = overrides.stateVersion ?? 1;
  return {
    roomCode: "AB7K2",
    mode: "friends",
    status: "lobby",
    maxPlayers: 4,
    hostPlayerId: "p1",
    players: players.map((player) => ({ ...player })),
    stateVersion,
    gameState: null,
    lastGameResult: null,
    ...overrides,
  };
}

export function gameWithLegalOptions(
  pieceIds: string[],
): GameState {
  const game = gameStateFixture({
    turnPhase: "waiting_for_move",
    diceValues: [5, 2],
  });
  return {
    ...game,
    availableMoves: pieceIds.map((pieceId) => ({
      pieceId,
      diceIndices: [0],
      steps: 5,
      destination: {
        state: "track",
        trackPosition: 0,
        finishProgress: null,
      },
      capturePieceId: null,
      completesPiece: false,
      captures: false,
      landsSafe: true,
      leavesHome: true,
      progress: 1,
      completesSplitPlan: true,
    })),
  };
}

export function gameSyncEvent({
  room = gameRoomFixture(),
  stateVersion = room.stateVersion,
}: {
  room?: PublicRoomState;
  stateVersion?: number;
} = {}): Extract<ServerEvent, { type: "GAME_STATE_SYNC" }> {
  return {
    type: "GAME_STATE_SYNC",
    version: 1,
    roomCode: room.roomCode,
    stateVersion,
    eventId: `evt-${stateVersion}`,
    serverTime: "2026-09-25T18:30:00Z",
    payload: { room, game: room.gameState },
  };
}

export function pieceMoveEvent({
  roomCode = "AB7K2",
  stateVersion = 2,
  eventId = `move-${stateVersion}`,
  pieceId = "p1-piece-1",
  from = { state: "track", trackPosition: 10, finishProgress: null },
  to,
  path = [{ state: "track", trackPosition: 11, finishProgress: null }],
  diceIndices = [0],
}: {
  roomCode?: string;
  stateVersion?: number;
  eventId?: string;
  pieceId?: string;
  from?: PiecePosition;
  to?: PiecePosition;
  path?: PiecePosition[];
  diceIndices?: DiceIndex[];
} = {}): Extract<ServerEvent, { type: "PIECE_MOVED" }> {
  const destination = to ?? path[path.length - 1] ?? from;
  return {
    type: "PIECE_MOVED",
    version: 1,
    roomCode,
    stateVersion,
    eventId,
    serverTime: "2026-09-26T18:30:00Z",
    payload: { pieceId, from, to: destination, diceIndices, path },
  };
}
