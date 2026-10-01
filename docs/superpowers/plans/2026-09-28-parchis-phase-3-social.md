# Parchís Online Fase 3 — Social y personalización Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir a las salas privadas chat, reacciones, regalos gratuitos, skins, sonido opcional y una presentación compacta de jugadores/dados sin alterar las reglas autoritativas de Parchís.

**Architecture:** Extender los modelos públicos y el protocolo WebSocket v1 existentes. `RoomManager` valida y coordina acciones sociales bajo el lock por sala; los eventos efímeros se transmiten sin snapshot de juego, mientras regalos/cosméticos actualizan estado público recuperable. El frontend mantiene el snapshot del servidor, preferencias locales y eventos visuales separados, con componentes sociales plegables alrededor del tablero.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pytest; Next.js 15, React 19, TypeScript estricto, Zustand, Tailwind CSS, Framer Motion, Vitest/Testing Library, SVG y Web Audio API existentes en navegador. Sin nuevos servicios externos ni dependencias de pago.

**Spec:** `docs/superpowers/specs/2026-09-27-parchis-online-phase-3-social-design.md`

## Global Constraints

- “Chat, reacciones y regalos se habilitan durante una partida activa. La selección de skins está disponible en el lobby y durante la partida; se congela al terminarla y se conserva para la siguiente repetición.”
- “El chat conserva los 50 mensajes más recientes de la sala para recuperación durante una reconexión. Límite de 280 caracteres y cinco mensajes por jugador cada diez segundos.”
- “Límite: ocho reacciones por jugador cada cinco segundos.”
- “Límite: tres regalos enviados por jugador cada diez segundos.”
- “El evento `GIFT_SENT` activa una animación corta (aprox. 700 ms) del emoji desde el asiento emisor al receptor.”
- “Cuando llega `DICE_ROLLED`, los clientes animan brevemente el par de dados en la zona del jugador correspondiente (aprox. 500–700 ms), y luego muestran exactamente los dos valores del servidor.”
- “Incluir cuatro estilos gratuitos iniciales para dados y cuatro para fichas —clásico y tres variantes en cada categoría—, sin monedas, tienda, compras ni desbloqueos.”
- “No hay música ni carga de audio remoto.”
- “En un viewport móvil habitual de 390 × 844, el tablero, los jugadores y los controles esenciales caben sin scroll vertical del documento.”
- No mover validación de jugadas desde `backend/app/game/rules.py`; no añadir cuentas, PostgreSQL/Redis, pagos, monedas, tienda, publicidad, chat privado, ranking público ni matchmaking.

## Review Focus

1. Un comando social intenta suplantar al emisor, usar una sala/destinatario inválido o actuar fuera de una partida activa; el backend debe rechazarlo sin mutar sala. Test dueño: Task 3, `test_social_commands_use_authenticated_identity_and_reject_invalid_targets_without_mutation`.
2. Un jugador excede cualquiera de los tres límites de frecuencia y reintenta con el mismo `requestId`; no debe duplicarse el contenido ni consumirse/alterarse estado parcialmente. Tests dueños: Task 3, `test_chat_rate_limit_rejects_sixth_message_in_ten_seconds`, `test_reaction_rate_limit_rejects_ninth_reaction_in_five_seconds`, `test_gift_rate_limit_rejects_fourth_gift_in_ten_seconds`.
3. Un mensaje llega justo durante el handshake de reconexión; el historial y el evento en vivo no deben perder ni duplicar mensajes por `messageId`. Tests dueños: Tasks 3–4, `test_reconnect_sends_snapshot_then_recent_chat_without_race` y `test_chat_history_and_live_events_dedupe_by_message_id`.
4. Un snapshot contiene el último regalo o tirada, pero no el evento efímero original; la UI debe mostrar el estado persistido sin volver a animarlo. Tests dueños: Tasks 4 y 7, `test_sync_hydrates_social_state_without_replaying_transient_events` y `test_reconnect_shows_last_roll_without_animation`.
5. Seis asientos y nombres largos no deben omitir jugadores ni ocultar controles; el chat se pliega y el scroll natural queda para viewports cortos/zoom. Test dueño: Task 7, `test_six_player_table_renders_all_seats_and_controls`; el solapamiento real se verifica en navegador en Task 8.

## Mapa de archivos y responsabilidades

### Backend

