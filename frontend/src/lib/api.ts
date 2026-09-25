import type {
  CreateRoomPayload,
  JoinRoomPayload,
  PublicRoomState,
  RoomCredentials,
} from "@/types/game";

export type ApiErrorPayload = { code: string; message: string };

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const apiOrigin = () => {
  const origin = process.env.NEXT_PUBLIC_API_ORIGIN;
  if (!origin) throw new ApiError("API_ORIGIN_MISSING", "API origin is not configured.");
  return origin;
};

type ResponseValidator<T> = (value: unknown) => value is T;

async function request<T>(
  path: string,
  isValidResponse: ResponseValidator<T>,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(new URL(path, apiOrigin()), init);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("NETWORK_ERROR", "Unable to reach the room service.");
  }

  if (!response.ok) {
    const fallback: ApiErrorPayload = {
      code: `HTTP_${response.status}`,
      message: response.statusText || "Room request failed.",
    };
    const body: unknown = await response.json().catch(() => fallback);
    const error = isApiErrorPayload(body) ? body : fallback;
    throw new ApiError(error.code, error.message);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError("INVALID_RESPONSE", "Room service returned an invalid response.");
  }
  if (!isValidResponse(body)) {
    throw new ApiError("INVALID_RESPONSE", "Room service returned an invalid response.");
  }
  return body;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isPlayerColor = (value: unknown): boolean =>
  value === "green" ||
  value === "red" ||
  value === "blue" ||
  value === "yellow" ||
  value === "purple" ||
  value === "orange";

const isFiniteInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);

const isApiErrorPayload = (value: unknown): value is ApiErrorPayload => {
  if (typeof value !== "object" || value === null) return false;
  const error = value as Record<string, unknown>;
  return isNonEmptyString(error.code) && isNonEmptyString(error.message);
};

const isRoomCredentials = (value: unknown): value is RoomCredentials => {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.roomCode) &&
    isNonEmptyString(value.playerId) &&
    isNonEmptyString(value.playerToken) &&
    typeof value.isHost === "boolean" &&
    isNonEmptyString(value.wsPath)
  );
};

const isPublicPlayer = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.displayName) &&
    isPlayerColor(value.color) &&
    isFiniteInteger(value.seatIndex) &&
    typeof value.isHost === "boolean" &&
    typeof value.isReady === "boolean" &&
    typeof value.isConnected === "boolean" &&
    (typeof value.reservationExpiresAt === "string" || value.reservationExpiresAt === null)
  );
};

const isPublicRoomState = (value: unknown): value is PublicRoomState => {
  if (!isRecord(value) || !Array.isArray(value.players)) return false;
  return (
    isNonEmptyString(value.roomCode) &&
    (value.status === "lobby" || value.status === "playing" || value.status === "finished") &&
    (value.maxPlayers === 4 || value.maxPlayers === 5 || value.maxPlayers === 6) &&
    isNonEmptyString(value.hostPlayerId) &&
    isFiniteInteger(value.stateVersion) &&
    value.players.every(isPublicPlayer)
  );
};

const jsonRequest = (payload: object): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

export function createRoom(payload: CreateRoomPayload): Promise<RoomCredentials> {
  return request<RoomCredentials>("/api/rooms", isRoomCredentials, jsonRequest(payload));
}

export function joinRoom(
  roomCode: string,
  payload: JoinRoomPayload,
): Promise<RoomCredentials> {
  return request<RoomCredentials>(
    `/api/rooms/${encodeURIComponent(roomCode)}/join`,
    isRoomCredentials,
    jsonRequest(payload),
  );
}

export function getRoom(roomCode: string): Promise<PublicRoomState> {
  return request<PublicRoomState>(
    `/api/rooms/${encodeURIComponent(roomCode)}`,
    isPublicRoomState,
  );
}
