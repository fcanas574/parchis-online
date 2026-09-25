"use client";

import { useCallback, useEffect, useRef } from "react";
import { readSession } from "@/lib/session";
import { createRoomSocket } from "@/lib/websocket";
import { useGameStore } from "@/stores/gameStore";
import type { PublicPlayer, PublicRoomState } from "@/types/game";
import type { ClientCommand, ServerEvent } from "@/types/protocol";

const RETRY_DELAYS = [500, 1_000, 2_000, 4_000] as const;
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isPublicPlayer = (value: unknown): value is PublicPlayer => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    typeof value.color === "string" &&
    typeof value.seatIndex === "number" &&
    typeof value.isHost === "boolean" &&
    typeof value.isReady === "boolean" &&
    typeof value.isConnected === "boolean" &&
    (typeof value.reservationExpiresAt === "string" || value.reservationExpiresAt === null)
  );
};

const isPublicRoom = (value: unknown): value is PublicRoomState => {
  if (!isRecord(value) || !Array.isArray(value.players)) return false;
  return (
    typeof value.roomCode === "string" &&
    (value.status === "lobby" || value.status === "playing" || value.status === "finished") &&
    (value.maxPlayers === 4 || value.maxPlayers === 5 || value.maxPlayers === 6) &&
    typeof value.hostPlayerId === "string" &&
    typeof value.stateVersion === "number" &&
    value.players.every(isPublicPlayer)
  );
};

const isServerEvent = (value: unknown): value is ServerEvent => {
  if (!isRecord(value) || !isRecord(value.payload)) return false;
  if (
    value.version !== 1 ||
    typeof value.roomCode !== "string" ||
    typeof value.stateVersion !== "number" ||
    typeof value.eventId !== "string" ||
    typeof value.serverTime !== "string" ||
    (value.requestId !== undefined && typeof value.requestId !== "string")
  ) {
    return false;
  }

  switch (value.type) {
    case "GAME_STATE_SYNC":
      return isPublicRoom(value.payload.room);
    case "PLAYER_JOINED":
    case "PLAYER_RECONNECTED":
      return isPublicPlayer(value.payload.player);
    case "PLAYER_LEFT":
      return typeof value.payload.playerId === "string" && typeof value.payload.reservationExpiresAt === "string";
    case "PLAYER_READY":
      return typeof value.payload.playerId === "string" && typeof value.payload.ready === "boolean";
    case "GAME_STARTED":
      return value.payload.status === "playing";
    case "ERROR":
      return typeof value.payload.code === "string" && typeof value.payload.message === "string";
    default:
      return false;
  }
};

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
        store.setConnectionState("connected");
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
          if (!isServerEvent(event)) {
            store.setError({ code: "INVALID_MESSAGE", message: "Server message has an invalid shape." });
            return;
          }
          store.applyEvent(event);
          if (isAuthenticationError(event)) {
            stopRetryingRef.current = true;
            store.setConnectionState("error");
            socket.close();
          }
        } catch {
          store.setError({ code: "INVALID_MESSAGE", message: "Server message is not valid JSON." });
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

  return { sendReady, sendStartGame };
}