- `backend/app/game/models.py`: ampliar `GameState`, `PlayerState`, `RoomState` y `RoomChange` con los datos públicos/sociales mínimos; `GameRules` sigue aislado de servicios.
- `backend/app/game/rules.py`: guardar el resultado más reciente por jugador/turno en el estado de juego.
- `backend/app/schemas/websocket.py`: comandos y payloads Pydantic estrictos, catálogo y campos públicos.
- `backend/app/services/social_policy.py` (nuevo): catálogo permitido y normalización pura de texto.
- `backend/app/services/room_manager.py`: validar identidad, sala, estado y límites; mutar únicamente buffer/chat, regalo y cosméticos.
- `backend/app/services/command_router.py`, `backend/app/realtime/events.py`, `backend/app/api/websocket.py`: despacho, fanout efímero, sincronización de historial y snapshot.
- `contracts/v1/protocol.schema.json`, `contracts/v1/server-events.schema.json`, `contracts/v1/README.md`: contrato versionado.
- Tests backend: `test_game_rules.py`, `test_room_manager.py`, `test_protocol_schemas.py`, `test_websocket_flow.py` y un nuevo `test_social_policy.py`.

### Frontend

- `frontend/src/types/game.ts`, `types/protocol.ts`: estado y mensajes discriminados; `protocol.ts` valida claves exactas y catálogo.
- `frontend/src/stores/gameStore.ts`, `hooks/useGameSocket.ts`, `test/game-fixtures.ts`: snapshot autoritativo, mensajes recientes, acciones y cola de eventos efímeros.
- `frontend/src/components/social/ChatPanel.tsx`, `ReactionBar.tsx`, `GiftMenu.tsx`, `SocialEffectsLayer.tsx` (nuevos): controles sociales y animaciones no bloqueantes.
- `frontend/src/lib/player-preferences.ts`, `lib/audio.ts` (nuevos), `components/game/GameSettings.tsx` (nuevo): preferencias locales, audio y skins gratuitas.
- `frontend/src/components/game/GameTable.tsx`, `Dice.tsx`, `Piece.tsx`, `app/room/[code]/RoomPageClient.tsx`, `app/globals.css`: asientos, dados por jugador, integración y layout responsive; se conserva la rotación SVG existente.
- UX y documentación: `DESIGN.md`, `UX-CONTRACT.md`, `README.md`.

## Interfaces compartidas

Las tareas posteriores consumen estas formas camelCase en la red y snake_case en los modelos Python:

```python
async RoomManager.send_chat_message(session: AuthenticatedSession | SessionIdentity, request_id: str, text: str) -> RoomChange
async RoomManager.send_reaction(session: AuthenticatedSession | SessionIdentity, request_id: str, reaction_id: ReactionId) -> RoomChange
async RoomManager.send_gift(session: AuthenticatedSession | SessionIdentity, request_id: str, recipient_id: str, gift_id: GiftId) -> RoomChange
async RoomManager.set_cosmetics(session: AuthenticatedSession | SessionIdentity, request_id: str, dice_skin_id: DiceSkinId, piece_skin_id: PieceSkinId) -> RoomChange
async RoomManager.recent_chat_history(session: AuthenticatedSession | SessionIdentity) -> list[dict[str, object]]
```

```ts
type DiceSkinId = "classic" | "brass" | "jade" | "midnight";
type PieceSkinId = "classic" | "porcelain" | "walnut" | "glow";
type GiftId = "rose" | "tomato" | "applause" | "confetti" | "heart" | "fire";
type ReactionId = "laugh" | "cry" | "angry" | "cool" | "shocked" | "heart" | "applause";
type PlayerLastRoll = { values: [number, number]; turnNumber: number };
type DiceRolledEvent = Extract<ServerEvent, { type: "DICE_ROLLED" }>;
type GameSoundCue = "dice_roll" | "piece_move" | "capture" | "goal" | "gift";
type ReactionSoundCue = ReactionId;
type ChatMessage = { messageId: string; playerId: string; displayName: string; text: string; sentAt: string };
type PlayerPreferences = {
  diceSkinId: DiceSkinId;
  pieceSkinId: PieceSkinId;
  gameEffectsEnabled: boolean;
  reactionSoundsEnabled: boolean;
};
type ClientSocialCommand =
  | { type: "CHAT_MESSAGE"; version: 1; requestId: string; text: string }
  | { type: "REACTION_SENT"; version: 1; requestId: string; reactionId: ReactionId }
  | { type: "GIFT_SENT"; version: 1; requestId: string; toPlayerId: string; giftId: GiftId }
  | { type: "SET_COSMETICS"; version: 1; requestId: string; diceSkinId: DiceSkinId; pieceSkinId: PieceSkinId };
```

