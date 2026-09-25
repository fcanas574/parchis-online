---
version: alpha
name: "Parchís Online"
description: "A private friends' game room shaped by twilight felt, warm wood, and tactile playing-piece color."
colors:
  primary: "#F1B85B"
  room-night: "#17131F"
  table-felt: "#211B2A"
  raised-felt: "#2C2436"
  parchment: "#F6EAD2"
  quiet-ink: "#B8AFC2"
  danger: "#FF7F72"
  piece-green: "#49C783"
  piece-red: "#EF6467"
  piece-blue: "#68A4F8"
  piece-yellow: "#F3CA52"
  piece-purple: "#A77CF4"
  piece-orange: "#F29A4A"
typography:
  display:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "3.5rem"
    lineHeight: "0.95"
  body:
    fontFamily: "'Avenir Next', Avenir, 'Segoe UI', system-ui, sans-serif"
    fontSize: "1rem"
    lineHeight: "1.5"
  utility:
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    fontSize: "0.875rem"
    lineHeight: "1.4"
rounded:
  sm: "0.5rem"
  md: "0.875rem"
  lg: "1.25rem"
  pill: "999px"
spacing:
  control-gap: "0.75rem"
  card-padding: "1.5rem"
  section-gap: "2rem"
  page-max: "70rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.room-night}"
    rounded: "{rounded.sm}"
    height: "2.75rem"
    padding: "{spacing.control-gap}"
  button-secondary:
    backgroundColor: "{colors.table-felt}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.sm}"
    height: "2.75rem"
    padding: "{spacing.control-gap}"
  button-ghost:
    backgroundColor: "{colors.room-night}"
    textColor: "{colors.quiet-ink}"
    rounded: "{rounded.sm}"
    height: "2.75rem"
  input:
    backgroundColor: "{colors.raised-felt}"
    textColor: "{colors.parchment}"
    rounded: "{rounded.sm}"
    height: "2.75rem"
  card:
    backgroundColor: "{colors.table-felt}"
    rounded: "{rounded.md}"
    padding: "{spacing.card-padding}"
  badge:
    backgroundColor: "{colors.raised-felt}"
    textColor: "{colors.quiet-ink}"
    rounded: "{rounded.pill}"
  badge-error:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.room-night}"
    rounded: "{rounded.pill}"
  player-green:
    backgroundColor: "{colors.piece-green}"
    textColor: "{colors.room-night}"
  player-red:
    backgroundColor: "{colors.piece-red}"
    textColor: "{colors.room-night}"
  player-blue:
    backgroundColor: "{colors.piece-blue}"
    textColor: "{colors.room-night}"
  player-yellow:
    backgroundColor: "{colors.piece-yellow}"
    textColor: "{colors.room-night}"
  player-purple:
    backgroundColor: "{colors.piece-purple}"
    textColor: "{colors.room-night}"
  player-orange:
    backgroundColor: "{colors.piece-orange}"
    textColor: "{colors.room-night}"
---

# Parchís Online Design System

## Overview

### Creative North Star

A private table after sunset: deep violet felt, a dark walnut edge, warm parchment lettering, and six saturated playing pieces set down by friends. The interface should feel social and tactile without drawing a literal board before the board feature exists.

### Product context and register

- **Audience and primary job:** Friends creating or joining a private 4–6 person room, then confirming presence and readiness.
- **Target market(s) and evidence:** Spanish-language MVP with no market-specific commerce or regulated flow; grounded in `docs/superpowers/specs/2026-09-14-parchis-online-design.md`.
- **Locale(s) and language policy:** Product-owned UI uses Spanish (`es`); server error codes and messages remain visible for actionable diagnostics.
- **Usage scene:** Laptop, tablet, or phone during a social game session; low data density, frequent glanceable status changes.
- **Register:** Product. The landing route may be expressive, while forms and lobby controls favor familiarity and speed.
- **Memorable signature:** A six-piece room seal—six restrained color pips around a warm center—appears as an ambient identity mark, never as a fake board or control.
- **Restraint:** One signature only. Forms, lobby states, and recovery copy remain quiet, direct, and geometrically stable.
- **Anti-references:** No admin dashboard tables, glassmorphic gradient cards, childish clip-art, casino imagery, premium/payment vocabulary, or game-board/rule imagery before those features exist.
- **Token ownership/runtime mapping:** Model B. Hand-maintained semantic variables in `frontend/src/app/globals.css` are runtime-canonical; this file mirrors their exact accepted values. Shared primitives consume those variables, and `designmd lint DESIGN.md`, the premium static audit, and browser inspection are the drift gates.

