import type {
  ChatMessage,
  DiceIndex,
  DiceSkinId,
  GameResult,
  GameState,
  GiftId,
  MoveOption,
  PieceSkinId,
  PiecePosition,
  PlayerLastRoll,
  PublicPlayer,
  PublicRoomState,
  ReactionId,
} from "./game";

export type ClientCommand =
  | { type: "RECONNECT"; version: 1; roomCode: string; playerToken: string }
  | { type: "PLAYER_READY"; version: 1; ready: boolean; requestId: string }
  | { type: "START_GAME"; version: 1; requestId: string }
  | { type: "ROLL_DICE"; version: 1; requestId: string }
  | {
      type: "MOVE_PIECE";
      version: 1;
      requestId: string;
      pieceId: string;
      diceIndices: DiceIndex[];
    }
  | {
      type: "MOVE_BONUS_PIECE";
      version: 1;
      requestId: string;
      pieceId: string;
  }
  | { type: "RETURN_TO_LOBBY"; version: 1; requestId: string }
  | { type: "PLAY_AGAIN"; version: 1; requestId: string }
  | { type: "CHAT_MESSAGE"; version: 1; requestId: string; text: string }
  | {
      type: "REACTION_SENT";
      version: 1;
      requestId: string;
      reactionId: ReactionId;
    }
  | {
      type: "GIFT_SENT";
      version: 1;
      requestId: string;
      toPlayerId: string;
      giftId: GiftId;
    }
  | {
      type: "SET_COSMETICS";
      version: 1;
      requestId: string;
      diceSkinId: DiceSkinId;
      pieceSkinId: PieceSkinId;
    };

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
  | ServerEventEnvelope<"TURN_STARTED", { playerId: string }>
  | ServerEventEnvelope<
      "DICE_ROLLED",
      { playerId: string; values: [number, number]; availableMoves: MoveOption[] }
    >
  | ServerEventEnvelope<
      "PIECE_MOVED",
      {
        pieceId: string;
        from: PiecePosition;
        to: PiecePosition;
        diceIndices: DiceIndex[];
        path: PiecePosition[];
      }
    >
  | ServerEventEnvelope<
      "PIECE_CAPTURED",
      { capturedPieceId: string; byPieceId: string; bonusSteps: number }
    >
  | ServerEventEnvelope<
      "BONUS_GRANTED",
      { playerId: string; steps: number; reason: "capture" | "goal" }
    >
  | ServerEventEnvelope<
      "BONUS_SKIPPED",
      {
        playerId: string;
        steps: number;
        reason: "capture" | "goal";
        skipReason: "no_legal_moves" | "player_not_active";
      }
    >
  | ServerEventEnvelope<"TURN_ENDED", { playerId: string; extraTurn: boolean }>
  | ServerEventEnvelope<"PLAYER_FINISHED", { playerId: string; rank: number }>
  | ServerEventEnvelope<
      "GAME_FINISHED",
      { winnerId: string; finishOrder: string[]; placements: GameResult["placements"] }
    >
  | ServerEventEnvelope<
      "GAME_STATE_SYNC",
      { room: PublicRoomState; game: GameState | null }
    >
  | ServerEventEnvelope<
      "GAME_RESET",
      { status: "lobby"; requestedReplay: boolean; requesterId: string }
    >
  | ServerEventEnvelope<"CHAT_HISTORY_SYNC", { messages: ChatMessage[] }>
  | ServerEventEnvelope<"CHAT_MESSAGE", ChatMessage>
  | ServerEventEnvelope<"REACTION_SENT", { playerId: string; reactionId: ReactionId }>
  | ServerEventEnvelope<
      "GIFT_SENT",
      { fromPlayerId: string; toPlayerId: string; giftId: GiftId }
    >
  | ServerEventEnvelope<
      "PLAYER_COSMETICS_UPDATED",
      { playerId: string; diceSkinId: DiceSkinId; pieceSkinId: PieceSkinId }
    >
  | ServerEventEnvelope<"ERROR", { code: string; message: string }>;

export type PieceMoveEvent = Extract<ServerEvent, { type: "PIECE_MOVED" }>;
export type PieceCaptureEvent = Extract<ServerEvent, { type: "PIECE_CAPTURED" }>;

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactKeys = (
  value: UnknownRecord,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): boolean => {
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  return (
    requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowedKeys.has(key))
  );
};

