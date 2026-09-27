# Práctica con bots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que una persona pruebe partidas reales de 4, 5 o 6 asientos contra bots, sin alterar el inicio ni el menú principal de las partidas entre amigos.

**Architecture:** Una sala `practice` conserva el motor de juego, WebSockets y snapshots actuales, pero se crea ya iniciada con un humano y los demás asientos controlados por el autopiloto del servidor. La entrada está escondida tras cinco activaciones del emblema; no es una barrera de seguridad. El modo se marca explícitamente en el estado público para que UI, replay y autenticación puedan diferenciarlo.

**Tech Stack:** Python 3.12, FastAPI, pytest, Next.js 15, React 19, TypeScript estricto, Vitest, Testing Library, Framer Motion existente.

**Spec:** `docs/superpowers/specs/2026-09-26-practica-bots-animacion-diseno.md` (secciones 1–4, 6–8).

## Global Constraints

- Salas de amigos: 4, 5 o 6 humanos, todos conectados y listos antes de empezar; ningún bot en ese flujo.
- Práctica: exactamente un humano anfitrión y `maxPlayers - 1` bots; sin invitaciones ni token emitido para bots.
- Servidor autoritativo para tiradas y movimientos; clientes envían intenciones, nunca identidades de bot.
- `POST /api/practice` usa el mismo límite de creación por IP; `PRACTICE_MODE_ENABLED` está activo por defecto y puede desactivarse.
- Conservar cambios preexistentes del workspace; no resetear ni sobrescribir trabajo ajeno. Prefijar comandos shell con `rtk` según `AGENTS.md`.

## Review Focus

- Dos prácticas creadas en paralelo: ambas reciben códigos distintos o reintentan la colisión atómica (Task 1).
- Un nombre inválido o color inexistente en la API: respuesta de validación, ninguna sala parcial (Task 2).
- Intento de autenticarse como bot mediante token adivinado: rechazo explícito, sin WebSocket (Task 1).
- Bot activo al reconectar el anfitrión: una sola tarea de autopiloto y ningún turno humano robado (Task 3).
- Cinco toques lentos o toques sobre el logo en StrictMode: no abren práctica accidentalmente ni navegan dos veces (Task 5).

---

### Task 1: Modelo y creación autoritativa de práctica

**Files:** Modify `backend/app/game/models.py`, `backend/app/services/room_manager.py`, `backend/app/schemas/websocket.py`; Test `backend/tests/test_room_manager.py`, `backend/tests/test_websocket_flow.py`.

**Interfaces:** Produces `RoomManager.create_practice_room(display_name: str, player_count: PlayerCount, color: PlayerColor | None) -> RoomCredentialData`; `RoomState.mode: Literal["friends", "practice"]`; `PlayerState.is_bot: bool`; public `mode` and `players[].isBot`. Existing `create_room` keeps `friends` as default.

- [x] Write failing `test_create_practice_room_fills_seats_and_starts_game` parametrized for 4/5/6: `len(room.players) == count`, exactly one non-bot, contiguous seats, unique colors, bots disconnected without reservation, `room.status == "playing"`, `game_state.player_order` includes every seat, host token authenticates; strict `ServerEvent` validation accepts the new public room/player fields.
- [x] Write failing `test_practice_rejects_join_and_bot_identity` and `test_practice_code_collision_retries_atomically`: join raises `ROOM_NOT_JOINABLE`; a bot identity/token cannot authenticate or mutate; two creations with a forced code collision produce distinct rooms.
- [x] Run `rtk uv run --project backend pytest backend/tests/test_room_manager.py backend/tests/test_websocket_flow.py -q`; expect new tests to fail before implementation.
- [x] Implement the model defaults, service operation, public snapshot and strict schema keys, explicit bot-auth rejection, and practice join rejection. Use the existing code/token generators and repository lock; a bot stores a random, non-issued token hash.
- [x] Run the same test command; expect PASS.
- [x] Commit only the five Task 1 files listed above as `feat: create isolated practice rooms`.

### Task 2: API de práctica y configuración

**Files:** Create `backend/app/api/practice.py`; Modify `backend/app/main.py`, `backend/app/config.py`, `backend/tests/test_rooms_api.py`, `README.md`.

**Interfaces:** Consumes `RoomManager.create_practice_room`. Produces `POST /api/practice` with body `CreateRoomRequest` (`displayName`, `playerCount`, optional `color`) and response `RoomCredentials`; `Settings.practice_mode_enabled: bool = True` mapped from `PRACTICE_MODE_ENABLED`.

- [x] Write failing API tests: valid request returns 201 plus human credentials and an already-playing snapshot; invalid name/color/count returns 422 without a room; disabled setting returns `PRACTICE_DISABLED`; rate limit applies to practice as to room creation.
- [x] Run `rtk uv run --project backend pytest backend/tests/test_rooms_api.py -q`; expect new tests to fail.
- [x] Add practice router using `get_room_manager` and `get_room_rate_limiter`, include it in `main.py`, and document `PRACTICE_MODE_ENABLED=false` for public deployments in `README.md`.
- [x] Run the API tests and `rtk uv run --project backend pytest backend/tests/test_room_manager.py -q`; expect PASS.
- [x] Commit only Task 2 files as `feat: expose practice room creation`.

### Task 3: Autopiloto de bots y replay

**Files:** Modify `backend/app/services/room_manager.py`, `backend/app/api/websocket.py`, `backend/tests/test_autoplayer.py`, `backend/tests/test_websocket_flow.py`, `backend/tests/test_room_manager.py`.

