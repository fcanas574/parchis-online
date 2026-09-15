import type { PublicPlayer, PublicRoomState } from "./game";

export type ClientCommand =
  | { type: "RECONNECT"; version: 1; roomCode: string; playerToken: string }
  | { type: "PLAYER_READY"; version: 1; ready: boolean; requestId: string }
  | { type: "START_GAME"; version: 1; requestId: string };

export type ServerEventEnvelope<T extends string, P> = {
  type: T;
  version: 1;
  roomCode: string;
  stateVersion: number;
  eventId: string;
  serverTime: string;
  requestId?: string;
  payload: P;
};

export type ServerEvent =
  | ServerEventEnvelope<"PLAYER_JOINED", { player: PublicPlayer }>
  | ServerEventEnvelope<"PLAYER_LEFT", { playerId: string; reservationExpiresAt: string }>
  | ServerEventEnvelope<"PLAYER_RECONNECTED", { player: PublicPlayer }>
  | ServerEventEnvelope<"PLAYER_READY", { playerId: string; ready: boolean }>
  | ServerEventEnvelope<"GAME_STARTED", { status: "playing" }>
  | ServerEventEnvelope<"GAME_STATE_SYNC", { room: PublicRoomState }>
  | ServerEventEnvelope<"ERROR", { code: string; message: string }>;