const isString = (value: unknown, minimumLength = 0): value is string =>
  typeof value === "string" && value.length >= minimumLength;

const isIntegerAtLeast = (value: unknown, minimum: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;

const isDateTime = (value: unknown): value is string =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
    value,
  ) &&
  Number.isFinite(Date.parse(value));

const isRoomCode = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z2-9]{5}$/.test(value);

const isDiceIndex = (value: unknown): value is DiceIndex => value === 0 || value === 1;

const isPlayerColor = (value: unknown): value is PublicPlayer["color"] =>
  value === "green" ||
  value === "red" ||
  value === "blue" ||
  value === "yellow" ||
  value === "purple" ||
  value === "orange";

const isDiceSkinId = (value: unknown): value is DiceSkinId =>
  value === "classic" ||
  value === "brass" ||
  value === "jade" ||
  value === "midnight";

const isPieceSkinId = (value: unknown): value is PieceSkinId =>
  value === "classic" ||
  value === "porcelain" ||
  value === "walnut" ||
  value === "glow";

const isGiftId = (value: unknown): value is GiftId =>
  value === "rose" ||
  value === "tomato" ||
  value === "applause" ||
  value === "confetti" ||
  value === "heart" ||
  value === "fire";

const isReactionId = (value: unknown): value is ReactionId =>
  value === "laugh" ||
  value === "cry" ||
  value === "angry" ||
  value === "cool" ||
  value === "shocked" ||
  value === "heart" ||
  value === "applause";

const isWithinLength = (
  value: unknown,
  minimum: number,
  maximum: number,
): value is string => isString(value, minimum) && value.length <= maximum;

const isPublicPlayer = (value: unknown): value is PublicPlayer => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "displayName",
      "color",
      "seatIndex",
      "isHost",
      "isBot",
      "isReady",
      "isConnected",
      "reservationExpiresAt",
      "diceSkinId",
      "pieceSkinId",
      "lastReceivedGiftId",
    ])
  ) {
    return false;
  }
  return (
    isString(value.id, 1) &&
    isString(value.displayName, 1) &&
    isPlayerColor(value.color) &&
    isIntegerAtLeast(value.seatIndex, 0) &&
    value.seatIndex <= 5 &&
    typeof value.isHost === "boolean" &&
    typeof value.isBot === "boolean" &&
    typeof value.isReady === "boolean" &&
    typeof value.isConnected === "boolean" &&
    (value.reservationExpiresAt === null || isDateTime(value.reservationExpiresAt)) &&
    isDiceSkinId(value.diceSkinId) &&
    isPieceSkinId(value.pieceSkinId) &&
    (value.lastReceivedGiftId === null || isGiftId(value.lastReceivedGiftId))
  );
};

const isPlayerLastRoll = (value: unknown): value is PlayerLastRoll =>
  isRecord(value) &&
  hasExactKeys(value, ["values", "turnNumber"]) &&
  Array.isArray(value.values) &&
  value.values.length === 2 &&
  value.values.every((die) => isIntegerAtLeast(die, 1) && die <= 6) &&
  isIntegerAtLeast(value.turnNumber, 1);

const isLastRollsByPlayerId = (
  value: unknown,
): value is Record<string, PlayerLastRoll> =>
  isRecord(value) &&
  Object.keys(value).length <= 6 &&
  Object.entries(value).every(
    ([playerId, lastRoll]) =>
      isWithinLength(playerId, 1, 64) && isPlayerLastRoll(lastRoll),
  );

const isPiecePosition = (value: unknown): value is PiecePosition => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["state", "trackPosition", "finishProgress"])
  ) {
    return false;
  }
  return (
    (value.state === "yard" ||
      value.state === "track" ||
      value.state === "finish_path" ||
      value.state === "finished") &&
    (value.trackPosition === null || isIntegerAtLeast(value.trackPosition, 0)) &&
    (value.finishProgress === null || isIntegerAtLeast(value.finishProgress, 0))
  );
};