**Interfaces:** Consumes `PlayerState.is_bot` and `RoomState.mode`. `RoomManager.run_autopilot_step(room_code: str) -> RoomChange | None` acts for a bot or disconnected human, never for a connected human. `play_again` restarts practice immediately but retains friend-room lobby behavior.

- [x] Write failing tests for bot dice/move/bonus staying within `GameRules.available_moves`, immediate practice replay preserving roster, friend replay still requiring lobby readiness, and worker recheck after a 500 ms bot delay outside the publication lock.
- [x] Write a WebSocket test that reconnects the host while a bot is active: ordered versioned events, no duplicate worker, no private bot credentials in events, and stop when the turn reaches the host.
- [x] Run `rtk uv run --project backend pytest backend/tests/test_autoplayer.py backend/tests/test_websocket_flow.py backend/tests/test_room_manager.py -q`; expect the new tests to fail.
- [x] Reuse `AutopilotPolicy`; schedule the existing per-room worker after actions and bot-turn reconnection, delay bot steps only outside `serialize(room_code)`, revalidate under lock, and branch replay by `mode`.
- [x] Run the targeted tests and `rtk uv run --project backend pytest -q`; expect PASS.
- [x] Commit only Task 3 files as `feat: run practice bots and replay`.

### Task 4: Contrato y cliente HTTP de práctica

**Files:** Modify `frontend/src/types/game.ts`, `frontend/src/types/protocol.ts`, `frontend/src/test/game-fixtures.ts`, `frontend/src/lib/api.ts`, `frontend/src/types/protocol.test.ts`, `frontend/src/lib/api.test.ts`.

**Interfaces:** Produces `CreatePracticePayload = CreateRoomPayload`, `createPracticeRoom(payload: CreatePracticePayload): Promise<RoomCredentials>`, `PublicRoomState.mode`, `PublicPlayer.isBot`; all strict snapshot validators recognize both modes.

- [x] Write failing tests that parse both practice/friend snapshots with exact `mode`/`isBot`, reject missing or malformed fields, and verify `createPracticeRoom` posts to `/api/practice` and validates credentials/errors.
- [x] Run `rtk pnpm --dir frontend test --run src/types/protocol.test.ts src/lib/api.test.ts`; expect new tests to fail.
- [x] Add types and validators, update fixture defaults to `friends`/`false`, and implement the HTTP wrapper without changing `createRoom` or `joinRoom`.
- [x] Run the targeted tests and `rtk pnpm frontend:typecheck`; expect PASS.
- [x] Commit only Task 4 files as `feat: type practice room client`.

### Task 5: Entrada discreta y pantalla de práctica

**Files:** Create `frontend/src/app/practice/page.tsx`, `frontend/src/components/practice/PracticePage.tsx`, `frontend/src/components/practice/PracticePage.test.tsx`; Modify `frontend/src/components/home/LandingPage.tsx`, `frontend/src/components/home/LandingPage.test.tsx`, `frontend/src/app/globals.css`.

**Interfaces:** Consumes `createPracticeRoom` and `saveSession`; navigates to `/room/{code}`. Five emblema activations within 2 seconds navigate once to `/practice`; mouse, touch, Enter and Space work through a real button.

- [x] Write failing tests: four activations do nothing; the fifth rapid activation navigates; five separated by more than 2 seconds do nothing; StrictMode cannot navigate twice; normal create/join controls stay unchanged; practice form saves credentials and navigates; a disabled-API error remains visible without saving a session.
- [x] Run `rtk pnpm --dir frontend test --run src/components/home/LandingPage.test.tsx src/components/practice/PracticePage.test.tsx`; expect new tests to fail.
- [x] Implement the discreet emblem-button behavior and a small practice form reusing existing field/UI styles; keep the main CTA order and visual prominence.
- [x] Run targeted tests, `rtk pnpm frontend:typecheck`, and `rtk pnpm frontend:build`; expect PASS.
- [x] Commit only Task 5 files as `feat: add discreet practice entry`.

### Task 6: Asientos, resultado y verificación completa

**Files:** Modify `frontend/src/components/game/GameTable.tsx`, `frontend/src/components/game/GameTable.test.tsx`, `frontend/src/components/game/VictoryModal.tsx`, `frontend/src/app/room/[code]/RoomPageClient.tsx`, `frontend/src/app/globals.css`.

**Interfaces:** Consumes public `mode`/`isBot`; practice UI labels bots, marks the table as «Práctica», offers «Jugar de nuevo» (same WebSocket command) and «Salir» (home link) without returning to a friend lobby. Friend UI is unchanged.

- [ ] Write failing tests: bots say «Bot» rather than «Automático/desconectado»; practice winner/replay/exit have correct actions; friend results still show «Volver al lobby»; room without a saved practice session cannot join.
- [ ] Run `rtk pnpm --dir frontend test --run src/components/game/GameTable.test.tsx`; expect new tests to fail.
- [ ] Implement mode-specific copy/actions and preserve the board layout. If `/room/{code}` is a practice room without a saved credential, show a private-practice message rather than the join form.
- [ ] Run `rtk pnpm frontend:test`, `rtk pnpm frontend:typecheck`, `rtk pnpm frontend:build`, and `rtk pnpm backend:test`; expect PASS.
- [ ] Visually inspect 4-, 5- and 6-seat practice on desktop and a phone viewport.
- [ ] Commit only Task 6 files as `feat: label practice seats and replay`.

**Handoff:** This plan ships usable practice independently. The companion animation plan is `docs/superpowers/plans/2026-09-26-movimiento-casilla-por-casilla.md`.
