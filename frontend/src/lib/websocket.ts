export function createRoomSocket(apiOrigin: string, roomCode: string): WebSocket {
  const url = new URL(`/api/ws/rooms/${roomCode}`, apiOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return new WebSocket(url.toString());
}