`SocialChatMessage` es un dataclass inmutable con `message_id: str`, `player_id: str`, `display_name: str`, `text: str` y `sent_at: datetime`; `RoomState.chat_messages` es una lista FIFO limitada a 50. `RoomChange` gana `include_state_sync: bool = True`; chat y reacciones son eventos transitorios sin snapshot completo, y regalo/cosméticos conservan el lote versionado existente. `GAME_STATE_SYNC` contiene `lastRollsByPlayerId`, `diceSkinId`, `pieceSkinId` y `lastReceivedGiftId`. El evento `CHAT_HISTORY_SYNC` devuelve como máximo 50 mensajes.

---

## Task 1: Estado público, cosméticos y última tirada por asiento

**Files:**
- Modify: `backend/app/game/models.py`
- Modify: `backend/app/game/rules.py`
- Modify: `backend/app/schemas/websocket.py`
- Modify: `backend/app/services/room_manager.py`
- Test: `backend/tests/test_game_rules.py`
- Test: `backend/tests/test_domain_models.py`
- Test: `backend/tests/test_room_manager.py`
- Test: `backend/tests/test_protocol_schemas.py`

**Interfaces:**
- Consumes: `GameRules.new_game`, `roll_dice`, `RoomManager.public_room_from_state` y modelos de la Fase 2.
- Produces: `PlayerLastRoll(values: tuple[int, int], turn_number: int)`, `GameState.turn_number`, `GameState.last_rolls_by_player_id`, `PlayerState.dice_skin_id`, `piece_skin_id`, `last_received_gift_id`; estado camelCase equivalente validado por Pydantic.

- [x] **Step 1: Escribir pruebas de última tirada y estado público inicial**

Añadir `test_roll_dice_records_latest_values_for_player_and_turn`: inyectar `(2, 5)`, tirar para `p1` y comprobar `values == (2, 5)` y `turn_number == 1`. Añadir `test_each_player_keeps_own_last_roll_until_their_next_roll`: guardar una tirada de `p1`, avanzar a `p2`, tirar `(4, 4)` y comprobar que ambos pares siguen asociados a su jugador. Añadir `test_public_player_defaults_to_classic_skins_and_no_received_gift`: snapshot serializado contiene IDs clásicos y `lastReceivedGiftId is None`, sin `tokenHash`/token. Añadir `test_turn_number_advances_when_double_starts_extra_turn`.

- [x] **Step 2: Ejecutar las pruebas y confirmar que fallan**

Run: `rtk uv run --project backend pytest backend/tests/test_game_rules.py backend/tests/test_domain_models.py backend/tests/test_room_manager.py backend/tests/test_protocol_schemas.py -q`
Expected: FAIL porque los modelos y el snapshot aún no exponen esos campos.

- [x] **Step 3: Implementar los campos y su serialización**

Inicializar `turn_number=1` y mapa vacío al crear partida. En `GameRules.roll_dice`, guardar el par autoritativo para el jugador y el turno actual. Incrementar el número cuando `_close_turn` inicia otro turno, incluido el turno extra por dobles. Añadir defaults clásicos y regalo nulo a los asientos; ampliar el serializer público y los modelos Pydantic sin exponer credenciales.

- [x] **Step 4: Ejecutar las pruebas de dominio y contrato**

Run: `rtk uv run --project backend pytest backend/tests/test_game_rules.py backend/tests/test_domain_models.py backend/tests/test_room_manager.py backend/tests/test_protocol_schemas.py -q`
Expected: PASS; las reglas y tests de gameplay existentes permanecen sin cambios de comportamiento.

## Task 2: Contrato WebSocket v1 para la capa social

**Files:**
- Modify: `backend/app/schemas/websocket.py`
- Modify: `contracts/v1/protocol.schema.json`
- Modify: `contracts/v1/server-events.schema.json`
- Modify: `contracts/v1/README.md`
- Test: `backend/tests/test_protocol_schemas.py`

**Interfaces:**
- Consumes: modelos públicos del Task 1 y sobre actual (`version`, `roomCode`, `eventId`, `serverTime`, `stateVersion`, `requestId`).
- Produces: comandos `CHAT_MESSAGE`, `REACTION_SENT`, `GIFT_SENT`, `SET_COSMETICS`; eventos `CHAT_HISTORY_SYNC`, `CHAT_MESSAGE`, `REACTION_SENT`, `GIFT_SENT`, `PLAYER_COSMETICS_UPDATED`; `ChatMessage` con `messageId`, `playerId`, `displayName`, `text`, `sentAt`.

- [x] **Step 1: Añadir pruebas de esquemas válidos, límites e IDs cerrados**

