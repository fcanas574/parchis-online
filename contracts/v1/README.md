# Parchís Online protocol v1

These JSON Schemas define the versioned, camelCase wire boundary between the authoritative backend and clients. Client commands are `RECONNECT`, `PLAYER_READY`, and `START_GAME`; mutating commands carry a non-empty `requestId` for correlation and safe retry handling.

Server events are envelopes with a room code, monotonically increasing `stateVersion`, unique `eventId`, and server-generated ISO timestamp. Their payloads are:

- `PLAYER_JOINED`: `{ player }`, with the joining public player record.
- `PLAYER_LEFT`: `{ playerId, reservationExpiresAt }`, identifying the disconnected player and the end of their seat reservation.
- `PLAYER_RECONNECTED`: `{ player }`, with the player record after reclaiming their reserved seat.
- `PLAYER_READY`: `{ playerId, ready }`, carrying the player readiness transition.
- `GAME_STARTED`: `{ status: "playing" }`, announcing the lobby-to-game transition.
- `GAME_STATE_SYNC`: `{ room }`, carrying the closed public room snapshot; an empty room object is permitted for the bootstrap fixture.
- `ERROR`: `{ code, message }`, with an optional envelope `requestId` to correlate a rejected command.

Public room state contains `roomCode`, `status`, `maxPlayers`, `hostPlayerId`, `players`, and `stateVersion`. Each public player contains `id`, `displayName`, `color`, `seatIndex`, `isHost`, `isReady`, `isConnected`, and nullable `reservationExpiresAt`. A disconnected player keeps their seat during the reservation window; `PLAYER_LEFT` communicates that expiry to clients. Player tokens are private credentials and never belong in public room state.

The v1 lobby boundary includes join/leave/reconnect/readiness, game-start notification, state sync, and structured errors. Future gameplay commands/events and social features are reserved for later phases and are intentionally not part of this client behavior.

## Guarantees covered by Phase 1

- Room creation accepts a capacity of 4, 5, or 6 players. Public `seatIndex` values are contiguous, and a color can be assigned to only one seat in a room. A join after capacity is reached fails with HTTP 409 and `ROOM_FULL`.
- Every accepted lobby mutation increments `stateVersion` once. Its semantic event and following `GAME_STATE_SYNC` use that same version, and every connected client receives the same public snapshot for that mutation.
- A client must ignore snapshots older than the newest `stateVersion` it has already applied. The frontend store enforces this rule.
- `playerToken` is returned only to the player that creates or joins a room. It is not included in public HTTP room state or WebSocket events; `token_hash` remains backend-only.
- A disconnected seat is reserved for ten minutes. Reconnecting with the original token during that window restores the same player ID, seat, and color. Once the reservation expires, the token can no longer authenticate that seat.
- The Phase 1 WebSocket client commands are only `RECONNECT`, `PLAYER_READY`, and `START_GAME`. Gameplay and social events listed in the product brief are deferred; unsupported commands return a structured `ERROR` without changing room state.

These guarantees are exercised by `backend/tests/test_websocket_flow.py` and `frontend/src/stores/gameStore.test.ts`. The v1 boundary remains intentionally small until the game rules and board arrive in Phase 2.
