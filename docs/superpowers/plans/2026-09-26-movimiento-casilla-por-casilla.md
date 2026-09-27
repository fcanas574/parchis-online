# Movimiento casilla por casilla Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar en todos los clientes el recorrido real de cada ficha, sin perder la sincronización autoritativa ni alterar las reglas.

**Architecture:** El motor agrega posiciones lógicas intermedias al evento confirmado `PIECE_MOVED`; el snapshot continúa llegando inmediatamente. El frontend mantiene una presentación efímera en cola, separada del estado del servidor, y proyecta esos pasos sobre el tablero SVG. Reconexión, errores de secuencia y movimiento reducido hacen snap al snapshot.

**Tech Stack:** Python 3.12, pytest, FastAPI/WebSockets, Next.js 15, React 19, TypeScript estricto, Vitest, Testing Library y Framer Motion existente.

**Spec:** `docs/superpowers/specs/2026-09-26-practica-bots-animacion-diseno.md` (secciones 1, 5–8). Ejecutar después del plan `docs/superpowers/plans/2026-09-26-practica-con-bots.md` para compartir fixtures y verificación visual.

## Global Constraints

- `GameRules` decide legalidad y destino; el cliente nunca calcula ni propone un destino por animación.
- `PIECE_MOVED.path` contiene posiciones después del origen y termina exactamente en `to`; movimientos desde casa tienen un solo paso visible.
- El snapshot de la misma versión no cancela la animación; reconexión, cambio de sala o salto de versión sí la cancelan.
- Las rutas se expresan con índices lógicos, independientes de orientación y coordenadas de tableros de 4, 5 y 6.
- Ritmo objetivo 90 ms por casilla, duración total acotada, soporte `prefers-reduced-motion` y cola sin bloquear las reglas.
- Conservar cambios preexistentes del workspace; prefijar comandos shell con `rtk` según `AGENTS.md`.

## Review Focus

- Suma de dos dados que cruza el índice cero: ruta circular completa, destino exacto (Task 1).
- Movimiento que entra al pasillo y llega a meta: ningún paso visual salta directamente de ruta a meta (Task 1).
- Dos eventos de movimiento con la misma versión más snapshot: se reproducen en orden, sin cancelar el primero (Task 3).
- Pestaña suspendida con eventos perdidos o `eventId` repetido: snap seguro, nunca animación duplicada (Task 3).
- Captura seguida de bonus/victoria: la ficha capturada vuelve a casa tras la llegada y el modal espera el fin de la presentación (Task 4).

---

### Task 1: Ruta lógica pura del motor

**Files:** Create `backend/app/game/move_path.py`, `backend/tests/test_move_path.py`.

**Interfaces:** Produces `trace_move(board: BoardDefinition, seat_index: int, origin: PiecePosition, destination: PiecePosition, steps: int) -> tuple[PiecePosition, ...]`. It returns positions after `origin`, ending at `destination`, or raises `ValueError` if the verified move and trace disagree. No SVG coordinates or WebSocket imports.

- [x] Write failing parametrized tests for yard→start (one point), track `10→13` (11, 12, 13), wrap on 68/85/102 cells, entry to finish lane, final `finished` step, and a 20-step bonus; each asserts `path[-1] == destination` and nonempty path.
- [x] Run `rtk uv run --project backend pytest backend/tests/test_move_path.py -q`; expect failure because `trace_move` is absent.
- [x] Implement traversal from `BoardDefinition` start/goal/finish definitions, treating yard exit as a single visible step and checking the final position against `destination`. Keep the function independent of move legality.
- [x] Run the targeted test and `rtk uv run --project backend pytest backend/tests/test_game_rules.py -q`; expect PASS.
- [x] Commit only Task 1 files as `feat: trace logical piece moves`.

### Task 2: Evento autoritativo con `path`

**Files:** Modify `backend/app/game/rules.py`, `backend/app/schemas/websocket.py`, `backend/tests/test_game_rules.py`, `backend/tests/test_websocket_flow.py`.

**Interfaces:** Consumes `trace_move`; every `PIECE_MOVED` payload becomes `{pieceId, from, to, diceIndices, path}`. `make_change_events` and `GAME_STATE_SYNC` retain their existing order/version.

- [ ] Write failing tests for ordinary move, split dice, capture and bonus: every emitted `path` is nonempty, starts after `from`, ends at `to`; WebSocket event validates against `ServerEvent` and precedes same-version snapshot.
- [ ] Run `rtk uv run --project backend pytest backend/tests/test_game_rules.py backend/tests/test_websocket_flow.py -q`; expect the new assertions to fail.
- [ ] Call `trace_move` from `_apply_option` using the player's real seat index; serialize `PiecePosition` points with existing `_public_position`; extend the strict server event schema where necessary.
- [ ] Run targeted tests and `rtk uv run --project backend pytest -q`; expect PASS.
- [ ] Commit only Task 2 files as `feat: publish piece move paths`.

### Task 3: Tipos y estado efímero de presentación

**Files:** Create `frontend/src/lib/piece-presentation.ts`, `frontend/src/lib/piece-presentation.test.ts`; Modify `frontend/src/types/protocol.ts`, `frontend/src/types/protocol.test.ts`, `frontend/src/test/game-fixtures.ts`.

