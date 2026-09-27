"use client";

import { useCallback, useEffect, useRef } from "react";
import { readSession } from "@/lib/session";
import { createRoomSocket } from "@/lib/websocket";
import { useGameStore } from "@/stores/gameStore";
import type { DiceIndex } from "@/types/game";
import { isServerEvent, type ClientCommand, type ServerEvent } from "@/types/protocol";

export { isServerEvent } from "@/types/protocol";

const RETRY_DELAYS = [500, 1_000, 2_000, 4_000] as const;
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN;

const isAuthenticationError = (event: ServerEvent) =>
  event.type === "ERROR" && event.payload.code === "UNAUTHENTICATED";

export function useGameSocket(roomCode: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryAttemptRef = useRef(0);
  const stopRetryingRef = useRef(false);
  const session = useGameStore((state) => state.session);

  const sendCommand = useCallback((command: ClientCommand) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) return false;
    socketRef.current.send(JSON.stringify(command));
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

  useEffect(() => {
    const activeSession =
      session?.roomCode === roomCode ? session : readSession(roomCode);
    const store = useGameStore.getState();
    let disposed = false;

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
      retryTimerRef.current = setTimeout(connect, delay);
    };

    const connect = () => {
      if (disposed || stopRetryingRef.current) return;
      clearRetryTimer();
      store.setConnectionState(retryAttemptRef.current === 0 ? "connecting" : "reconnecting");

      const socket = createRoomSocket(API_ORIGIN, roomCode);
      socketRef.current = socket;
      socket.onopen = () => {
        retryAttemptRef.current = 0;
        socket.send(
          JSON.stringify({
            type: "RECONNECT",
            version: 1,
            roomCode,
            playerToken: activeSession.playerToken,
          } satisfies ClientCommand),
        );
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
          store.applyEvent(event);
          if (socketRef.current === socket && event.type === "GAME_STATE_SYNC") {
            store.setConnectionState("connected");
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
        if (!disposed && !stopRetryingRef.current) {
          store.setConnectionState("error");
        }
      };
      socket.onclose = () => {
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
  };
}

export type GameSocketActions = ReturnType<typeof useGameSocket>;
