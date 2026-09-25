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

Los tests de backend ejecutan flujos REST y WebSocket de salas de 4, 5 y 6 personas, inicio del anfitrión y reconexión.

## Estado y privacidad

Las salas viven en memoria: reiniciar el backend las elimina. PostgreSQL y Redis están aplazados; el repositorio en memoria mantiene un límite claro para migrar la persistencia más adelante. El token de reconexión se guarda en `localStorage` del navegador y reserva el asiento por diez minutos después de una desconexión. No se necesita una cuenta para jugar en esta fase.

## Fases

- **Fase 1 — Salas y lobby:** lista para uso local entre amigos; incluye sincronización autoritativa de lobby y recuperación básica de sesión.
- **Fase 2 — Partida:** añade `GameRules`, tablero, dados, fichas, turnos, capturas y victoria, conservando al servidor como autoridad.
- **Fase 3 — Funciones sociales:** añade chat, emojis, reacciones, sonidos y regalos virtuales gratuitos.

No hay pagos, monedas, tienda, anuncios, suscripciones, ranking global ni matchmaking público.

El contrato versionado de mensajes está en [`contracts/v1/README.md`](contracts/v1/README.md); el alcance de diseño aprobado, en [`docs/superpowers/specs/2026-09-14-parchis-online-design.md`](docs/superpowers/specs/2026-09-14-parchis-online-design.md).
