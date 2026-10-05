"use client";

import { useEffect, useRef, useState } from "react";
import {
  correlatableRequestId,
  logRealtime,
} from "@/lib/realtime-diagnostics";
import {
  advancePresentation,
  createPiecePresentation,
  receivePresentationEvent,
  resetPiecePresentation,
  type PiecePresentationState,
} from "@/lib/piece-presentation";
import type { ConnectionState } from "@/stores/gameStore";
import type { GameState, Piece, PiecePosition } from "@/types/game";
import type { ServerEvent } from "@/types/protocol";

const STEP_DURATION_MS = 90;
const MAX_ROUTE_DURATION_MS = 1_600;
const MAX_HANDLED_EVENT_IDS = 256;

type AnimationTrace = {
  eventId: string;
  stateVersion: number;
  startedAt: number;
  expectedDurationMs: number;
  completedTicks: number;
};

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function rememberEvents(target: Set<string>, events: readonly ServerEvent[]) {
  for (const event of events) {
    target.add(event.eventId);
    if (target.size > MAX_HANDLED_EVENT_IDS) {
      const oldest = target.values().next().value;
      if (oldest) target.delete(oldest);
    }
  }
}

function toPieces(game: GameState, positions: PiecePresentationState["visualPositions"]): Piece[] {
  return game.pieces.map((piece) => {
    const position = positions[piece.id];
    return position
      ? {
          ...piece,
          state: position.state,
          trackPosition: position.trackPosition,
          finishProgress: position.finishProgress,
        }
      : piece;
  });
}

function positionMatchesPiece(position: PiecePosition | undefined, piece: Piece): boolean {
  return position?.state === piece.state &&
    position.trackPosition === piece.trackPosition &&
    position.finishProgress === piece.finishProgress;
}

function presentationMatchesSnapshot(
  presentation: PiecePresentationState,
  game: GameState,
  roomCode: string,
  stateVersion: number,
): boolean {
  if (
    presentation.roomCode !== roomCode ||
    presentation.lastVersion !== stateVersion ||
    presentation.needsSync ||
    presentation.queue.length > 0
  ) {
    return false;
  }

  if (
    Object.keys(presentation.visualPositions).length !== game.pieces.length ||
    Object.keys(presentation.authoritativePositions).length !== game.pieces.length
  ) {
    return false;
  }

  return game.pieces.every((piece) =>
    positionMatchesPiece(presentation.visualPositions[piece.id], piece) &&
    positionMatchesPiece(presentation.authoritativePositions[piece.id], piece),
  );
}

