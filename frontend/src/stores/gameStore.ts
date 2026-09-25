import { create } from "zustand";
import type { RoomSession } from "@/lib/session";
import type { PublicRoomState } from "@/types/game";
import type { ServerEvent } from "@/types/protocol";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

type StoreError = { code: string; message: string };

type GameStore = {
  room: PublicRoomState | null;
  session: RoomSession | null;
  connectionState: ConnectionState;
  lastError: StoreError | null;
  lastStateVersion: number;
  recentEvents: ServerEvent[];
  setSession: (session: RoomSession | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  applyEvent: (event: ServerEvent) => void;
  setError: (error: StoreError | null) => void;
  reset: () => void;
};

const initialState = {
  room: null,
  session: null,
  connectionState: "idle" as ConnectionState,
  lastError: null,
  lastStateVersion: 0,
  recentEvents: [] as ServerEvent[],
};

const appendEvent = (recentEvents: ServerEvent[], event: ServerEvent) =>
  [...recentEvents, event].slice(-25);

const applyLobbyEvent = (
  room: PublicRoomState,
  event: Exclude<ServerEvent, Extract<ServerEvent, { type: "GAME_STATE_SYNC" | "ERROR" }>>,
): PublicRoomState => {
  const next = { ...room, stateVersion: event.stateVersion };
  switch (event.type) {
    case "PLAYER_JOINED":
    case "PLAYER_RECONNECTED": {
      const players = room.players.filter((player) => player.id !== event.payload.player.id);
      return { ...next, players: [...players, event.payload.player] };
    }
    case "PLAYER_LEFT":
      return { ...next, players: room.players.filter((player) => player.id !== event.payload.playerId) };
    case "PLAYER_READY":
      return {
        ...next,
        players: room.players.map((player) =>
          player.id === event.payload.playerId ? { ...player, isReady: event.payload.ready } : player,
        ),
      };
    case "GAME_STARTED":
      return { ...next, status: event.payload.status };
  }
};

export const useGameStore = create<GameStore>((set) => ({
  ...initialState,
  setSession: (session) => set({ session }),
  setConnectionState: (connectionState) => set({ connectionState }),
  setError: (lastError) => set({ lastError }),
  applyEvent: (event) =>
    set((state) => {
      const recentEvents = appendEvent(state.recentEvents, event);
      if (event.type === "ERROR") {
        return { recentEvents, lastError: event.payload };
      }
      if (event.stateVersion < state.lastStateVersion) {
        return { recentEvents };
      }
      if (event.type === "GAME_STATE_SYNC") {
        return {
          recentEvents,
          room: event.payload.room,
          lastStateVersion: event.stateVersion,
        };
      }
      if (state.room === null || state.room.roomCode !== event.roomCode) {
        return { recentEvents };
      }
      return {
        recentEvents,
        room: applyLobbyEvent(state.room, event),
        lastStateVersion: event.stateVersion,
      };
    }),
  reset: () => set(initialState),
}));