En `test_protocol_schemas.py`, validar un ejemplo correcto por comando; rechazar campos extra, texto de 281 caracteres, ID de reacción/regalo/skin desconocido, historial con más de 50 elementos, destinatario vacío y `requestId` inválido. Verificar que los eventos nuevos se validen mediante la unión discriminada `ServerEvent`.

- [x] **Step 2: Ejecutar pruebas y confirmar fallo**

Run: `rtk uv run --project backend pytest backend/tests/test_protocol_schemas.py -q`
Expected: FAIL con tipos/eventos no reconocidos.

- [x] **Step 3: Añadir modelos Pydantic estrictos y JSON Schema**

Definir IDs como `Literal`, `text` de máximo 280 caracteres, historial de máximo 50 y destinatario como string no vacío. Mantener `extra="forbid"` y el `requestId` de 1–64 caracteres. Documentar qué comando inicia cada evento y cuáles alteran estado versionado.

- [x] **Step 4: Validar el contrato backend y JSON Schema**

Run: `rtk uv run --project backend pytest backend/tests/test_protocol_schemas.py -q`
Expected: PASS para payloads válidos e inválidos, y ambos JSON Schema pasan las validaciones existentes.

## Task 3: Validación, límites y fanout social del backend

**Files:**
- Create: `backend/app/services/social_policy.py`
- Test: `backend/tests/test_social_policy.py`
- Modify: `backend/app/game/models.py`
- Modify: `backend/app/services/room_manager.py`
- Modify: `backend/app/services/command_router.py`
- Modify: `backend/app/realtime/events.py`
- Modify: `backend/app/api/websocket.py`
- Test: `backend/tests/test_room_manager.py`
- Test: `backend/tests/test_websocket_flow.py`

**Interfaces:**
- Consumes: comandos/esquemas del Task 2 y `FixedWindowRateLimiter` existente en `backend/app/security/rate_limit.py`.
- Produces: las cinco firmas `RoomManager` de “Interfaces compartidas”; `SocialChatMessage(message_id: str, player_id: str, display_name: str, text: str, sent_at: datetime)`; `RoomState.chat_messages` acotado a 50; `RoomChange.include_state_sync`.

- [x] **Step 1: Escribir pruebas fallidas para política y mutaciones**

Añadir pruebas de normalización de texto plano (recorta extremos, elimina caracteres de control, conserva letras y emojis), buffer FIFO de 50, chat/reacciones solo en partida, skins únicamente en lobby/partida, regalo a otro asiento, auto-regalo inválido, catálogo inválido y ausencia de mutación al rechazar. Añadir exactamente `test_chat_rate_limit_rejects_sixth_message_in_ten_seconds`, `test_reaction_rate_limit_rejects_ninth_reaction_in_five_seconds` y `test_gift_rate_limit_rejects_fourth_gift_in_ten_seconds`. Comprobar que el emisor siempre se obtiene de `SessionIdentity`.

- [x] **Step 2: Ejecutar los tests específicos y comprobar fallo**

Run: `rtk uv run --project backend pytest backend/tests/test_social_policy.py backend/tests/test_room_manager.py -q`
Expected: FAIL porque aún no existen las operaciones sociales ni el buffer.

- [x] **Step 3: Implementar la política pura y operaciones de sala**

`social_policy.py` define catálogos permitidos y `normalize_chat_text(text: str) -> str`. `RoomManager` valida sala/jugador conectado/estado antes de aceptar comandos y usa limitadores con clave `{roomCode}:{playerId}` y reloj inyectable. Chat se guarda con timestamp del servidor, se recorta a los últimos 50 y conserva idempotencia por `requestId`; reacciones no mutan estado público. Un regalo actualiza el `last_received_gift_id` del destinatario; `set_cosmetics` actualiza solo al jugador autenticado. Persistir cambios mediante el repositorio de sala.

- [x] **Step 4: Implementar publicación transitoria y recuperación de historial**

En `make_change_events`, omitir `GAME_STATE_SYNC` solo cuando `include_state_sync` sea falso. Publicar chat/reacción como evento con la versión actual, sin snapshot; regalos y cosméticos incrementan versión y conservan evento más snapshot. Tras autenticación y envío de `GAME_STATE_SYNC` o del lote de presencia, enviar `CHAT_HISTORY_SYNC` bajo el mismo `RoomPublicationCoordinator.serialize(room_code)` para eliminar la carrera con mensajes nuevos.

- [x] **Step 5: Despachar comandos y ejecutar pruebas de integración**

