# Parchís Online protocol v1

These JSON Schemas define the versioned, camelCase wire boundary between the authoritative backend and clients. Client commands are `RECONNECT`, `PLAYER_READY`, and `START_GAME`; mutating commands carry a non-empty `requestId` for correlation and safe retry handling.

Server events are envelopes with a room code, monotonically increasing `stateVersion`, unique `eventId`, and server-generated ISO timestamp. Public room state contains player identity, seat, color, readiness, connection, and reservation expiry. A disconnected player keeps their seat during the reservation window; `PLAYER_LEFT` communicates that expiry to clients. Player tokens are private credentials and never belong in public room state.

The v1 lobby boundary includes join/leave/reconnect/readiness, game-start notification, state sync, and structured errors. Future gameplay commands/events and social features are reserved for later phases and are intentionally not part of this client behavior.
