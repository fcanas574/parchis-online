import type { GameState, PiecePosition } from "@/types/game";
import type {
  PieceCaptureEvent,
  PieceMoveEvent,
  ServerEvent,
} from "@/types/protocol";

type MoveStep = {
  kind: "move";
  eventId: string;
  stateVersion: number;
  pieceId: string;
  path: PiecePosition[];
  nextIndex: number;
};

type CaptureStep = {
  kind: "capture";
  eventId: string;
  stateVersion: number;
  capturedPieceId: string;
  landingPosition: PiecePosition | null;
  phase: "impact" | "return";
};

export type PiecePresentationStep = MoveStep | CaptureStep;

export type PiecePresentationState = {
  roomCode: string;
  lastVersion: number;
  visualPositions: Record<string, PiecePosition>;
  authoritativePositions: Record<string, PiecePosition>;
  queue: PiecePresentationStep[];
  seenEventIds: string[];
  needsSync: boolean;
};

const MAX_SEEN_EVENT_IDS = 128;
const YARD_POSITION: PiecePosition = {
  state: "yard",
  trackPosition: null,
  finishProgress: null,
};

function snapshotPositions(game: GameState): Record<string, PiecePosition> {
  return Object.fromEntries(
    game.pieces.map((piece) => [
      piece.id,
      {
        state: piece.state,
        trackPosition: piece.trackPosition,
        finishProgress: piece.finishProgress,
      },
    ]),
  );
}

function seen(state: PiecePresentationState, eventId: string): boolean {
  return state.seenEventIds.includes(eventId);
}

function remember(state: PiecePresentationState, eventId: string): string[] {
  return [...state.seenEventIds, eventId].slice(-MAX_SEEN_EVENT_IDS);
}

function positionsEqual(left: PiecePosition | undefined, right: PiecePosition): boolean {
  return (
    left?.state === right.state &&
    left.trackPosition === right.trackPosition &&
    left.finishProgress === right.finishProgress
  );
}

export function resetPiecePresentation(
  game: GameState,
  roomCode: string,
  stateVersion: number,
): PiecePresentationState {
  const positions = snapshotPositions(game);
  return {
    roomCode,
    lastVersion: stateVersion,
    visualPositions: positions,
    authoritativePositions: positions,
    queue: [],
    seenEventIds: [],
    needsSync: false,
  };
}

export function createPiecePresentation(
  game: GameState,
  roomCode: string,
  stateVersion: number,
): PiecePresentationState {
  return resetPiecePresentation(game, roomCode, stateVersion);
}

function emptyPresentation(
  roomCode: string,
  stateVersion: number,
): PiecePresentationState {
  return {
    roomCode,
    lastVersion: stateVersion,
    visualPositions: {},
    authoritativePositions: {},
    queue: [],
    seenEventIds: [],
    needsSync: false,
  };
}

function snapAfterGap(
  state: PiecePresentationState,
  event: ServerEvent,
): PiecePresentationState {
  const visualPositions = { ...state.authoritativePositions };
  const authoritativePositions = { ...state.authoritativePositions };
  if (event.type === "PIECE_MOVED") {
    visualPositions[event.payload.pieceId] = event.payload.to;
    authoritativePositions[event.payload.pieceId] = event.payload.to;
  }
  return {
    ...state,
    lastVersion: event.stateVersion,
    visualPositions,
    authoritativePositions,
    queue: [],
    seenEventIds: remember(state, event.eventId),
    needsSync: true,
  };
}

function receiveMove(
  state: PiecePresentationState,
  event: PieceMoveEvent,
): PiecePresentationState {
  const lastMoveForPiece = [...state.queue]
    .reverse()
    .find((step): step is MoveStep => step.kind === "move" && step.pieceId === event.payload.pieceId);

  if (lastMoveForPiece) {
    const previousDestination = lastMoveForPiece.path[lastMoveForPiece.path.length - 1];
    if (!positionsEqual(previousDestination, event.payload.from)) {
      return snapAfterGap(state, event);
    }
  }

  const visualPositions = { ...state.visualPositions };
  if (!lastMoveForPiece) {
    // The store may already hold the matching snapshot when the recent event
    // buffer is consumed. Start from the server's declared origin, not the
    // snapshot destination, then replay only the server-supplied path.
    visualPositions[event.payload.pieceId] = event.payload.from;
  }
  const authoritativePositions = {
    ...state.authoritativePositions,
    [event.payload.pieceId]: event.payload.to,
  };
  const step: MoveStep = {
    kind: "move",
    eventId: event.eventId,
    stateVersion: event.stateVersion,
    pieceId: event.payload.pieceId,
    path: event.payload.path,
    nextIndex: 0,
  };
  return {
    ...state,
    lastVersion: Math.max(state.lastVersion, event.stateVersion),
    visualPositions,
    authoritativePositions,
    queue: [...state.queue, step],
    seenEventIds: remember(state, event.eventId),
  };
}