`CommandRouter.handle` llama las operaciones con `CommandContext.identity`; errores vuelven como `ERROR` correlacionado y no se difunden a otros jugadores. Añadir `test_reconnect_sends_snapshot_then_recent_chat_without_race`, `test_transient_chat_and_reaction_do_not_emit_game_state_sync`, `test_gift_updates_recipient_and_broadcasts_snapshot`, `test_social_commands_use_authenticated_identity_and_reject_invalid_targets_without_mutation` y pruebas de los tres límites.

Run: `rtk uv run --project backend pytest backend/tests/test_social_policy.py backend/tests/test_room_manager.py backend/tests/test_websocket_flow.py backend/tests/test_protocol_schemas.py -q`
Expected: PASS; las salas antiguas mantienen sus snapshots/eventos existentes.

## Task 4: Tipos, validación de eventos, store y acciones cliente

**Files:**
- Modify: `frontend/src/types/game.ts`
- Modify: `frontend/src/types/protocol.ts`
- Modify: `frontend/src/types/protocol.test.ts`
- Modify: `frontend/src/stores/gameStore.ts`
- Modify: `frontend/src/stores/gameStore.test.ts`
- Modify: `frontend/src/hooks/useGameSocket.ts`
- Modify: `frontend/src/hooks/useGameSocket.test.ts`
- Modify: `frontend/src/test/game-fixtures.ts`

**Interfaces:**
- Consumes: contrato backend del Task 2 y envelopes de eventos v1.
- Produces: `DiceSkinId`, `PieceSkinId`, `GiftId`, `ReactionId`, `PlayerLastRoll`, `ChatMessage`; `sendChatMessage(text)`, `sendReaction(reactionId)`, `sendGift(toPlayerId, giftId)`, `setCosmetics(diceSkinId, pieceSkinId)`.

- [x] **Step 1: Escribir pruebas fallidas de guardas, comandos y store**

Probar cada evento/comando válido e ID desconocido, claves inesperadas y chat con longitud excesiva. Probar que `CHAT_HISTORY_SYNC` reemplaza la lista, `CHAT_MESSAGE` añade por `messageId` sin duplicar y conserva como máximo 50, `GAME_STATE_SYNC` hidrata sala, cosméticos, regalo y últimas tiradas sin animaciones (`test_sync_hydrates_social_state_without_replaying_transient_events`), y cada acción genera `requestId` con `version: 1`. Añadir `test_chat_history_and_live_events_dedupe_by_message_id` para el orden de llegada mixto.

- [x] **Step 2: Ejecutar las pruebas objetivo y confirmar fallo**

Run: `rtk pnpm --dir frontend test --run src/types/protocol.test.ts src/stores/gameStore.test.ts src/hooks/useGameSocket.test.ts`
Expected: FAIL por tipos y eventos aún inexistentes.

- [x] **Step 3: Extender tipos, guardas, store y hook**

Actualizar validadores exactos (`hasExactKeys`) para todos los payloads, incluidos valores de dados y catálogos. El store separa `chatMessages` del buffer corto de eventos visuales. `useGameSocket` conserva el helper `sendCommand` y expone cuatro acciones tipadas.

- [x] **Step 4: Evitar replay visual tras reconexión y deduplicar chat**

Al abrir/reabrir socket, limpiar la cola de eventos transitorios antes de procesar el nuevo snapshot. Deduplicar mensajes por `messageId` tanto cuando un `CHAT_MESSAGE` llega antes de `CHAT_HISTORY_SYNC` como al reconciliar historial; no disparar animaciones desde `GAME_STATE_SYNC`.

- [x] **Step 5: Ejecutar pruebas frontend y typecheck**

Run: `rtk pnpm --dir frontend test --run src/types/protocol.test.ts src/stores/gameStore.test.ts src/hooks/useGameSocket.test.ts`
Run: `rtk pnpm frontend:typecheck`
Expected: PASS sin aserciones de casts inseguros.

## Task 5: Chat, reacciones y regalos en la mesa

