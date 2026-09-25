export type PlayerColor =
  | "green"
  | "red"
  | "blue"
  | "yellow"
  | "purple"
  | "orange";

export type RoomStatus = "lobby" | "playing" | "finished";

export type PublicPlayer = {
  id: string;
  displayName: string;
  color: PlayerColor;
  seatIndex: number;
  isHost: boolean;
  isReady: boolean;
  isConnected: boolean;
  reservationExpiresAt: string | null;
};

export type PublicRoomState = {
  roomCode: string;
  status: RoomStatus;
  maxPlayers: 4 | 5 | 6;
  hostPlayerId: string;
  players: PublicPlayer[];
  stateVersion: number;
};

export type CreateRoomPayload = {
  displayName: string;
  playerCount: 4 | 5 | 6;
  color?: PlayerColor;
};

export type JoinRoomPayload = {
  displayName: string;
  color?: PlayerColor;
};

export type RoomCredentials = {
  roomCode: string;
  playerId: string;
  playerToken: string;
  isHost: boolean;
  wsPath: string;
};