const isPiece = (value: unknown): boolean =>
  isRecord(value) &&
  hasExactKeys(value, ["id", "playerId", "state", "trackPosition", "finishProgress"]) &&
  isString(value.id, 1) &&
  isString(value.playerId, 1) &&
  (value.state === "yard" ||
    value.state === "track" ||
    value.state === "finish_path" ||
    value.state === "finished") &&
  (value.trackPosition === null || isIntegerAtLeast(value.trackPosition, 0)) &&
  (value.finishProgress === null || isIntegerAtLeast(value.finishProgress, 0));

const isMoveOption = (value: unknown): value is MoveOption => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "pieceId",
      "diceIndices",
      "steps",
      "destination",
      "capturePieceId",
      "completesPiece",
      "captures",
      "landsSafe",
      "leavesHome",
      "progress",
      "completesSplitPlan",
    ])
  ) {
    return false;
  }
  return (
    isString(value.pieceId, 1) &&
    Array.isArray(value.diceIndices) &&
    value.diceIndices.length <= 2 &&
    value.diceIndices.every(isDiceIndex) &&
    isIntegerAtLeast(value.steps, 1) &&
    isPiecePosition(value.destination) &&
    (value.capturePieceId === null || isString(value.capturePieceId, 1)) &&
    typeof value.completesPiece === "boolean" &&
    typeof value.captures === "boolean" &&
    typeof value.landsSafe === "boolean" &&
    typeof value.leavesHome === "boolean" &&
    isIntegerAtLeast(value.progress, 0) &&
    typeof value.completesSplitPlan === "boolean"
  );
};

const isGameResult = (value: unknown): value is GameResult => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["winnerId", "placements"]) ||
    !isString(value.winnerId, 1) ||
    !Array.isArray(value.placements) ||
    value.placements.length < 4 ||
    value.placements.length > 6
  ) {
    return false;
  }
  return value.placements.every(
    (placement) =>
      isRecord(placement) &&
      hasExactKeys(placement, ["playerId", "rank"]) &&
      isString(placement.playerId, 1) &&
      isIntegerAtLeast(placement.rank, 1) &&
      placement.rank <= 6,
  );
};

const isGameState = (value: unknown): value is GameState => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "roomCode",
      "seatCount",
      "status",
      "playerOrder",
      "currentPlayerId",
      "turnPhase",
      "diceValues",
      "usedDiceIndices",
      "availableMoves",
      "pendingBonuses",
      "pieces",
      "finishOrder",
      "winnerId",
      "result",
      "requiresSplitPlan",
      "turnNumber",
      "lastRollsByPlayerId",
    ])
  ) {
    return false;
  }

  const diceAreValid =
    value.diceValues === null ||
    (Array.isArray(value.diceValues) &&
      value.diceValues.length === 2 &&
      value.diceValues.every(
        (die) => isIntegerAtLeast(die, 1) && die <= 6,
      ));
  const usedDiceAreValid =
    Array.isArray(value.usedDiceIndices) &&
    value.usedDiceIndices.length <= 2 &&
    value.usedDiceIndices.every(isDiceIndex) &&
    new Set(value.usedDiceIndices).size === value.usedDiceIndices.length;
  const pendingBonusesAreValid =
    Array.isArray(value.pendingBonuses) &&
    value.pendingBonuses.every(
      (bonus) =>
        isRecord(bonus) &&
        hasExactKeys(bonus, ["playerId", "steps", "reason"]) &&
        isString(bonus.playerId, 1) &&
        isIntegerAtLeast(bonus.steps, 1) &&
        (bonus.reason === "capture" || bonus.reason === "goal"),
    );

  return (
    isRoomCode(value.roomCode) &&
    (value.seatCount === 4 || value.seatCount === 5 || value.seatCount === 6) &&
    (value.status === "playing" || value.status === "finished") &&
    Array.isArray(value.playerOrder) &&
    value.playerOrder.length >= 4 &&
    value.playerOrder.length <= 6 &&
    value.playerOrder.every((id) => isString(id, 1)) &&
    (value.currentPlayerId === null || isString(value.currentPlayerId, 1)) &&
    (value.turnPhase === "waiting_for_roll" ||
      value.turnPhase === "waiting_for_move" ||
      value.turnPhase === "waiting_for_bonus" ||
      value.turnPhase === "finished") &&
    diceAreValid &&
    usedDiceAreValid &&
    Array.isArray(value.availableMoves) &&
    value.availableMoves.every(isMoveOption) &&
    pendingBonusesAreValid &&
    Array.isArray(value.pieces) &&
    value.pieces.every(isPiece) &&
    Array.isArray(value.finishOrder) &&
    value.finishOrder.length <= 6 &&
    value.finishOrder.every((id) => isString(id, 1)) &&
    (value.winnerId === null || isString(value.winnerId, 1)) &&
    (value.result === null || isGameResult(value.result)) &&
    typeof value.requiresSplitPlan === "boolean" &&
    isIntegerAtLeast(value.turnNumber, 1) &&
    isLastRollsByPlayerId(value.lastRollsByPlayerId)
  );
};

