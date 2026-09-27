# Parchís Online

Juego privado de Parchís para reunirse con amigos mediante salas de 4 a 6 personas. La Fase 1 entrega creación y acceso a salas, lobby en tiempo real, presencia, estado listo, inicio reservado al anfitrión y reconexión temporal.

## Requisitos

- Node.js 20.9 o posterior
- pnpm 11
- Python 3.12 o posterior
- uv

## Instalación

Desde la raíz del repositorio:

```bash
pnpm install
uv sync --project backend
cp .env.example .env
cp .env.example frontend/.env
```

Los archivos `.env` locales son ignorados por Git. `.env` en la raíz configura CORS y los límites del backend; `frontend/.env` configura el origen público de la API.

El modo de práctica está habilitado por defecto para pruebas locales. Si despliegas la app públicamente y no quieres aceptar partidas automáticas, añade `PRACTICE_MODE_ENABLED=false` al `.env` del backend; `POST /api/practice` responderá `PRACTICE_DISABLED` sin crear salas. Ocultar la entrada de práctica en la web no constituye autenticación.

## Desarrollo

Inicia cada proceso en una terminal distinta, desde la raíz del repositorio:

```bash
pnpm frontend:dev
```

```bash
uv run --project backend uvicorn app.main:app --app-dir backend --reload --port 8000
```

La web queda disponible en `http://localhost:3000`; la API y los WebSockets usan `http://localhost:8000`. El endpoint `GET /health` confirma que la API está activa.

## Verificación

```bash
pnpm frontend:typecheck
pnpm frontend:test
pnpm frontend:build
pnpm backend:test
```

Los tests REST cubren salas con capacidad para 4, 5 y 6 personas y el rechazo al superar su límite. El flujo WebSocket completo —incluidos inicio exclusivo del anfitrión y snapshots públicos idénticos para todos— se prueba con cuatro jugadores; la reconexión también tiene cobertura automatizada.

## Estado y privacidad

Las salas viven en memoria: reiniciar el backend las elimina. PostgreSQL y Redis están aplazados; el repositorio en memoria mantiene un límite claro para migrar la persistencia más adelante. El token de reconexión se guarda en `localStorage` del navegador y reserva el asiento por diez minutos después de una desconexión. No se necesita una cuenta para jugar en esta fase.

## Fases

- **Fase 1 — Salas y lobby:** lista para uso local entre amigos; incluye sincronización autoritativa de lobby y recuperación básica de sesión.
- **Fase 2 — Partida:** La Fase 2 incluye tableros para 4, 5 y 6 personas, partida autoritativa en tiempo real, reconexión con autopiloto y repetición en la misma sala. El estado permanece en memoria y chat, reacciones y regalos se aplazan a Fase 3.
- **Fase 3 — Funciones sociales:** añade chat, emojis, reacciones, sonidos y regalos virtuales gratuitos.

No hay pagos, monedas, tienda, anuncios, suscripciones, ranking global ni matchmaking público.

El contrato versionado de mensajes está en [`contracts/v1/README.md`](contracts/v1/README.md); las especificaciones de producto y juego están en [`docs/superpowers/specs/2026-09-14-parchis-online-design.md`](docs/superpowers/specs/2026-09-14-parchis-online-design.md) y [`docs/superpowers/specs/2026-09-25-parchis-online-phase-2-gameplay-design.md`](docs/superpowers/specs/2026-09-25-parchis-online-phase-2-gameplay-design.md).
