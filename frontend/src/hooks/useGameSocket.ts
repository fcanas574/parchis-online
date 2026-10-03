"use client";

import { useCallback, useEffect, useRef } from "react";
import { readSession } from "@/lib/session";
import { readPlayerPreferences } from "@/lib/player-preferences";
import { createRoomSocket } from "@/lib/websocket";
import { useGameStore } from "@/stores/gameStore";
import type {
  DiceIndex,
  DiceSkinId,
  GiftId,
  PieceSkinId,
  ReactionId,
} from "@/types/game";
import { isServerEvent, type ClientCommand, type ServerEvent } from "@/types/protocol";

export { isServerEvent } from "@/types/protocol";

const RETRY_DELAYS = [500, 1_000, 2_000, 4_000] as const;
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN;
type RealtimeDiagnosticDetails = Record<
  string,
  string | number | boolean | null
>;

function logRealtime(
  event: string,
  details: RealtimeDiagnosticDetails,
): void {
  if (
    typeof window === "undefined" ||
    new URLSearchParams(window.location.search).get("realtime-debug") !== "1"
  ) {
    return;
  }
  console.info("[parchis-realtime]", {
    event,
    at: new Date().toISOString(),
    ...details,
  });
}

const isAuthenticationError = (event: ServerEvent) =>
  event.type === "ERROR" && event.payload.code === "UNAUTHENTICATED";

