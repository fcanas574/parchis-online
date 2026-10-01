export type PlayerColor =
  | "green"
  | "red"
  | "blue"
  | "yellow"
  | "purple"
  | "orange";

export type RoomStatus = "lobby" | "playing" | "finished";
export type GameStatus = Extract<RoomStatus, "playing" | "finished">;
export type PieceLocation = "yard" | "track" | "finish_path" | "finished";
export type TurnPhase =
  | "waiting_for_roll"
  | "waiting_for_move"
  | "waiting_for_bonus"
  | "finished";
export type DiceIndex = 0 | 1;
export type BonusReason = "capture" | "goal";
export type DiceSkinId = "classic" | "brass" | "jade" | "midnight";
export type PieceSkinId = "classic" | "porcelain" | "walnut" | "glow";
export type GiftId = "rose" | "tomato" | "applause" | "confetti" | "heart" | "fire";
export type ReactionId =
  | "laugh"
  | "cry"
  | "angry"
  | "cool"
  | "shocked"
  | "heart"
  | "applause";

export type PlayerLastRoll = {
  values: [number, number];
  turnNumber: number;
};

export type ChatMessage = {
  messageId: string;
  playerId: string;
  displayName: string;
  text: string;
  sentAt: string;
};

export type PublicPlayer = {
  id: string;
  displayName: string;
  color: PlayerColor;
  seatIndex: number;
  isHost: boolean;
  isBot: boolean;
  isReady: boolean;
  isConnected: boolean;
  reservationExpiresAt: string | null;
  diceSkinId: DiceSkinId;
  pieceSkinId: PieceSkinId;
  lastReceivedGiftId: GiftId | null;
};

export type PiecePosition = {
  state: PieceLocation;
  trackPosition: number | null;
  finishProgress: number | null;
};

export type Piece = {
  id: string;
  playerId: string;
  state: PieceLocation;
  trackPosition: number | null;
  finishProgress: number | null;
};

export type MoveOption = {
  pieceId: string;
  diceIndices: DiceIndex[];
  steps: number;
  destination: PiecePosition;
  capturePieceId: string | null;
  completesPiece: boolean;
  captures: boolean;
  landsSafe: boolean;
  leavesHome: boolean;
  progress: number;
  completesSplitPlan: boolean;
};

export type PendingBonus = {
  playerId: string;
  steps: number;
  reason: BonusReason;
};

export type PlayerPlacement = {
  playerId: string;
  rank: number;
};

export type GameResult = {
  winnerId: string;
  placements: PlayerPlacement[];
};

export type GameState = {
  roomCode: string;
  seatCount: 4 | 5 | 6;
  status: GameStatus;
  playerOrder: string[];
  currentPlayerId: string | null;
  turnPhase: TurnPhase;
  diceValues: [number, number] | null;
  usedDiceIndices: DiceIndex[];
  availableMoves: MoveOption[];
  pendingBonuses: PendingBonus[];
  pieces: Piece[];
  finishOrder: string[];
  winnerId: string | null;
  result: GameResult | null;
  requiresSplitPlan: boolean;
  turnNumber: number;
  lastRollsByPlayerId: Record<string, PlayerLastRoll>;
};

export type PublicRoomState = {
  roomCode: string;
  mode: "friends" | "practice";
  status: RoomStatus;
  maxPlayers: 4 | 5 | 6;
  hostPlayerId: string;
  players: PublicPlayer[];
  stateVersion: number;
  gameState: GameState | null;
  lastGameResult: GameResult | null;
};

export type CreateRoomPayload = {
  displayName: string;
  playerCount: 4 | 5 | 6;
  color?: PlayerColor;
};

export type CreatePracticePayload = CreateRoomPayload;

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
