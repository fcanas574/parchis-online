import { create } from "zustand";
import type { RoomSession } from "@/lib/session";
import type { ChatMessage, PublicRoomState } from "@/types/game";
import type { ServerEvent } from "@/types/protocol";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

type StoreError = { code: string; message: string };

type LobbyEvent = Extract<
  ServerEvent,
  {
    type:
      | "PLAYER_JOINED"
      | "PLAYER_LEFT"
      | "PLAYER_RECONNECTED"
      | "PLAYER_READY"
      | "GAME_STARTED";
  }
>;

type GameStore = {
  room: PublicRoomState | null;
  session: RoomSession | null;
  connectionState: ConnectionState;
  lastError: StoreError | null;
  lastStateVersion: number;
  recentEvents: ServerEvent[];
  chatMessages: ChatMessage[];
  chatRoomCode: string | null;
  chatHistoryReady: boolean;
  setSession: (session: RoomSession | null) => void;
  setConnectionState: (state: ConnectionState) => void;
  clearTransientEvents: () => void;
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
  chatMessages: [] as ChatMessage[],
  chatRoomCode: null as string | null,
  chatHistoryReady: false,
};

const appendEvent = (recentEvents: ServerEvent[], event: ServerEvent) =>
  [...recentEvents, event].slice(-25);

const mergeChatMessages = (...groups: readonly ChatMessage[][]): ChatMessage[] => {
  const byMessageId = new Map<string, ChatMessage>();
  for (const messages of groups) {
    for (const message of messages) byMessageId.set(message.messageId, message);
  }
  return [...byMessageId.values()]
    .sort((left, right) => Date.parse(left.sentAt) - Date.parse(right.sentAt))
    .slice(-50);
};

const isLobbyEvent = (event: ServerEvent): event is LobbyEvent =>
  event.type === "PLAYER_JOINED" ||
  event.type === "PLAYER_LEFT" ||
  event.type === "PLAYER_RECONNECTED" ||
  event.type === "PLAYER_READY" ||
  event.type === "GAME_STARTED";

const applyLobbyEvent = (
  room: PublicRoomState,
  event: LobbyEvent,
): PublicRoomState => {
  const next = { ...room, stateVersion: event.stateVersion };
  switch (event.type) {
    case "PLAYER_JOINED":
    case "PLAYER_RECONNECTED": {
      const players = room.players.filter(
        (player) => player.id !== event.payload.player.id,
      );
      return {
        ...next,
        players: [...players, event.payload.player].sort(
          (left, right) => left.seatIndex - right.seatIndex,
        ),
      };
    }
    case "PLAYER_LEFT":
      return {
        ...next,
        players: room.players.filter(
          (player) => player.id !== event.payload.playerId,
        ),
      };
    case "PLAYER_READY":
      return {
        ...next,
        players: room.players.map((player) =>
          player.id === event.payload.playerId
            ? { ...player, isReady: event.payload.ready }
            : player,
        ),
      };
    case "GAME_STARTED":
      return { ...next, status: event.payload.status };
  }
};

export const useGameStore = create<GameStore>((set) => {
  let liveChatMessagesSinceHistory: ChatMessage[] = [];
  let liveChatRoomCode: string | null = null;

  return {
    ...initialState,
    setSession: (session) => set({ session }),
    setConnectionState: (connectionState) => set({ connectionState }),
    setError: (lastError) => set({ lastError }),
    clearTransientEvents: () => {
      liveChatMessagesSinceHistory = [];
      liveChatRoomCode = null;
      set({ recentEvents: [], chatHistoryReady: false });
    },
    applyEvent: (event) =>
      set((state) => {
        if (event.type === "CHAT_MESSAGE") {
          if (liveChatRoomCode !== event.roomCode) {
            liveChatMessagesSinceHistory = [];
            liveChatRoomCode = event.roomCode;
          }
          const sameRoom = state.chatRoomCode === event.roomCode;
          liveChatMessagesSinceHistory = mergeChatMessages(
            liveChatMessagesSinceHistory,
            [event.payload],
          );
          return {
            chatRoomCode: event.roomCode,
            chatHistoryReady: sameRoom ? state.chatHistoryReady : false,
            chatMessages: mergeChatMessages(sameRoom ? state.chatMessages : [], [event.payload]),
          };
        }
        if (event.type === "CHAT_HISTORY_SYNC") {
          const chatMessages = mergeChatMessages(
            event.payload.messages,
            liveChatRoomCode === event.roomCode ? liveChatMessagesSinceHistory : [],
          );
          liveChatMessagesSinceHistory = [];
          liveChatRoomCode = null;
          return { chatRoomCode: event.roomCode, chatHistoryReady: true, chatMessages };
        }
        if (event.type === "ERROR") {
          return {
            recentEvents: appendEvent(state.recentEvents, event),
            lastError: event.payload,
          };
        }
        if (event.type === "GAME_STATE_SYNC") {
          if (event.stateVersion < state.lastStateVersion) return {};
          return {
            room: event.payload.room,
            lastStateVersion: event.stateVersion,
            ...(state.room?.roomCode !== event.roomCode ? { chatHistoryReady: false } : {}),
          };
        }

        const recentEvents = appendEvent(state.recentEvents, event);
        if (event.stateVersion < state.lastStateVersion) return { recentEvents };
        if (state.room === null || state.room.roomCode !== event.roomCode) {
          return { recentEvents };
        }
        if (isLobbyEvent(event)) {
          return {
            recentEvents,
            room: applyLobbyEvent(state.room, event),
            lastStateVersion: event.stateVersion,
          };
        }
        // Semantic game/social events animate locally; authoritative state comes
        // only from GAME_STATE_SYNC.
        return { recentEvents, lastStateVersion: event.stateVersion };
      }),
    reset: () => {
      liveChatMessagesSinceHistory = [];
      liveChatRoomCode = null;
      set(initialState);
    },
  };
});