export function usePiecePresentation(
  game: GameState,
  roomCode: string,
  stateVersion: number,
  viewerPlayerId: string,
  events: readonly ServerEvent[],
  connectionState: ConnectionState,
) {
  const [presentation, setPresentation] = useState(() =>
    createPiecePresentation(game, roomCode, stateVersion),
  );
  const presentationRef = useRef(presentation);
  const handledEventsRef = useRef(new Set<string>());
  const previousRoomRef = useRef(roomCode);
  const previousConnectionRef = useRef(connectionState);
  const animationTimerRef = useRef<number | null>(null);
  const animationTraceRef = useRef<AnimationTrace | null>(null);
  const [reduceMotion, setReduceMotion] = useState(prefersReducedMotion);
  const isAnimating = presentation.queue.length > 0;

  const commit = (next: PiecePresentationState) => {
    presentationRef.current = next;
    setPresentation(next);
  };

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = (event?: MediaQueryListEvent) => {
      setReduceMotion(event?.matches ?? media.matches);
    };
    updatePreference();
    media.addEventListener?.("change", updatePreference);
    return () => media.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    const roomChanged = previousRoomRef.current !== roomCode ||
      presentationRef.current.roomCode !== roomCode;
    const reconnected = previousConnectionRef.current !== "connected" &&
      connectionState === "connected";
    previousRoomRef.current = roomCode;
    previousConnectionRef.current = connectionState;

    if (roomChanged || connectionState !== "connected" || reconnected || reduceMotion) {
      rememberEvents(handledEventsRef.current, events);
      if (!presentationMatchesSnapshot(presentationRef.current, game, roomCode, stateVersion)) {
        commit(resetPiecePresentation(game, roomCode, stateVersion));
      }
      return;
    }

    let next = presentationRef.current;
    for (const event of events) {
      if (handledEventsRef.current.has(event.eventId)) continue;
      handledEventsRef.current.add(event.eventId);
      const previousVersion = next.lastVersion;
      const previousQueueLength = next.queue.length;
      const previousNeedsSync = next.needsSync;
      next = receivePresentationEvent(next, event);
      if (event.type === "PIECE_MOVED" || event.type === "PIECE_CAPTURED") {
        logRealtime("piece_presentation_event_processed", {
          type: event.type,
          eventId: event.eventId,
          requestId: correlatableRequestId(event.requestId),
          stateVersion: event.stateVersion,
          previousVersion,
          queueBefore: previousQueueLength,
          queueAfter: next.queue.length,
          queued: next.queue.some((step) => step.eventId === event.eventId),
          needsSync: next.needsSync,
        });
      }
      if (!previousNeedsSync && next.needsSync) {
        logRealtime("piece_presentation_state_gap", {
          type: event.type,
          eventId: event.eventId,
          requestId: correlatableRequestId(event.requestId),
          previousVersion,
          receivedVersion: event.stateVersion,
          queueLength: next.queue.length,
        });
      }
    }
    if (handledEventsRef.current.size > MAX_HANDLED_EVENT_IDS) {
      const latestIds = events.slice(-MAX_HANDLED_EVENT_IDS).map((event) => event.eventId);
      handledEventsRef.current = new Set(latestIds);
    }
    if (next !== presentationRef.current) commit(next);
  }, [connectionState, events, game, reduceMotion, roomCode, stateVersion]);

  useEffect(() => {
    if (
      connectionState !== "connected" ||
      presentation.queue.length > 0 ||
      presentation.needsSync ||
      presentation.lastVersion !== stateVersion
    ) {
      return;
    }
    const mismatchedPieces = game.pieces.filter((piece) =>
      !positionMatchesPiece(presentation.visualPositions[piece.id], piece),
    ).length;
    if (mismatchedPieces > 0) {
      logRealtime("piece_presentation_snapshot_mismatch", {
        roomVersion: stateVersion,
        presentationVersion: presentation.lastVersion,
        mismatchedPieces,
      });
    }
  }, [connectionState, game.pieces, presentation, stateVersion]);

  useEffect(() => {
    let cancelled = false;
    if (connectionState !== "connected" || reduceMotion) return undefined;

    const scheduleNextStep = () => {
      const [activeStep] = presentationRef.current.queue;
      if (cancelled || !activeStep) return;
      const duration = activeStep.kind === "move"
        ? Math.min(STEP_DURATION_MS, MAX_ROUTE_DURATION_MS / activeStep.path.length)
        : STEP_DURATION_MS;
      let trace = animationTraceRef.current;
      if (!trace) {
        trace = {
          eventId: activeStep.eventId,
          stateVersion: activeStep.stateVersion,
          startedAt: performance.now(),
          expectedDurationMs: 0,
          completedTicks: 0,
        };
        animationTraceRef.current = trace;
        logRealtime("piece_animation_started", {
          eventId: trace.eventId,
          stateVersion: trace.stateVersion,
          queueLength: presentationRef.current.queue.length,
        });
      }
      trace.expectedDurationMs += duration;
      const tickStartedAt = performance.now();
      animationTimerRef.current = window.setTimeout(() => {
        animationTimerRef.current = null;
        if (cancelled) return;
        const tickDurationMs = performance.now() - tickStartedAt;
        trace!.completedTicks += 1;
        if (tickDurationMs > duration + 150) {
          logRealtime("piece_animation_tick_delayed", {
            eventId: trace!.eventId,
            stateVersion: trace!.stateVersion,
            expectedMs: Math.round(duration),
            actualMs: Math.round(tickDurationMs),
            visibility: document.visibilityState,
          });
        }
        commit(advancePresentation(presentationRef.current));
        if (presentationRef.current.queue.length === 0) {
          const finishedTrace = animationTraceRef.current;
          if (finishedTrace) {
            const actualDurationMs = performance.now() - finishedTrace.startedAt;
            logRealtime("piece_animation_completed", {
              eventId: finishedTrace.eventId,
              stateVersion: finishedTrace.stateVersion,
              completedTicks: finishedTrace.completedTicks,
              expectedMs: Math.round(finishedTrace.expectedDurationMs),
              actualMs: Math.round(actualDurationMs),
              delayedMs: Math.max(
                0,
                Math.round(actualDurationMs - finishedTrace.expectedDurationMs),
              ),
            });
            animationTraceRef.current = null;
          }
          return;
        }
        scheduleNextStep();
      }, duration);
    };
    scheduleNextStep();

    return () => {
      cancelled = true;
      if (animationTimerRef.current !== null) {
        window.clearTimeout(animationTimerRef.current);
        animationTimerRef.current = null;
        const trace = animationTraceRef.current;
        if (trace) {
          logRealtime("piece_animation_interrupted", {
            eventId: trace.eventId,
            stateVersion: trace.stateVersion,
            completedTicks: trace.completedTicks,
            expectedMs: Math.round(trace.expectedDurationMs),
            queueLength: presentationRef.current.queue.length,
            visibility: document.visibilityState,
          });
          animationTraceRef.current = null;
        }
      }
    };
  }, [connectionState, isAnimating, reduceMotion]);

  const visualPieces = toPieces(game, presentation.visualPositions);
  const movingPieceIds = new Set(
    presentation.queue
      .filter((step) => step.kind === "move")
      .map((step) => step.pieceId),
  );

  return {
    visualPieces,
    isAnimating,
    isAnimatingOwnMove: game.pieces.some(
      (piece) => piece.playerId === viewerPlayerId && movingPieceIds.has(piece.id),
    ),
  };
}