## Colors

`room-night`, `table-felt`, and `raised-felt` form three solid depth layers. `parchment` and `quiet-ink` carry primary and supporting text; `primary` is the warm brass accent mirrored by runtime `--color-brass` and marks the main safe action and visible focus. `danger` is reserved for errors. The six `piece-*` colors are identity choices and swatches, never the only carrier of ready, host, or connection state. There is one dark theme in Phase 1; forced-colors mode yields control to system colors.

## Typography

Georgia gives the product name a familiar tabletop gravitas and is restricted to the wordmark and major room heading. Avenir Next/system sans handles body, form, and status copy. The utility stack is used for room codes only, with tabular spacing and uppercase letters. Sentence case is standard for controls; the product wordmark is the sole recurring uppercase display phrase.

## Layout

The page uses a centered `70rem` stage. The landing page pairs an editorial welcome area with one task card; the lobby uses a compact invitation header and a wrapping player-card grid, never a dashboard table. Spacing follows the documented control/card/section values. Below `48rem`, all columns become one flow, controls remain at least `2.75rem` high, and no horizontal scroll is required. Async text reserves a consistent status row so controls do not move.

## Elevation & Depth

Depth comes from solid tonal layers, a thin warm border, and one soft downward shadow. Cards do not use multicolor gradients or blur-heavy glass effects. Hover may lift an enabled control by one pixel; static informational panels never float or pulse.

## Shapes

Controls use `sm`, functional cards use `md`, and primary room surfaces use `lg`. Pills are reserved for compact status badges and color markers. Borders are one pixel and warm-neutral; the six-piece seal is the only circular decorative composition.

## Components

### Foundational visual states

Enabled controls have clear default, hover, active, and `focus-visible` treatments. Focus uses a two-layer brass/room-night ring. Disabled controls keep their geometry, lose elevation, and use a non-interactive cursor. Busy buttons preserve their label width and add an inline status indicator with `aria-busy`. Errors use text plus `danger`; loading and connection changes use stable inline banners, not skeletons.

### Buttons and actions

`primary` is brass with dark text for the main safe action. `secondary` uses a felt surface and warm border. `ghost` is for low-emphasis utilities. Ready and start remain distinct actions; a disabled start button is accompanied by readiness guidance. Button height is stable across idle and busy states.

### Navigation and data display

Navigation uses real links. Player data is a semantic list of cards sorted by server-provided `seatIndex`. Badges combine words and color. Room codes use utility type. Route titles follow `UX-CONTRACT.md`.

### Forms and overlays

Fields have persistent labels, `noValidate`, app-owned inline error status, and visible invalid state. Player count and color use native radio groups because the product accepts platform-owned radio interaction and requires no popup geometry. No dialogs or toasts are introduced in Task 9; clipboard feedback stays beside the copy action.

### Iconography

No icon library is required for Phase 1. Simple CSS dots and letter initials support identity, always with nearby text. Decorative marks are `aria-hidden`.

### Motion

Only the landing stage and newly synchronized lobby surface may fade/translate in over 220ms. Controls use 120–160ms color/transform feedback. Reduced motion removes transforms, animation, and decorative drift while preserving immediate state changes.

### Content and data visualization

Voice is warm, direct Spanish: “Crear sala”, “Entrar a la sala”, “Estoy listo”. Status copy says what is happening and what the user can do next. There are no charts, scores, game rules, chat, reactions, dice, or board UI in this phase.

## Do's and Don'ts

- **Do:** Let tactile color identify players while text communicates every state.
- **Do:** Keep server state authoritative and reserve geometry during connection, busy, copied, and error feedback.
- **Don't:** turn the lobby into a table, admin panel, or marketing-card grid.
- **Don't:** add a board silhouette, dice, rules, chat, premium language, or decorative motion that implies unavailable behavior.
