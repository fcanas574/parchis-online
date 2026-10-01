# UX Contract

## Product context

- Audience: Friends playing in an invitation-only room.
- Primary jobs: Create or join a private room, confirm connection/readiness, play a server-authoritative match, and use lightweight room chat, reactions, gifts, and free cosmetic preferences.
- Target market(s): Spanish-language MVP; no market-specific billing, identity, or regulated workflow.
- Active locales: `es`; room codes remain uppercase ASCII.
- Language/content register and native-review policy: Plain conversational Spanish; no native-language review is required beyond product-owner review for this MVP.
- Timezone/calendar policy: Chat uses server timestamps and displays them in the viewer's local time; reservation timestamps remain internal.
- Accessibility target: WCAG 2.2 AA.

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| Permission model (host/start, player/ready) | `docs/superpowers/specs/2026-09-14-parchis-online-design.md` §§7–10; `contracts/v1/README.md` | Product spec / protocol contract | 2026-09-24 |
| Room/session lifecycle | `docs/superpowers/specs/2026-09-14-parchis-online-design.md` §§4, 8, 10; `frontend/src/lib/session.ts` | Product spec / implemented session boundary | 2026-09-24 |
| Turn, movement, capture, blockade, and finish policy | `docs/superpowers/specs/2026-09-14-parchis-online-design.md` §5 | Approved product rule contract | 2026-09-26 |
| Authoritative lobby state | `contracts/v1/server-events.schema.json`; `frontend/src/types/game.ts` | Protocol / client type contract | 2026-09-24 |
| Social limits, gift state, and free cosmetics | Phase 3 approved spec §§4–9; `contracts/v1/README.md` | Product spec / protocol contract | 2026-10-01 |
| Billing / payment | Explicitly excluded by product spec §1 | Product spec | 2026-09-24 |
| Legal / regulatory copy | Not applicable to Phase 1 | Scope decision | 2026-09-24 |
| Market / content conventions | Approved Phase 3 spec; project `DESIGN.md` | Approved product brief / design context | 2026-10-01 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`.
- Token ownership model: Existing runtime canonical (Model B).
- Runtime design-system/token source: `frontend/src/app/globals.css`.
- Mapping/export/adapters: CSS semantic variables → Tailwind arbitrary-variable utilities/shared primitives → route components.
- Token drift gate: `designmd lint DESIGN.md`, premium strict audit, changed-code token search, browser computed/visual inspection.
- Supported themes: Twilight dark theme; system forced-colors compatibility.
- Design-context owner/review policy: Durable changes update `DESIGN.md`, globals, and shared primitives together.

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | Native radio groups for bounded player count and color | This contract + task brief | native radio only | keyboard + selected state test |
| Form | `LandingPage` using shared `Input`/`Button` | This contract + API contract | create / join | Testing Library behavior tests |
| Scrollbar | `frontend/src/app/globals.css` | `DESIGN.md` | stable-gutter geometry only | premium audit + browser computed style |
| Status feedback | Inline `role=status` / `role=alert` regions | This contract | connection / API / clipboard | component tests + browser exercise |
| Room lifecycle | `createRoom`, `joinRoom`, `saveSession`, `useGameSocket` | API/protocol contracts | create / join / reconnect / direct invitation | component + multi-tab flow |
| Movement chooser | `Board` inside the fixed board stage | Product spec §5 + authoritative `availableMoves` | direct move for one legal option; anchored numeric chooser for multiple | component tests + keyboard/browser exercise |
| Player seat and dice | `PlayerSeat`, `Dice`, `GameTable` | `lastRollsByPlayerId` and `DICE_ROLLED` | persistent per-seat values; brief event-only animation; active local seat alone can roll | reconnect and six-seat tests + mobile browser check |
| Chat and quick reactions | `ChatPanel`, `ReactionBar`, `SocialEffectsLayer` | WebSocket events and recent-chat history | folded chat overlay; plain text/emoji; transient reactions | component and WebSocket tests |
| Gift and cosmetic controls | `GiftMenu`, `GameSettings` | authenticated WebSocket state plus local preferences | free gift catalog and four available skins per category | component, persistence, and socket tests |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | labeled action | subtle lift/contrast | brass ring | no lift | dim, no handler | stable label geometry + `aria-busy` | n/a |
| Input | labeled filled field | border contrast | brass ring | n/a | dim | n/a | text, `aria-invalid`, described by error |
| Radio choice | label + swatch/value | border contrast | native input focus ring on label | selected inset ring | dim | n/a | group-level text if needed |
| Player card | name + text statuses | n/a | n/a | n/a | n/a | n/a | disconnected text badge |
| Copy invitation | actionable label | button hover | button ring | pressed | n/a | n/a | persistent inline fallback |

## Dataset navigation

The lobby renders every server-provided player in `seatIndex` order. During play, those same 4–6 players are projected around the board relative to the viewer's color; all seats show their own most recent dice result. There is no pagination or filtering, and gameplay actions remain server-authoritative.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Create room | `Crear sala` | Stable disabled/busy button | `/room/{serverRoomCode}` | Room route connects and synchronizes | Inline API code/message; preserve every entered value; resubmit enabled | Route heading | Phase 1 product spec; API contract |
| Join room | `Entrar a la sala` | Stable disabled/busy button | `/room/{serverRoomCode}` | Room route connects and synchronizes | Inline API code/message; preserve normalized code/name/color | Route heading | Phase 1 product spec; API contract |
| Toggle ready | `Estoy listo` / `Ya no estoy listo` | Socket command only; no optimistic room mutation | Same room | Authoritative snapshot updates card/action | Socket error remains visible in room status | Trigger remains in place | Protocol v1 |
| Start game | `Iniciar partida` | Socket command only; duplicate blocked by server state/connection gating | Same room | Playing notice replaces lobby content | Authoritative error remains visible; lobby remains usable | Trigger or status panel | Product spec §8 |
| Copy invitation | `Copiar invitación` | Stable button | Same room | `Copiado` for two seconds | Readable manual-copy guidance beside selectable URL | Copy button | Phase 1 product spec |
| Back/home | `Volver al inicio` | None | `/` | Landing route | Available whenever the room session is missing | Landing heading | Phase 1 product spec |
| Open invitation without a session | Visit `/room/{code}` | Join form; no socket attempt | Same room route after joining | Room code is prefilled and join mode selected | Inline API error preserves the code and entered name | Name field remains first in the form | Phase 1 product spec |
| Send chat | Chat composer | WebSocket command; no optimistic append | Same room | Server message appears once for all and enters recent history | Keep draft and show an inline error if the server rejects it | Composer remains available | Phase 3 spec §7; protocol v1 |
| Send reaction | Quick-reaction button | Event command | Same room | Brief shared animation; optional reaction sound follows local preference | No persistent mutation; keep controls usable | Focus stays on selected reaction | Phase 3 spec §§7, 9 |
| Send gift | Gift icon then catalog choice | WebSocket command; no optimistic received-gift badge | Same room | Shared sender-to-recipient animation; server snapshot updates the recipient badge | Keep catalog open and explain send failure | Return focus to the gift trigger on close | Phase 3 spec §7 |
| Change skin or sound | Game settings | Skin syncs through WebSocket; sound toggles stay local | Same room | Skin appears for all players; each audio toggle acts independently | Preserve current setting if sync is rejected | Focus stays on the setting control | Phase 3 spec §9 |

## Navigation and responsive behavior

- Route document title policy: `Inicio — Parchís Online` and `Sala {CODE} — Parchís Online`; missing-session route keeps the room title.
- Route error / 403 page behavior: Opening a room invitation without a local session is not an authorization attempt; show the join form with that room code prefilled and do not open a socket. Backend authentication failure remains in-room with recovery guidance and does not retry indefinitely.
- Breadcrumb/tab/route-state policy: No breadcrumbs or tabs. Browser Back returns to the landing route.
- Sidebar/drawer/bottom-sheet transformation: Not applicable.
- Responsive strategy: Two-column landing becomes one column below `48rem`; lobby invitation and player cards stack without hiding actions or statuses. At 390 × 844 the board, six seats/dice, and essential controls fit with chat closed; shorter or zoomed views scroll naturally rather than clip.
- Truncation/full-value access: Names wrap; room code and invite URL remain selectable and wrap safely.
- Focus restoration and sticky-obstruction policy: No sticky chrome. Route headings receive programmatic focus only if a future router-level focus owner is added; current controls remain unobscured.

## Gameplay presentation

- The local seat's color arm is shown at the bottom and its start cell is labeled 5; this changes only the board projection, never the server's logical cell indices.
- Player names and gift controls sit with their seats around the rotated board. Every seat displays that player's latest server dice pair; only the local active seat enables the roll action.
- The active seat highlight, its dice, and a screen-reader-only live announcement identify whose turn it is. Do not add a visible turn-description panel or phase copy that shifts the board or creates scrolling.
- A piece with one authoritative legal move moves when tapped. If that piece has multiple legal moves, show a small, non-modal chooser directly above the piece with only the relevant rolled values (for example `5`, `2`, or `5+2`). It is absolutely positioned within the board stage and must not reflow the page. Escape closes it and restores focus to the piece; an outside tap or scroll dismisses it.
- A piece that reaches the finish remains logically `finished` and is drawn in a stable slot inside its owner's colored goal wedge. It must not return to the yard or occupy the shared center.
- Normal safe cells show a star. Game-rule exceptions, shared-cell capacity, captures, and blockade behavior follow the authoritative product spec §5; the client only presents server-approved moves.
- The roll control sends `ROLL_DICE` without a client result. Every client animates only the matching player's dice for roughly 500–700 ms, then reveals the two server values. `GAME_STATE_SYNC` restores each player's latest values after reconnection without generating a new roll or replaying the animation.
- A typical 390 × 844 phone viewport shows the complete play surface without document scrolling. Short viewports, zoom, and enlarged text may scroll naturally rather than clip controls.
- Chat is folded by default and opens as an overlay; quick reactions stay compact. Gift and reaction animations are transient, never block a turn, and are not replayed after reconnect. The latest received gift and four free styles each for dice and pieces survive in public player state; no style changes movement or game authority.
- Game effects and reaction sounds have separate local controls. There is no music or remote audio loading.

## Overlays and feedback

- Dialog primitive: No modal is used for piece movement; the chooser is a non-modal, board-anchored popover.
- Destructive confirmation levels: No destructive actions in the room or gameplay UI.
- Toast placement/duration/deduplication: No toast system; copy and API feedback are inline and scoped.
- Alert/banner scope and persistence: Connection status is a room banner; “Sala sincronizada” means the authoritative `GAME_STATE_SYNC` arrived, not merely that the WebSocket opened. API and clipboard failures persist beside their triggering control until retry/success.
- Tooltip delay/dismissal: No tooltip-only content.
- Unsaved-changes behavior: Not required; landing form values are transient and remain on API failure.
- Layer/z-index contract: `--z-popover` (`300`) for the movement chooser inside `.parchis-board-stage`; the stage owns its stacking context and chooser placement never affects layout.

## Async and resilience

- Mutation default: Pessimistic. The client never invents lobby/game state.
- Idempotency and duplicate-submit policy: HTTP create/join buttons disable while their promise is pending; socket mutations are enabled only from authoritative state and current connection.
- Auto-save/draft recovery: None.
- Offline/read-stale/write behavior: Keep the last authoritative lobby readable and show connection state; do not claim synchronized while reconnecting.
- Retry/backoff/timeout behavior: Owned by `useGameSocket`; room UI reports its states without creating another retry loop.
- Version conflict and multi-tab behavior: Store ignores older state versions; chat deduplicates by `messageId`; each tab uses its saved room session.
- Reconnect recovery: `GAME_STATE_SYNC` restores player skins, latest gift, and per-player dice without replaying transient animations; `CHAT_HISTORY_SYNC` replaces the recent-message buffer (up to 50).
- Local preferences: Dice/piece skins and the independent sound switches are stored on the device; only cosmetic IDs are synchronized to the room. No account or remote audio is required.
- Session expiry/re-authentication: `UNAUTHENTICATED` shows recovery guidance and stops retrying; missing session links home without opening a socket.
- Long-running progress and return path: Not applicable.
- Stale-request cancellation/invalidation and pending-state ownership: Landing ignores late completion after unmount; each form owns one pending request. Lobby actions stay disabled from socket open until the authoritative room snapshot arrives.
- Dialog/form preservation and retry after mutation failure: Forms remain mounted with all non-sensitive values; inline error clears on the next attempt. A failed gift remains selectable; chat/reaction state is not fabricated optimistically.

## Validation

- Schema/validation layer: HTML constraint metadata plus component-owned submit checks; server remains authoritative.
- Trigger timing: Submit first; five-character room code is normalized to uppercase while typing and before submission.
- Error summary/inline policy: One stable inline message per form. Field validation marks the affected field with `aria-invalid` and links its error with `aria-describedby`; API errors remain form-level alerts.
- Server error mapping: Show structured API `code` and `message`; unknown failures use a safe generic message.
- Sensitive-value handling: Only server-returned room credentials are persisted; display name, choices, and failed responses are not stored.
- `noValidate`, first-invalid focus, duplicate-submit prevention, unsaved changes, and submit recovery: Both forms use `noValidate`; invalid submit focuses the first invalid field; pending prevents duplicates; API failure preserves values and restores the action.

## Permission and clipboard

- Permission UI strategy: Host-only start is hidden for non-hosts. Host start is disabled with readable readiness guidance until capacity, connection, and ready conditions are all true.
- Clipboard copy policy: Copy the full same-origin `/room/{code}` URL through `navigator.clipboard`; show `Copiado` for two seconds. On absent/denied clipboard access, keep that absolute URL selectable and show manual-copy guidance.
- Disabled-state explanation: Visible readiness guidance adjacent to the host start action; no hover-only tooltip.

## Verification

- Required static commands: `pnpm frontend:test`, `pnpm frontend:typecheck`, `pnpm frontend:build`, backend pytest, `designmd lint DESIGN.md`, premium strict audit, and anti-pattern searches.
- Browser/device/locale/theme matrix: Spanish copy at desktop and narrow phone widths; 4/5/6 seats, server dice animation/recovery, chat, reaction, gift, skin/audio settings; create/join and API failure; connection/reconnection; reduced motion; keyboard-only focus.
- Accessibility checks: Native semantics, label activation, visible focus, text statuses, live regions, and no color-only state.
- Native-language/domain review and target-user evidence: Product-owner approval of Spanish social-game behavior; no regulated-domain review required.
- Component-state/visual regression coverage: Testing Library state tests; browser screenshots when tooling is available.
- Canonical sibling flow used for comparison: The private room/lobby flow remains the canonical API/session/store/socket pattern for social gameplay.
- Project audit command/result: Run premium `audit_project.py ... --mode strict` before completion.
- Full-flow evidence: Multi-tab create/join/ready/start browser exercise when local services and browser tooling are available.
- Failure-path evidence: Testing Library API-error, missing-session, clipboard-failure, host-gating, and reconnecting tests plus browser exercise.