export function useGameSocket(roomCode: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const stopRetryingRef = useRef(false);
  const session = useGameStore((state) => state.session);

  const sendCommand = useCallback((command: ClientCommand) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) {
      logRealtime("client_command_not_sent", {
        type: command.type,
        reason: "socket_not_open",
      });
      return false;
    }
    socket.send(JSON.stringify(command));
    logRealtime("client_command_sent", { type: command.type });
    return true;
  }, []);

  const sendReady = useCallback(
    (ready: boolean) =>
      sendCommand({
        type: "PLAYER_READY",
        version: 1,
        ready,
        requestId: crypto.randomUUID(),
      }),
    [sendCommand],
  );

  const sendStartGame = useCallback(
    () =>
      sendCommand({
        type: "START_GAME",
        version: 1,
        requestId: crypto.randomUUID(),
      }),
    [sendCommand],
  );

  const sendRollDice = useCallback(
    () =>
      sendCommand({
        type: "ROLL_DICE",
        version: 1,
        requestId: crypto.randomUUID(),
      }),
    [sendCommand],
  );

  const sendMovePiece = useCallback(
    (pieceId: string, diceIndices: DiceIndex[]) =>
      sendCommand({
        type: "MOVE_PIECE",
        version: 1,
        requestId: crypto.randomUUID(),
        pieceId,
        diceIndices,
      }),
    [sendCommand],
  );

  const sendMoveBonusPiece = useCallback(
    (pieceId: string) =>
      sendCommand({
        type: "MOVE_BONUS_PIECE",
        version: 1,
        requestId: crypto.randomUUID(),
        pieceId,
      }),
    [sendCommand],
  );

  const sendReturnToLobby = useCallback(
    () =>
      sendCommand({
        type: "RETURN_TO_LOBBY",
        version: 1,
        requestId: crypto.randomUUID(),
      }),
    [sendCommand],
  );

  const sendPlayAgain = useCallback(
    () =>
      sendCommand({
        type: "PLAY_AGAIN",
        version: 1,
        requestId: crypto.randomUUID(),
      }),
    [sendCommand],
  );

  const sendChatMessage = useCallback(
    (text: string) =>
      sendCommand({
        type: "CHAT_MESSAGE",
        version: 1,
        requestId: crypto.randomUUID(),
        text,
      }),
    [sendCommand],
  );

  const sendReaction = useCallback(
    (reactionId: ReactionId) =>
      sendCommand({
        type: "REACTION_SENT",
        version: 1,
        requestId: crypto.randomUUID(),
        reactionId,
      }),
    [sendCommand],
  );

  const sendGift = useCallback(
    (toPlayerId: string, giftId: GiftId) =>
      sendCommand({
        type: "GIFT_SENT",
        version: 1,
        requestId: crypto.randomUUID(),
        toPlayerId,
        giftId,
      }),
    [sendCommand],
  );

  const setCosmetics = useCallback(
    (diceSkinId: DiceSkinId, pieceSkinId: PieceSkinId) =>
      sendCommand({
        type: "SET_COSMETICS",
        version: 1,
        requestId: crypto.randomUUID(),
        diceSkinId,
        pieceSkinId,
      }),
    [sendCommand],
  );

  useEffect(() => {
    const activeSession =
      session?.roomCode === roomCode ? session : readSession(roomCode);
    const store = useGameStore.getState();
    let disposed = false;
    let lastServerEvent: {
      type: ServerEvent["type"];
      stateVersion: number;
      receivedAt: number;
    } | null = null;

    if (!activeSession || !API_ORIGIN) {
      store.setConnectionState("disconnected");
      return undefined;
    }

    stopRetryingRef.current = false;
    const clearRetryTimer = () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };

    const scheduleRetry = () => {
      if (disposed || stopRetryingRef.current) return;
      const delay = RETRY_DELAYS[retryAttemptRef.current] ?? 5_000;
      retryAttemptRef.current += 1;
      store.setConnectionState("reconnecting");
      logRealtime("reconnect_scheduled", { attempt: retryAttemptRef.current, delayMs: delay });
      retryTimerRef.current = setTimeout(connect, delay);
    };

    const connect = () => {
      if (disposed || stopRetryingRef.current) return;
      clearRetryTimer();
      store.clearTransientEvents();
      store.setConnectionState(retryAttemptRef.current === 0 ? "connecting" : "reconnecting");

      const socket = createRoomSocket(API_ORIGIN, roomCode);
      let cosmeticsSyncSent = false;
      socketRef.current = socket;
      socket.onopen = () => {
        const retryAttempt = retryAttemptRef.current;
        logRealtime("socket_opened", { retryAttempt });
        retryAttemptRef.current = 0;
        socket.send(
          JSON.stringify({
            type: "RECONNECT",
            version: 1,
            roomCode,
            playerToken: activeSession.playerToken,
          } satisfies ClientCommand),
        );
        logRealtime("reconnect_sent", { retryAttempt });
      };
      socket.onmessage = (message) => {
        if (typeof message.data !== "string") {
          store.setError({ code: "INVALID_MESSAGE", message: "Server message must be text." });
          return;
        }
        try {
          const event: unknown = JSON.parse(message.data);
          if (!isServerEvent(event) || event.roomCode !== roomCode) {
            store.setError({ code: "INVALID_MESSAGE", message: "Server message has an invalid shape." });
            socket.close(4002, "Invalid server event");
            return;
          }
          const receivedAt = performance.now();
          const gapMs = lastServerEvent
            ? Math.round(receivedAt - lastServerEvent.receivedAt)
            : null;
          lastServerEvent = {
            type: event.type,
            stateVersion: event.stateVersion,
            receivedAt,
          };
          logRealtime("server_event_received", {
            type: event.type,
            stateVersion: event.stateVersion,
            gapMs,
          });
          store.applyEvent(event);
          if (socketRef.current === socket && event.type === "GAME_STATE_SYNC") {
            store.setConnectionState("connected");
            if (!cosmeticsSyncSent) {
              cosmeticsSyncSent = true;
              const localPlayer = event.payload.room.players.find(
                (player) => player.id === activeSession.playerId,
              );
              const preferences = readPlayerPreferences();
              if (
                localPlayer &&
                (localPlayer.diceSkinId !== preferences.diceSkinId ||
                  localPlayer.pieceSkinId !== preferences.pieceSkinId) &&
                socket.readyState === WebSocket.OPEN
              ) {
                socket.send(JSON.stringify({
                  type: "SET_COSMETICS",
                  version: 1,
                  requestId: crypto.randomUUID(),
                  diceSkinId: preferences.diceSkinId,
                  pieceSkinId: preferences.pieceSkinId,
                } satisfies ClientCommand));
              }
            }
          }
          if (isAuthenticationError(event)) {
            stopRetryingRef.current = true;
            store.setConnectionState("error");
            socket.close();
          }
        } catch {
          store.setError({ code: "INVALID_MESSAGE", message: "Server message is not valid JSON." });
          socket.close(4002, "Invalid server event");
        }
      };
      socket.onerror = () => {
        logRealtime("socket_error", {
          lastEventType: lastServerEvent?.type ?? "none",
          lastStateVersion: lastServerEvent?.stateVersion ?? -1,
          msSinceLastEvent: lastServerEvent
            ? Math.round(performance.now() - lastServerEvent.receivedAt)
            : null,
        });
        if (!disposed && !stopRetryingRef.current) {
          store.setConnectionState("error");
        }
      };
      socket.onclose = (event) => {
        logRealtime("socket_closed", {
          code: event.code,
          wasClean: event.wasClean,
          lastEventType: lastServerEvent?.type ?? "none",
          lastStateVersion: lastServerEvent?.stateVersion ?? -1,
          msSinceLastEvent: lastServerEvent
            ? Math.round(performance.now() - lastServerEvent.receivedAt)
            : null,
        });
        if (socketRef.current === socket) socketRef.current = null;
        if (stopRetryingRef.current || disposed) return;
        store.setConnectionState("disconnected");
        scheduleRetry();
      };
    };

    connect();
    return () => {
      disposed = true;
      clearRetryTimer();
      if (socketRef.current) {
        socketRef.current.onopen = null;
        socketRef.current.onmessage = null;
        socketRef.current.onerror = null;
        socketRef.current.onclose = null;
        socketRef.current.close();
        socketRef.current = null;
      }
    };
  }, [roomCode, session?.playerToken, session?.roomCode]);

  return {
    sendReady,
    sendStartGame,
    sendRollDice,
    sendMovePiece,
    sendMoveBonusPiece,
    sendReturnToLobby,
    sendPlayAgain,
    sendChatMessage,
    sendReaction,
    sendGift,
    setCosmetics,
  };
}

export type GameSocketActions = ReturnType<typeof useGameSocket>;
