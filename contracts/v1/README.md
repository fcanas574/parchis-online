# Parchís Online protocol v1

These schemas define the camelCase WebSocket boundary for lobby and gameplay. The backend is authoritative: clients send intents, never dice outcomes, piece destinations, captures, or turn decisions. Unknown fields are rejected, and every message uses `version: 1`.

## Client commands

`protocol.schema.json` describes the accepted client messages:

- `RECONNECT`: `{ roomCode, playerToken }`. The token is private and is sent only by its owner.
- `PLAYER_READY`: `{ requestId, ready }`.
- `START_GAME`: `{ requestId }`.
- `ROLL_DICE`: `{ requestId }`.
- `MOVE_PIECE`: `{ requestId, pieceId, diceIndices }`. Dice indices are unique values from `0` or `1`; game rules validate whether the requested combination is legal.
- `MOVE_BONUS_PIECE`: `{ requestId, pieceId }`.
- `RETURN_TO_LOBBY`: `{ requestId }`.
- `PLAY_AGAIN`: `{ requestId }`.
- `CHAT_MESSAGE`: `{ requestId, text }`; text is plain text, 1–280 characters.
- `REACTION_SENT`: `{ requestId, reactionId }`; IDs are `laugh`, `cry`, `angry`, `cool`, `shocked`, `heart`, `applause`.
- `GIFT_SENT`: `{ requestId, toPlayerId, giftId }`; the recipient is another seat in the same room. IDs are `rose`, `tomato`, `applause`, `confetti`, `heart`, `fire`.
- `SET_COSMETICS`: `{ requestId, diceSkinId, pieceSkinId }`; all listed skins are free and available.

All commands except `RECONNECT` carry a non-empty `requestId` (maximum 64 characters) for correlation and safe retries. The server authenticates the connection and derives the acting player from it; clients do not choose a player ID for commands.

## Server event envelope

Every event includes `type`, `version`, `roomCode`, `eventId`, `serverTime`, `stateVersion`, and `payload`. `requestId` is included when an event responds to a specific command. `stateVersion` increases with each accepted room/game mutation; clients should ignore an older snapshot after applying a newer version.

`server-events.schema.json` documents these event payloads:

- Lobby: `PLAYER_JOINED { player }`, `PLAYER_LEFT { playerId, reservationExpiresAt }`, `PLAYER_RECONNECTED { player }`, `PLAYER_READY { playerId, ready }`, `GAME_STARTED { status }`.
- Turn flow: `TURN_STARTED { playerId }`, `DICE_ROLLED { playerId, values, availableMoves }`, `PIECE_MOVED { pieceId, from, to, diceIndices }`, `PIECE_CAPTURED { capturedPieceId, byPieceId, bonusSteps }`, `BONUS_GRANTED { playerId, steps, reason }`, `BONUS_SKIPPED { playerId, steps, reason, skipReason }`, `TURN_ENDED { playerId, extraTurn }`.
- Results and recovery: `PLAYER_FINISHED { playerId, rank }`, `GAME_FINISHED { winnerId, finishOrder, placements }`, `GAME_RESET { status, requestedReplay, requesterId }`, `GAME_STATE_SYNC { room, game }`.
- Social: `CHAT_HISTORY_SYNC { messages }` (at most 50); `CHAT_MESSAGE { messageId, playerId, displayName, text, sentAt }`; `REACTION_SENT { playerId, reactionId }`; `GIFT_SENT { fromPlayerId, toPlayerId, giftId }`; `PLAYER_COSMETICS_UPDATED { playerId, diceSkinId, pieceSkinId }`.
- Rejections: `ERROR { code, message }`.

Chat messages are limited to 280 characters and five per player in ten seconds. Reactions are limited to eight per five seconds and gifts to three per ten seconds. Chat and reactions are transient events; the last received gift and selected skins are part of public room state. Cosmetic selections are accepted in the lobby and during play, then frozen after the game finishes. No command accepts a client-supplied sender identity.

`GAME_STATE_SYNC` is the recovery boundary for initial connection and reconnection. `room` always contains the public room snapshot, including nullable `gameState` and `lastGameResult`; `game` is the current public game state or `null`. Public snapshots contain no player tokens or token hashes. Disconnected seats remain reserved during the configured reconnection window and can be reclaimed only with the original player token.

## Public state and rules

The public room record contains `roomCode`, `status`, `maxPlayers`, `hostPlayerId`, `players`, `stateVersion`, `gameState`, and `lastGameResult`. Player records expose identity, display name, color, seat index, host/readiness/connection flags, nullable reservation expiry, selected dice/piece skin IDs, and the last received gift—never authentication credentials.

The public game state carries seat count, player order, current turn number and phase, server-generated dice, the latest dice pair per player, legal move options, pending bonuses, piece positions, finish order, winner/result, and split-plan status. Board geometry is not part of the protocol; clients map logical piece positions to their own SVG layout. Game variants such as bonus steps and safe-cell rules are enforced by the backend.

## MVP guarantees

- Rooms support 4, 5, or 6 seats. The same authoritative game module validates turns, dice, movement, captures, safe cells, finish paths, bonuses, placement, and victory independently of FastAPI/WebSockets.
- Clients send actions as intents; the server validates each action again before changing state and broadcasting semantic events plus a public state sync.
- A dropped connection does not immediately free a seat. Reconnection restores the same player identity and seat during the reservation window.
- This social extension adds free room chat, reactions, gifts, optional local sounds, and cosmetic IDs to protocol v1; it adds no music, purchases, currency, public matchmaking, or persistent statistics.

The schemas are exercised by `backend/tests/test_protocol_schemas.py`; room and WebSocket integration behavior is covered by the backend test suite.