**Files:**
- Create: `frontend/src/components/social/ChatPanel.tsx`
- Create: `frontend/src/components/social/ReactionBar.tsx`
- Create: `frontend/src/components/social/GiftMenu.tsx`
- Create: `frontend/src/components/social/SocialEffectsLayer.tsx`
- Test: `frontend/src/components/social/ChatPanel.test.tsx`
- Test: `frontend/src/components/social/ReactionBar.test.tsx`
- Test: `frontend/src/components/social/GiftMenu.test.tsx`
- Test: `frontend/src/components/social/SocialEffectsLayer.test.tsx`
- Modify: `frontend/src/components/game/GameTable.tsx`
- Modify: `frontend/src/components/game/GameTable.test.tsx`
- Modify: `frontend/src/app/room/[code]/RoomPageClient.tsx`
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Consumes: store y acciones del Task 4; IDs exactos del spec; asientos visibles de `GameTable`.
- Produces: `ChatPanel({ messages: ChatMessage[], isOpen: boolean, onToggle: () => void, onSendMessage: (text: string) => void })`, `ReactionBar({ onSendReaction: (reactionId: ReactionId) => void })`, `GiftMenu({ recipient: PublicPlayer, onSendGift: (playerId: string, giftId: GiftId) => void })` y `SocialEffectsLayer({ players: PublicPlayer[], events: readonly ServerEvent[] })`; panel plegable con contador de no leídos y animaciones no bloqueantes.

- [x] **Step 1: Escribir pruebas de interacción accesible**

Verificar que el panel cerrado no refluye el tablero, se abre/cierra con teclado y muestra 50 mensajes en texto plano; el límite de longitud impide enviar un mensaje mayor a 280. Verificar reacciones permitidas, regalo al asiento pulsado, botón persistente aunque exista un último regalo y ausencia de actualización optimista cuando el socket falla.

- [x] **Step 2: Ejecutar los tests de componentes y confirmar fallo**

Run: `rtk pnpm --dir frontend test --run src/components/social/ChatPanel.test.tsx src/components/social/ReactionBar.test.tsx src/components/social/GiftMenu.test.tsx src/components/social/SocialEffectsLayer.test.tsx src/components/game/GameTable.test.tsx`
Expected: FAIL porque los componentes sociales todavía no existen.

- [x] **Step 3: Construir componentes sociales enfocados**

`ChatPanel` muestra hora/nombre/texto, composición corta, indicador de no leídos y estado de error. `ReactionBar` presenta 😂 😭 😡 😎 🤯 ❤️ 👏. `GiftMenu` presenta 🌹 🍅 👏 🎉 ❤️ 🔥 para el destinatario elegido. `SocialEffectsLayer` mide asientos desde refs, vuela el emoji aprox. 700 ms y anima reacciones brevemente con `pointer-events: none`.

- [x] **Step 4: Integrar en GameTable sin cambiar geometría del tablero**

Montar chat cerrado por defecto y social controls junto a los asientos; en móvil el chat se superpone como drawer y no modifica el flujo normal del documento. Reducir movimiento según `MotionConfig`/`prefers-reduced-motion`.

- [x] **Step 5: Ejecutar pruebas sociales y de mesa**

Run: `rtk pnpm --dir frontend test --run src/components/social src/components/game/GameTable.test.tsx`
Expected: PASS; todos los controles tienen etiqueta accesible y los eventos recibidos son la única causa de animaciones.

## Task 6: Preferencias locales, audio y catálogo de skins

**Files:**
- Create: `frontend/src/lib/player-preferences.ts`
- Create: `frontend/src/lib/player-preferences.test.ts`
- Create: `frontend/src/lib/audio.ts`
- Create: `frontend/src/lib/audio.test.ts`
- Create: `frontend/src/components/game/GameSettings.tsx`
- Create: `frontend/src/components/game/GameSettings.test.tsx`
- Modify: `frontend/src/components/game/Piece.tsx`
- Modify: `frontend/src/components/game/Dice.tsx`
- Modify: `frontend/src/components/game/GameTable.tsx`
- Modify: `frontend/src/components/social/SocialEffectsLayer.tsx`
- Modify: `frontend/src/components/social/SocialEffectsLayer.test.tsx`
- Modify: `frontend/src/components/lobby/Lobby.tsx`
- Modify: `frontend/src/components/lobby/Lobby.test.tsx`
- Modify: `frontend/src/app/room/[code]/RoomPageClient.tsx`
- Modify: `frontend/src/hooks/useGameSocket.ts`

**Interfaces:**
- Consumes: IDs, `setCosmetics` y jugador público del Task 4; cambio backend del Task 3.
- Produces: `PlayerPreferences` definido arriba; `readPlayerPreferences(): PlayerPreferences`, `writePlayerPreferences(preferences: PlayerPreferences): void`, `playGameSound(cue: GameSoundCue | ReactionSoundCue, preferences: PlayerPreferences): void`; ajustes de «Efectos de juego» y «Sonidos de reacciones»; selector gratuito de skins.

- [x] **Step 1: Escribir pruebas de preferencias, audio y skins**