const isPublicRoom = (value: unknown): value is PublicRoomState => {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "roomCode",
      "mode",
      "status",
      "maxPlayers",
      "hostPlayerId",
      "players",
      "stateVersion",
      "gameState",
      "lastGameResult",
    ])
  ) {
    return false;
  }
  return (
    isRoomCode(value.roomCode) &&
    (value.mode === "friends" || value.mode === "practice") &&
    (value.status === "lobby" || value.status === "playing" || value.status === "finished") &&
    (value.maxPlayers === 4 || value.maxPlayers === 5 || value.maxPlayers === 6) &&
    isString(value.hostPlayerId, 1) &&
    Array.isArray(value.players) &&
    value.players.length <= 6 &&
    value.players.every(isPublicPlayer) &&
    isIntegerAtLeast(value.stateVersion, 0) &&
    (value.gameState === null || isGameState(value.gameState)) &&
    (value.lastGameResult === null || isGameResult(value.lastGameResult))
  );
};

const deepEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqual(value, right[index]))
    );
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) => Object.hasOwn(right, key) && deepEqual(left[key], right[key]),
    )
  );
};

const isStringArray = (
  value: unknown,
  minimumLength = 0,
  maximumLength = Number.POSITIVE_INFINITY,
): value is string[] =>
  Array.isArray(value) &&
  value.length >= minimumLength &&
  value.length <= maximumLength &&
  value.every((item) => isString(item, 1));

const isPlacementArray = (value: unknown): boolean =>
  Array.isArray(value) &&
  value.length >= 4 &&
  value.length <= 6 &&
  value.every(
    (placement) =>
      isRecord(placement) &&
      hasExactKeys(placement, ["playerId", "rank"]) &&
      isString(placement.playerId, 1) &&
      isIntegerAtLeast(placement.rank, 1) &&
      placement.rank <= 6,
  );

const isChatMessage = (value: unknown): value is ChatMessage =>
  isRecord(value) &&
  hasExactKeys(value, ["messageId", "playerId", "displayName", "text", "sentAt"]) &&
  isWithinLength(value.messageId, 1, 64) &&
  isWithinLength(value.playerId, 1, 64) &&
  isWithinLength(value.displayName, 1, 24) &&
  isWithinLength(value.text, 1, 280) &&
  isDateTime(value.sentAt);

