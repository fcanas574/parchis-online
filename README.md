# Parchís Online

Juego privado de Parchís para reunirse con amigos mediante salas de 4 a 6 personas. Incluye creación y acceso a salas, lobby y partida en tiempo real, reglas autoritativas, reconexión, chat de sala, reacciones, regalos gratuitos y personalización visual gratuita.

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

Si cambias los puertos, configura `NEXT_PUBLIC_API_ORIGIN` en `frontend/.env` para apuntar a la API y `CORS_ORIGINS` en el `.env` raíz para incluir el origen exacto del frontend. Comprueba `GET http://localhost:8000/health`: la API de Parchís responde `{"status":"ok"}`. Si el puerto devuelve otro servicio, inicia Parchís en un puerto libre y actualiza ambas variables para que coincidan.

El modo de práctica está habilitado por defecto para pruebas locales. Si despliegas la app públicamente y no quieres aceptar partidas automáticas, añade `PRACTICE_MODE_ENABLED=false` al `.env` del backend; `POST /api/practice` responderá `PRACTICE_DISABLED` sin crear salas. Ocultar la entrada de práctica en la web no constituye autenticación.

Los logs detallados de cada envío y espera de WebSocket están desactivados por defecto para reducir trabajo por jugada. Si necesitas investigarlos temporalmente, configura `REALTIME_TRACE_LOGGING=true` en el backend y vuelve a `false` al terminar; los errores y la duración agregada de comandos siguen registrándose normalmente.

## Desarrollo

Inicia cada proceso en una terminal distinta, desde la raíz del repositorio:

```bash
pnpm frontend:dev
```

```bash
uv run --project backend uvicorn app.main:app --app-dir backend --reload --port 8000
```

La web queda disponible en `http://localhost:3000`; por defecto, la API y los WebSockets usan `http://localhost:8000`. El endpoint `GET /health` debe devolver `{"status":"ok"}` para confirmar que responde la API de Parchís.

## Verificación

```bash
pnpm frontend:typecheck
pnpm frontend:test
pnpm frontend:build
pnpm backend:test
```

Los tests REST cubren salas con capacidad para 4, 5 y 6 personas y el rechazo al superar su límite. El flujo WebSocket completo —incluidos inicio exclusivo del anfitrión y snapshots públicos idénticos para todos— se prueba con cuatro jugadores; la reconexión también tiene cobertura automatizada.

## Estado y privacidad

Las salas y sus 50 mensajes recientes de chat viven en memoria: reiniciar el backend los elimina. PostgreSQL y Redis están aplazados; el repositorio en memoria mantiene un límite claro para migrar la persistencia más adelante. El token de reconexión se guarda en `localStorage` del navegador y reserva el asiento por diez minutos después de una desconexión. Las preferencias locales de audio y skins se guardan en el dispositivo; no se necesita una cuenta. No hay historial duradero de partidas.

## Fases

- **Fase 1 — Salas y lobby:** lista para uso local entre amigos; incluye sincronización autoritativa de lobby y recuperación básica de sesión.
- **Fase 2 — Partida:** tableros para 4, 5 y 6 personas, partida autoritativa en tiempo real, turnos, movimientos, capturas, bloqueos, reconexión con autopiloto y repetición en la misma sala.
- **Fase 3 — Social y personalización gratuita (implementada):** chat con recuperación de hasta 50 mensajes recientes, reacciones animadas, regalos gratuitos, controles independientes para efectos y sonidos de reacción, cuatro skins gratuitas por categoría y dados/resultados junto a cada jugador.

No hay pagos, monedas, tienda, anuncios, suscripciones, música, historial duradero de partidas, ranking global ni matchmaking público.

El contrato versionado de mensajes está en [`contracts/v1/README.md`](contracts/v1/README.md); las especificaciones de producto y juego están en [`docs/superpowers/specs/2026-09-14-parchis-online-design.md`](docs/superpowers/specs/2026-09-14-parchis-online-design.md), [`docs/superpowers/specs/2026-09-25-parchis-online-phase-2-gameplay-design.md`](docs/superpowers/specs/2026-09-25-parchis-online-phase-2-gameplay-design.md) y [`docs/superpowers/specs/2026-09-27-parchis-online-phase-3-social-design.md`](docs/superpowers/specs/2026-09-27-parchis-online-phase-3-social-design.md). El [plan de implementación de Fase 3](docs/superpowers/plans/2026-09-28-parchis-phase-3-social.md) organiza el trabajo en entregas verificables.