Probar defaults clásicos, JSON local corrupto/IDs retirados con fallback seguro, persistencia por dispositivo, efectos y sonidos de reacción activados por defecto pero con toggles independientes, ningún audio cuando su categoría está apagada y selector con cuatro estilos por categoría sin etiquetas de precio/desbloqueo. Probar que un sync con skin remota actualiza la presentación y que una preferencia local divergente se publica una sola vez tras reconectar.

- [x] **Step 2: Ejecutar los tests objetivo y confirmar fallo**

Run: `rtk pnpm --dir frontend test --run src/lib/player-preferences.test.ts src/lib/audio.test.ts src/components/game/GameSettings.test.tsx`
Expected: FAIL porque preferencias, audio y ajustes todavía no existen.

- [x] **Step 3: Implementar preferencias locales y cues sin red externa**

Guardar skins y dos switches de sonido bajo una clave versionada de `localStorage`; defaults: estilos clásicos y ambos sonidos habilitados. Ante SSR, almacenamiento bloqueado o dato inválido usar esos defaults. Implementar cues breves locales con Web Audio API y activar el contexto solo después de interacción del usuario; no añadir música ni dependencia de assets remotos. Conectar los cues de reacción en `SocialEffectsLayer` y los efectos de juego en `GameTable`/`Dice`.

- [x] **Step 4: Implementar selector y propagación de skins**

Mostrar cuatro IDs de dados (`classic`, `brass`, `jade`, `midnight`) y cuatro de fichas (`classic`, `porcelain`, `walnut`, `glow`), todos disponibles. Selector desde lobby y ajustes de partida; guardar localmente y enviar `SET_COSMETICS` al servidor. `Piece` y `Dice` aplican estilo sin cambiar color, legibilidad ni interacción.

- [x] **Step 5: Ejecutar pruebas de ajustes, piezas y lobby**

Run: `rtk pnpm --dir frontend test --run src/lib/player-preferences.test.ts src/lib/audio.test.ts src/components/game/GameSettings.test.tsx src/components/lobby/Lobby.test.tsx`
Run: `rtk pnpm frontend:typecheck`
Expected: PASS; `Efectos de juego` y `Sonidos de reacciones` se pueden apagar por separado, música inexistente.

## Task 7: Dados junto a cada jugador y mesa móvil sin fricción

**Files:**
- Create: `frontend/src/components/game/PlayerSeat.tsx`
- Test: `frontend/src/components/game/PlayerSeat.test.tsx`
- Modify: `frontend/src/components/game/GameTable.tsx`
- Modify: `frontend/src/components/game/GameTable.test.tsx`
- Modify: `frontend/src/components/game/Dice.tsx`
- Modify: `frontend/src/lib/board-layouts.test.ts`
- Modify: `frontend/src/components/game/TurnIndicator.tsx`
- Modify: `frontend/src/app/globals.css`

**Interfaces:**
- Consumes: `GameState.lastRollsByPlayerId` y preferencias de skins del Task 1/6.
- Produces: `PlayerSeat({ player: PublicPlayer, lastRoll: PlayerLastRoll | null, isActive: boolean, canRoll: boolean, rollEvent?: DiceRolledEvent, diceSkinId: DiceSkinId, onRoll: () => void, onOpenGiftMenu: (playerId: string) => void })`, que presenta nombre/estado, último par y acción de regalo; `Dice` recibe `displayedRoll: PlayerLastRoll | null` separado del `rollEvent` transitorio y solo permite lanzar al jugador activo.

- [x] **Step 1: Añadir pruebas de posición y actualización de tiradas**

Probar que cada jugador muestra su última tirada junto al nombre, el dado activo es el único accionable, una tirada de rival anima su asiento y muestra los dos valores correctos, el siguiente turno no borra los resultados de otros asientos, y un sync/reconexión pinta valores sin animar (`test_reconnect_shows_last_roll_without_animation`). Probar orientación local para 4/5/6, nombres largos y `test_six_player_table_renders_all_seats_and_controls` en `GameTable.test.tsx`.

- [x] **Step 2: Ejecutar pruebas de mesa y layout y confirmar fallo**

Run: `rtk pnpm --dir frontend test --run src/components/game/PlayerSeat.test.tsx src/components/game/GameTable.test.tsx src/components/game/Board.test.tsx src/lib/board-layouts.test.ts`
Expected: FAIL porque los dados secundarios y los asientos con controles todavía no están conectados a `lastRollsByPlayerId`.

- [x] **Step 3: Extraer asiento y separar valor persistido de evento animable**