function receiveCapture(
  state: PiecePresentationState,
  event: PieceCaptureEvent,
): PiecePresentationState {
  const attackerMove = [...state.queue]
    .reverse()
    .find((step): step is MoveStep =>
      step.kind === "move" && step.pieceId === event.payload.byPieceId,
    );
  const landingPosition = attackerMove?.path.at(-1) ??
    state.authoritativePositions[event.payload.byPieceId] ??
    state.visualPositions[event.payload.byPieceId];
  const step: CaptureStep = {
    kind: "capture",
    eventId: event.eventId,
    stateVersion: event.stateVersion,
    capturedPieceId: event.payload.capturedPieceId,
    landingPosition: landingPosition ?? null,
    phase: "impact",
  };
  return {
    ...state,
    lastVersion: Math.max(state.lastVersion, event.stateVersion),
    queue: [...state.queue, step],
    seenEventIds: remember(state, event.eventId),
  };
}

function receiveSync(
  state: PiecePresentationState,
  event: Extract<ServerEvent, { type: "GAME_STATE_SYNC" }>,
): PiecePresentationState {
  const game = event.payload.game;
  if (event.roomCode !== state.roomCode) {
    return game
      ? resetPiecePresentation(game, event.roomCode, event.stateVersion)
      : emptyPresentation(event.roomCode, event.stateVersion);
  }
  if (event.stateVersion < state.lastVersion) return state;

  if (!game) return emptyPresentation(event.roomCode, event.stateVersion);
  if (state.needsSync || event.stateVersion > state.lastVersion + 1) {
    return resetPiecePresentation(game, event.roomCode, event.stateVersion);
  }

  const authoritativePositions = snapshotPositions(game);
  return {
    ...state,
    lastVersion: event.stateVersion,
    visualPositions: state.queue.length
      ? state.visualPositions
      : authoritativePositions,
    authoritativePositions,
    needsSync: false,
  };
}

export function receivePresentationEvent(
  state: PiecePresentationState,
  event: ServerEvent,
): PiecePresentationState {
  if (event.type === "GAME_STATE_SYNC") return receiveSync(state, event);
  if (event.roomCode !== state.roomCode || seen(state, event.eventId)) return state;
  if (event.stateVersion < state.lastVersion) return state;

  if (event.type === "PLAYER_RECONNECTED") {
    return {
      ...state,
      lastVersion: event.stateVersion,
      seenEventIds: remember(state, event.eventId),
    };
  }
  if (state.needsSync) return state;
  if (event.stateVersion > state.lastVersion + 1) return snapAfterGap(state, event);
  if (event.type === "PIECE_MOVED") return receiveMove(state, event);
  if (event.type === "PIECE_CAPTURED") return receiveCapture(state, event);
  if (event.type === "GAME_RESET") {
    return {
      ...state,
      lastVersion: event.stateVersion,
      visualPositions: { ...state.authoritativePositions },
      queue: [],
      seenEventIds: remember(state, event.eventId),
      needsSync: true,
    };
  }
  return {
    ...state,
    lastVersion: Math.max(state.lastVersion, event.stateVersion),
    seenEventIds: remember(state, event.eventId),
  };
}

export function advancePresentation(
  state: PiecePresentationState,
): PiecePresentationState {
  if (state.needsSync || state.queue.length === 0) return state;

  const [head, ...tail] = state.queue;
  if (!head) return state;

  if (head.kind === "capture") {
    if (head.phase === "impact" && head.landingPosition) {
      return {
        ...state,
        visualPositions: {
          ...state.visualPositions,
          [head.capturedPieceId]: head.landingPosition,
        },
        queue: [{ ...head, phase: "return" }, ...tail],
      };
    }
    return {
      ...state,
      visualPositions: {
        ...state.visualPositions,
        [head.capturedPieceId]: YARD_POSITION,
      },
      queue: tail,
    };
  }

  const position = head.path[head.nextIndex];
  if (!position) return { ...state, queue: tail };
  const nextIndex = head.nextIndex + 1;
  return {
    ...state,
    visualPositions: { ...state.visualPositions, [head.pieceId]: position },
    queue:
      nextIndex >= head.path.length
        ? tail
        : [{ ...head, nextIndex }, ...tail],
  };
}
