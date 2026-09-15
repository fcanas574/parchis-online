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