**Interfaces:** Produces `PieceMoveEvent`/`PieceCaptureEvent` aliases from `ServerEvent`, and pure `createPiecePresentation(game: GameState, roomCode: string, stateVersion: number): PiecePresentationState`, `receivePresentationEvent(state: PiecePresentationState, event: ServerEvent): PiecePresentationState`, `advancePresentation(state: PiecePresentationState): PiecePresentationState`, `resetPiecePresentation(game: GameState, roomCode: string, stateVersion: number): PiecePresentationState`. State holds per-piece visual positions, queued movement/capture steps, last version, and seen `eventId`s; no rule validation.

- [ ] Write failing protocol tests for valid `path`, missing/empty path, malformed points and destination mismatch. Write reducer tests for same-version two moves plus sync, duplicate ID, stale event, missed-version gap, room change and reconnect reset.
- [ ] Run `rtk pnpm --dir frontend test --run src/types/protocol.test.ts src/lib/piece-presentation.test.ts`; expect new tests to fail.
- [ ] Extend the strict parser and implement the pure presentation state machine. A normal matching `GAME_STATE_SYNC` updates authority but retains queued steps; initial/reconnect/room-change/gap resets visual state. If a bounded recent-events buffer skipped a version, snap rather than invent a path.
- [ ] Run targeted tests and `rtk pnpm frontend:typecheck`; expect PASS.
- [ ] Commit only Task 3 files as `feat: queue authoritative piece paths`.

### Task 4: Reproducir la cola sobre el tablero

**Files:** Create `frontend/src/hooks/usePiecePresentation.ts`, `frontend/src/hooks/usePiecePresentation.test.tsx`; Modify `frontend/src/app/room/[code]/RoomPageClient.tsx`, `frontend/src/hooks/useGameSocket.ts`, `frontend/src/hooks/useGameSocket.test.ts`, `frontend/src/components/game/GameTable.tsx`, `frontend/src/components/game/Board.tsx`, `frontend/src/components/game/Piece.tsx`, `frontend/src/components/game/VictoryModal.tsx`, `frontend/src/components/game/Board.test.tsx`, `frontend/src/components/game/GameTable.test.tsx`, `frontend/src/app/globals.css`.

**Interfaces:** `usePiecePresentation(game: GameState, roomCode: string, stateVersion: number, viewerPlayerId: string, events: readonly ServerEvent[], connectionState: ConnectionState)` returns `{ visualPieces: Piece[], isAnimating: boolean, isAnimatingOwnMove: boolean }`. `Board` accepts optional `visualPieces`; legal options and click permissions continue to use authoritative `game`.

- [ ] Write failing fake-timer hook tests: a 3-step path visits each point at approximately 90 ms; long paths finish within 1600 ms; same-version sync does not interrupt; reconnect and `prefers-reduced-motion` snap to destination; two rapid events queue rather than overlap.
- [ ] Write failing board/table tests: the active piece uses visual rather than snapshot coordinates during animation, capture returns home after the attacking piece arrives, goal gets a brief accent, local second click is disabled while its move animates, victory overlay waits until presentation drains, and a bot's movement animates on the observer's client.
- [ ] Write a failing socket test where a `PIECE_MOVED` with malformed `path` closes the connection and rehandshakes for a full snapshot instead of rendering an invented route.
- [ ] Run `rtk pnpm --dir frontend test --run src/hooks/usePiecePresentation.test.tsx src/hooks/useGameSocket.test.ts src/components/game/Board.test.tsx src/components/game/GameTable.test.tsx`; expect new tests to fail.
- [ ] Use timers in `usePiecePresentation` to advance the pure queue; project `visualPieces` with existing `projectPiece` and board rotation. Keep the authoritative `game` unchanged, pause only local controls, and show modal after queue drain. Reconnect on invalid-path messages; add capture/goal visual accents without heavy effects.
- [ ] Run targeted tests, `rtk pnpm frontend:typecheck`, and `rtk pnpm frontend:build`; expect PASS.
- [ ] Commit only Task 4 files as `feat: animate piece traversal`.

### Task 5: End-to-end y experiencia visual

**Files:** Modify `backend/tests/test_websocket_flow.py`, `frontend/src/components/game/GameTable.test.tsx`, `README.md` only if a gap is found in end-to-end coverage or usage notes.

**Interfaces:** No new API. Verifies both practice and friend rooms consume the same `PIECE_MOVED.path` and retain current game rules.

- [ ] Add a backend regression test for a confirmed move sent to two sockets, each followed by the same authoritative snapshot and identical logical path.
- [ ] Add a frontend board test that the shared logical path projects correctly for two viewer orientations.
- [ ] Run `rtk pnpm backend:test`, `rtk pnpm frontend:test`, `rtk pnpm frontend:typecheck`, and `rtk pnpm frontend:build`; expect PASS.
- [ ] Inspect a real practice round and a friend-room round at desktop and phone viewports, including the 5-player board, capture and reconnect. Fix only concrete regressions found and rerun affected tests.
- [ ] Commit any Task 5 fixes with exact file paths; if none, record the verification outcome without an empty commit.

**Handoff:** Implementation is complete only when both plan suites pass and the actual browser shows stepwise movement rather than a single layout transition.
