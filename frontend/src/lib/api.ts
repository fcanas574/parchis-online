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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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

  return (await response.json()) as T;
}

const isApiErrorPayload = (value: unknown): value is ApiErrorPayload => {
  if (typeof value !== "object" || value === null) return false;
  const error = value as Record<string, unknown>;
  return typeof error.code === "string" && typeof error.message === "string";
};

const jsonRequest = (payload: object): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

export function createRoom(payload: CreateRoomPayload): Promise<RoomCredentials> {
  return request<RoomCredentials>("/api/rooms", jsonRequest(payload));
}

export function joinRoom(
  roomCode: string,
  payload: JoinRoomPayload,
): Promise<RoomCredentials> {
  return request<RoomCredentials>(`/api/rooms/${encodeURIComponent(roomCode)}/join`, jsonRequest(payload));
}

export function getRoom(roomCode: string): Promise<PublicRoomState> {
  return request<PublicRoomState>(`/api/rooms/${encodeURIComponent(roomCode)}`);
}