const isEventPayload = (type: unknown, payload: unknown): boolean => {
  if (!isRecord(payload)) return false;
  switch (type) {
    case "PLAYER_JOINED":
    case "PLAYER_RECONNECTED":
      return hasExactKeys(payload, ["player"]) && isPublicPlayer(payload.player);
    case "PLAYER_LEFT":
      return (
        hasExactKeys(payload, ["playerId", "reservationExpiresAt"]) &&
        isString(payload.playerId, 1) &&
        isDateTime(payload.reservationExpiresAt)
      );
    case "PLAYER_READY":
      return (
        hasExactKeys(payload, ["playerId", "ready"]) &&
        isString(payload.playerId, 1) &&
        typeof payload.ready === "boolean"
      );
    case "GAME_STARTED":
      return hasExactKeys(payload, ["status"]) && payload.status === "playing";
    case "TURN_STARTED":
      return hasExactKeys(payload, ["playerId"]) && isString(payload.playerId, 1);
    case "DICE_ROLLED":
      return (
        hasExactKeys(payload, ["playerId", "values", "availableMoves"]) &&
        isString(payload.playerId, 1) &&
        Array.isArray(payload.values) &&
        payload.values.length === 2 &&
        payload.values.every((die) => isIntegerAtLeast(die, 1) && die <= 6) &&
        Array.isArray(payload.availableMoves) &&
        payload.availableMoves.every(isMoveOption)
      );
    case "PIECE_MOVED":
      return (
        hasExactKeys(payload, ["pieceId", "from", "to", "diceIndices", "path"]) &&
        isString(payload.pieceId, 1) &&
        isPiecePosition(payload.from) &&
        isPiecePosition(payload.to) &&
        Array.isArray(payload.diceIndices) &&
        payload.diceIndices.length <= 2 &&
        payload.diceIndices.every(isDiceIndex) &&
        Array.isArray(payload.path) &&
        payload.path.length > 0 &&
        payload.path.every(isPiecePosition) &&
        deepEqual(payload.path[payload.path.length - 1], payload.to)
      );
    case "PIECE_CAPTURED":
      return (
        hasExactKeys(payload, ["capturedPieceId", "byPieceId", "bonusSteps"]) &&
        isString(payload.capturedPieceId, 1) &&
        isString(payload.byPieceId, 1) &&
        isIntegerAtLeast(payload.bonusSteps, 0)
      );
    case "BONUS_GRANTED":
    case "BONUS_SKIPPED":
      return (
        hasExactKeys(
          payload,
          type === "BONUS_GRANTED"
            ? ["playerId", "steps", "reason"]
            : ["playerId", "steps", "reason", "skipReason"],
        ) &&
        isString(payload.playerId, 1) &&
        isIntegerAtLeast(payload.steps, 1) &&
        (payload.reason === "capture" || payload.reason === "goal") &&
        (type === "BONUS_GRANTED" ||
          payload.skipReason === "no_legal_moves" ||
          payload.skipReason === "player_not_active")
      );
    case "TURN_ENDED":
      return (
        hasExactKeys(payload, ["playerId", "extraTurn"]) &&
        isString(payload.playerId, 1) &&
        typeof payload.extraTurn === "boolean"
      );
    case "PLAYER_FINISHED":
      return (
        hasExactKeys(payload, ["playerId", "rank"]) &&
        isString(payload.playerId, 1) &&
        isIntegerAtLeast(payload.rank, 1) &&
        payload.rank <= 6
      );
    case "GAME_FINISHED":
      return (
        hasExactKeys(payload, ["winnerId", "finishOrder", "placements"]) &&
        isString(payload.winnerId, 1) &&
        isStringArray(payload.finishOrder, 3, 5) &&
        isPlacementArray(payload.placements)
      );
    case "GAME_STATE_SYNC":
      return (
        hasExactKeys(payload, ["room", "game"]) &&
        isPublicRoom(payload.room) &&
        (payload.game === null || isGameState(payload.game)) &&
        deepEqual(payload.game, payload.room.gameState)
      );
    case "GAME_RESET":
      return (
        hasExactKeys(payload, ["status", "requestedReplay", "requesterId"]) &&
        payload.status === "lobby" &&
        typeof payload.requestedReplay === "boolean" &&
        isString(payload.requesterId, 1)
      );
    case "CHAT_HISTORY_SYNC":
      return (
        hasExactKeys(payload, ["messages"]) &&
        Array.isArray(payload.messages) &&
        payload.messages.length <= 50 &&
        payload.messages.every(isChatMessage)
      );
    case "CHAT_MESSAGE":
      return isChatMessage(payload);
    case "REACTION_SENT":
      return (
        hasExactKeys(payload, ["playerId", "reactionId"]) &&
        isWithinLength(payload.playerId, 1, 64) &&
        isReactionId(payload.reactionId)
      );
    case "GIFT_SENT":
      return (
        hasExactKeys(payload, ["fromPlayerId", "toPlayerId", "giftId"]) &&
        isWithinLength(payload.fromPlayerId, 1, 64) &&
        isWithinLength(payload.toPlayerId, 1, 64) &&
        isGiftId(payload.giftId)
      );
    case "PLAYER_COSMETICS_UPDATED":
      return (
        hasExactKeys(payload, ["playerId", "diceSkinId", "pieceSkinId"]) &&
        isWithinLength(payload.playerId, 1, 64) &&
        isDiceSkinId(payload.diceSkinId) &&
        isPieceSkinId(payload.pieceSkinId)
      );
    case "ERROR":
      return (
        hasExactKeys(payload, ["code", "message"]) &&
        isString(payload.code, 1) &&
        isString(payload.message)
      );
    default:
      return false;
  }
};