`PlayerSeat` recibe `PublicPlayer`, `PlayerLastRoll | null`, estado activo/conexión, skin y callbacks. `Dice` dibuja el último resultado en todos los asientos, pero solo habilita la acción del jugador activo. Una animación de 500–700 ms se dispara únicamente por un nuevo `DICE_ROLLED.eventId`, nunca por hidratar `lastRollsByPlayerId`.

- [x] **Step 4: Ajustar distribución responsive conservando perspectiva del jugador**

Mantener la proyección SVG y orientación de casa local existente. Alinear las cuatro identidades a esquinas; en layout radial ubicar cinco/seis asientos en posiciones perimetrales estables. Compactar header/estado/filas con chat plegado para 390 × 844; no añadir descripciones visibles de turno ni reservar alturas que desplacen el tablero. En pantallas menores o zoom, permitir scroll natural en vez de recortar.

- [x] **Step 5: Ejecutar pruebas y revisar viewport objetivo**

Run: `rtk pnpm --dir frontend test --run src/components/game/PlayerSeat.test.tsx src/components/game/GameTable.test.tsx src/components/game/Board.test.tsx src/lib/board-layouts.test.ts`
Run: `rtk pnpm frontend:typecheck`
Expected: PASS; a 390 × 844 el tablero, asientos, dados y acciones esenciales siguen visibles con chat cerrado.

## Task 8: Contratos documentales y verificación de extremo a extremo

**Files:**
- Modify: `README.md`
- Modify: `DESIGN.md`
- Modify: `UX-CONTRACT.md`
- Test: suites existentes backend/frontend y auditoría visual del flujo.

**Interfaces:**
- Consumes: funcionalidades integradas de Tasks 1–7.
- Produces: documentación que distingue funciones implementadas de aplazadas y evidencia reproducible de suites completas.

- [x] **Step 1: Actualizar sistema visual y documentación según UI terminada**

Actualizar `DESIGN.md` y `UX-CONTRACT.md` solo con comportamientos presentes: asientos/dados, chat plegable, regalos/reacciones, controles de sonido y selector gratuito. Actualizar README para marcar Fase 3 implementada únicamente al cerrar la tarea, enlazar spec/plan y mantener explícitamente fuera música, pagos, tienda, historial y matchmaking. Revisar protocolo contra JSON Schemas reales.

- [x] **Step 2: Ejecutar la verificación completa**

Run: `rtk pnpm frontend:test`
Run: `rtk pnpm frontend:typecheck`
Run: `rtk pnpm frontend:build`
Run: `rtk uv run --project backend pytest -q`
Expected: todas las suites verdes, build Next.js exitoso y sin cambios en resultados de reglas Fase 2.

- [x] **Step 3: Verificar visualmente los flujos y accesibilidad**

Con backend/frontend locales y cuatro, cinco y seis asientos, comprobar envío de chat, reacción, regalo, preferencias de audio, cambio de skin y tirada desde varios navegadores. Confirmar que participantes ven las mismas actualizaciones; reconectar para validar historial/último regalo/skins/tiradas estáticas. Revisar escritorio, 390 × 844, movimiento reducido, teclado y que el chat no fuerce scroll.

**Evidencia de cierre:** navegador local en práctica de seis jugadores a 390 × 844; chat, reacción, regalo, toggles de sonido, skins, tirada y recarga/reconexión comprobados. El documento quedó en 390 × 844 sin scroll (`scrollY=0`). Orientación y accesibilidad de 4/5/6 jugadores, fanout entre clientes, deduplicación y recuperación también están cubiertos por las suites frontend/backend.

- [x] **Step 4: Revisar el cambio antes de cerrar**

Ejecutar `rtk proxy git status --short` y revisar los diffs únicamente de archivos de Fase 3. El checkout ya contiene modificaciones ajenas a esta fase: preservar esos cambios, no usar staging amplio ni incluirlos en un commit. Si se decide crear commits, añadir únicamente paths revisados de la tarea.

## Orden de entrega

1. **Base autoritativa:** Tasks 1–3 — estado, protocolo y backend; cada rechazo debe ser no mutante.
2. **Canal cliente:** Task 4 — validación, recuperación y acciones tipadas.
3. **Capa social:** Task 5 — chat, reacciones, regalos y animaciones.
4. **Personalización:** Task 6 — preferencias, sonidos y skins gratuitas.
5. **Mesa final:** Task 7 — últimos dados en cada asiento y viewport móvil.
6. **Cierre:** Task 8 — documentación, pruebas completas y revisión de navegador.

Las tareas comparten contratos y `RoomManager`/store; ejecutarlas en este orden evita que implementaciones paralelas diverjan en payloads. Se puede hacer revisión visual independiente cuando la UI integrada esté lista.
