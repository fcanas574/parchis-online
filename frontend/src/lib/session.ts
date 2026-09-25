export type RoomSession = {
  roomCode: string;
  playerId: string;
  playerToken: string;
  isHost: boolean;
};

const sessionKey = (roomCode: string) => `parchis:session:v1:${roomCode}`;

const isRoomSession = (value: unknown): value is RoomSession => {
  if (typeof value !== "object" || value === null) return false;

  const session = value as Record<string, unknown>;
  return (
    typeof session.roomCode === "string" &&
    typeof session.playerId === "string" &&
    typeof session.playerToken === "string" &&
    typeof session.isHost === "boolean"
  );
};

export function saveSession(session: RoomSession): void {
  if (typeof window === "undefined") return;
  const { roomCode, playerId, playerToken, isHost } = session;
  window.localStorage.setItem(
    sessionKey(roomCode),
    JSON.stringify({ roomCode, playerId, playerToken, isHost }),
  );
}

export function readSession(roomCode: string): RoomSession | null {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(sessionKey(roomCode));
  if (!raw) return null;

  try {
    const session: unknown = JSON.parse(raw);
    if (!isRoomSession(session) || session.roomCode !== roomCode) {
      window.localStorage.removeItem(sessionKey(roomCode));
      return null;
    }
    return session;
  } catch {
    window.localStorage.removeItem(sessionKey(roomCode));
    return null;
  }
}

export function clearSession(roomCode: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(sessionKey(roomCode));
}