export const isClientCommand = (value: unknown): value is ClientCommand => {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.type !== "string"
  ) {
    return false;
  }

  switch (value.type) {
    case "RECONNECT":
      return (
        hasExactKeys(value, ["type", "version", "roomCode", "playerToken"]) &&
        isRoomCode(value.roomCode) &&
        isWithinLength(value.playerToken, 32, 256)
      );
    case "PLAYER_READY":
      return (
        hasExactKeys(value, ["type", "version", "ready", "requestId"]) &&
        typeof value.ready === "boolean" &&
        isWithinLength(value.requestId, 1, 64)
      );
    case "START_GAME":
    case "ROLL_DICE":
    case "RETURN_TO_LOBBY":
    case "PLAY_AGAIN":
      return (
        hasExactKeys(value, ["type", "version", "requestId"]) &&
        isWithinLength(value.requestId, 1, 64)
      );
    case "MOVE_PIECE":
      return (
        hasExactKeys(value, ["type", "version", "requestId", "pieceId", "diceIndices"]) &&
        isWithinLength(value.requestId, 1, 64) &&
        isWithinLength(value.pieceId, 1, 64) &&
        Array.isArray(value.diceIndices) &&
        value.diceIndices.length >= 1 &&
        value.diceIndices.length <= 2 &&
        value.diceIndices.every(isDiceIndex) &&
        new Set(value.diceIndices).size === value.diceIndices.length
      );
    case "MOVE_BONUS_PIECE":
      return (
        hasExactKeys(value, ["type", "version", "requestId", "pieceId"]) &&
        isWithinLength(value.requestId, 1, 64) &&
        isWithinLength(value.pieceId, 1, 64)
      );
    case "CHAT_MESSAGE":
      return (
        hasExactKeys(value, ["type", "version", "requestId", "text"]) &&
        isWithinLength(value.requestId, 1, 64) &&
        isWithinLength(value.text, 1, 280)
      );
    case "REACTION_SENT":
      return (
        hasExactKeys(value, ["type", "version", "requestId", "reactionId"]) &&
        isWithinLength(value.requestId, 1, 64) &&
        isReactionId(value.reactionId)
      );
    case "GIFT_SENT":
      return (
        hasExactKeys(value, ["type", "version", "requestId", "toPlayerId", "giftId"]) &&
        isWithinLength(value.requestId, 1, 64) &&
        isWithinLength(value.toPlayerId, 1, 64) &&
        isGiftId(value.giftId)
      );
    case "SET_COSMETICS":
      return (
        hasExactKeys(value, ["type", "version", "requestId", "diceSkinId", "pieceSkinId"]) &&
        isWithinLength(value.requestId, 1, 64) &&
        isDiceSkinId(value.diceSkinId) &&
        isPieceSkinId(value.pieceSkinId)
      );
    default:
      return false;
  }
};

export const isServerEvent = (value: unknown): value is ServerEvent => {
  if (
    !isRecord(value) ||
    !hasExactKeys(
      value,
      [
        "type",
        "version",
        "roomCode",
        "stateVersion",
        "eventId",
        "serverTime",
        "payload",
      ],
      ["requestId"],
    ) ||
    value.version !== 1 ||
    !isRoomCode(value.roomCode) ||
    !isIntegerAtLeast(value.stateVersion, 0) ||
    !isString(value.eventId, 1) ||
    !isDateTime(value.serverTime) ||
    (Object.hasOwn(value, "requestId") &&
      (!isString(value.requestId, 1) || value.requestId.length > 64)) ||
    !isEventPayload(value.type, value.payload)
  ) {
    return false;
  }

  if (value.type === "GAME_STATE_SYNC") {
    const payload = value.payload;
    if (
      !isRecord(payload) ||
      !isPublicRoom(payload.room) ||
      payload.room.roomCode !== value.roomCode ||
      payload.room.stateVersion !== value.stateVersion
    ) {
      return false;
    }
    if (
      payload.game !== null &&
      (!isGameState(payload.game) || payload.game.roomCode !== value.roomCode)
    ) {
      return false;
    }
  }
  return true;
};
