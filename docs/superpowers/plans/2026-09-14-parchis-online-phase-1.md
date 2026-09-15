# Fase 1 — Salas, lobby y tiempo real Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Construir desde cero una Fase 1 ejecutable donde amigos puedan crear o unirse a una sala de 4–6 jugadores, ver presencia y estado listo en tiempo real, iniciar como host y recuperar su asiento mediante un token después de una reconexión.

**Architecture:** Monorepo con frontend Next.js/React/TypeScript y backend FastAPI/Python. El backend mantendrá las salas en memoria detrás de RoomRepository, autenticará cada WebSocket con un playerToken, serializará mutaciones por sala y emitirá eventos versionados más GAME_STATE_SYNC. La Fase 1 no implementará el tablero ni movimientos; dejará el estado de juego preparado para que la Fase 2 añada GameRules sin tocar el protocolo de lobby.

**Tech Stack:** Next.js App Router, React, TypeScript estricto, TailwindCSS, componentes UI estilo shadcn/ui, Zustand, Vitest, FastAPI, Pydantic v2, Uvicorn, pytest, pytest-asyncio, httpx y uv.

**Spec:** docs/superpowers/specs/2026-09-14-parchis-online-design.md

## Global Constraints

- El backend es la única autoridad para identidad de sesión, turnos, dados, movimientos, capturas y ganador.
- La primera persistencia será en memoria detrás de un repositorio abstracto.
- La comunicación entre frontend y backend tendrá contratos versionados v1.
- La variante inicial será flexible: reglas tradicionales como base, con opciones por sala.
- El tablero lógico será común para 4, 5 y 6 jugadores; únicamente cambiará su layout visual.
- No se usará estado optimista para dados ni movimientos.
- Código de sala de cinco caracteres en mayúsculas, evitando caracteres ambiguos.
- Nombre de jugador entre 2 y 20 caracteres, sin duplicados ignorando mayúsculas.
- Reserva de reconexión de diez minutos por defecto.
- Comandos de juego no aceptan playerId, seatIndex, color ni valor de dado como autoridad.
- Los payloads WebSocket se limitarán en tamaño y los errores no mutarán el estado.
- El proyecto debe seguir ejecutándose sin PostgreSQL ni Redis.
- No implementar pagos, monedas, tienda, publicidad, suscripciones, ranking global ni matchmaking público.
- La Fase 1 no implementa GameRules, tablero, dado, fichas, chat, reacciones, sonidos ni regalos; el protocolo puede reservar sus nombres para fases posteriores.
- Todas las rutas y comandos nuevos tendrán tests antes de su implementación.
- Todos los commits deben seleccionar explícitamente archivos bajo Projects/Parchis_teleton para no incluir los borrados preexistentes de Projects/parchistel.

---

## File Map

Los siguientes archivos serán creados o modificados en esta fase:

    package.json
    pnpm-workspace.yaml
    .gitignore
    .env.example
    README.md
    contracts/v1/protocol.schema.json
    contracts/v1/server-events.schema.json
    contracts/v1/README.md

    backend/pyproject.toml
    backend/app/__init__.py
    backend/app/main.py
    backend/app/config.py
    backend/app/security/__init__.py
    backend/app/security/rate_limit.py
    backend/app/api/__init__.py
    backend/app/api/rooms.py
    backend/app/api/websocket.py
    backend/app/game/__init__.py
    backend/app/game/models.py
    backend/app/realtime/__init__.py
    backend/app/realtime/connection_manager.py
    backend/app/realtime/events.py
    backend/app/repositories/__init__.py
    backend/app/repositories/room_repository.py
    backend/app/repositories/memory_room_repository.py
    backend/app/schemas/__init__.py
    backend/app/schemas/rooms.py
    backend/app/schemas/websocket.py
    backend/app/services/__init__.py
    backend/app/services/room_manager.py
    backend/app/services/command_router.py
    backend/tests/conftest.py
    backend/tests/test_health.py
    backend/tests/test_rate_limit.py
    backend/tests/test_protocol_schemas.py
    backend/tests/test_domain_models.py
    backend/tests/test_repository.py
    backend/tests/test_room_manager.py
    backend/tests/test_rooms_api.py
    backend/tests/test_connection_manager.py
    backend/tests/test_websocket_flow.py

    frontend/package.json
    frontend/tsconfig.json
    frontend/next.config.ts
    frontend/postcss.config.js
    frontend/tailwind.config.ts
    frontend/vitest.config.ts
    frontend/src/app/layout.tsx
    frontend/src/app/page.tsx
    frontend/src/app/globals.css
    frontend/src/app/page.test.tsx
    frontend/src/app/room/[code]/page.tsx
    frontend/src/components/home/LandingPage.tsx
    frontend/src/components/lobby/Lobby.tsx
    frontend/src/components/lobby/PlayerList.tsx
    frontend/src/components/lobby/PlayerCard.tsx
    frontend/src/components/lobby/RoomInvite.tsx
    frontend/src/components/ui/badge.tsx
    frontend/src/components/ui/button.tsx
    frontend/src/components/ui/card.tsx
    frontend/src/components/ui/input.tsx
    frontend/src/hooks/useGameSocket.ts
    frontend/src/lib/api.ts
    frontend/src/lib/session.ts
    frontend/src/lib/utils.ts
    frontend/src/lib/websocket.ts
    frontend/src/stores/gameStore.test.ts
    frontend/src/stores/gameStore.ts
    frontend/src/types/game.ts
    frontend/src/types/protocol.ts
    frontend/src/test/setup.ts

Cada archivo tendrá una responsabilidad única: contratos describen el wire format, schemas validan entradas, RoomManager controla el dominio de salas, ConnectionManager controla sockets, command_router traduce comandos a mutaciones y los componentes React solo presentan el estado recibido.

### Task 1: Bootstrap del monorepo y health check

**Files:**
- Create: package.json
- Create: pnpm-workspace.yaml
- Create: .gitignore
- Create: .env.example
- Create: frontend/package.json
- Create: frontend/tsconfig.json
- Create: frontend/next.config.ts
- Create: frontend/postcss.config.js
- Create: frontend/tailwind.config.ts
- Create: frontend/vitest.config.ts
- Create: frontend/src/app/layout.tsx
- Create: frontend/src/app/page.tsx
- Create: frontend/src/app/globals.css
- Create: frontend/src/app/page.test.tsx
- Create: frontend/src/test/setup.ts
- Create: README.md
- Create: backend/pyproject.toml
- Create: backend/app/__init__.py
- Create: backend/app/main.py
- Create: backend/app/config.py
- Create: backend/app/security/__init__.py
- Create: backend/app/api/__init__.py
- Create: backend/app/game/__init__.py
- Create: backend/app/realtime/__init__.py
- Create: backend/app/repositories/__init__.py
- Create: backend/app/schemas/__init__.py
- Create: backend/app/services/__init__.py
- Create: backend/tests/conftest.py
- Create: backend/tests/test_health.py

**Interfaces:**
- Produces the root commands pnpm frontend:dev, pnpm frontend:typecheck, pnpm frontend:test, and pnpm backend:test.
- Produces FastAPI app app.main:app with GET /health returning {"status": "ok"}.
- Produces frontend App Router shell at /.

- [ ] **Step 1: Write the failing backend health test**

Create backend/tests/test_health.py:

    from fastapi.testclient import TestClient

    from app.main import app

    client = TestClient(app)

    def test_health_returns_ok():
        response = client.get("/health")

        assert response.status_code == 200
        assert response.json() == {"status": "ok"}

Create backend/pyproject.toml with FastAPI, Pydantic, Uvicorn, pytest, pytest-asyncio, httpx, and jsonschema dependencies, and configure pytest with asyncio_mode = "auto". Keep Python support at >=3.12.

Run:

    uv sync --project backend
    uv run --project backend pytest backend/tests/test_health.py -q

Expected: FAIL because app.main:app and /health do not exist yet.

- [ ] **Step 2: Implement the minimal FastAPI application**

Create backend/app/main.py:

    from fastapi import FastAPI

    app = FastAPI(title="Parchís Online API", version="0.1.0")

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

Create backend/app/config.py with settings for CORS origin, reservation TTL, and maximum WebSocket payload size. Use pydantic-settings and default local values:

    CORS_ORIGINS=http://localhost:3000
    RESERVATION_TTL_SECONDS=600
    MAX_WEBSOCKET_MESSAGE_BYTES=16384
    ROOM_REQUESTS_PER_MINUTE=20

- [ ] **Step 3: Scaffold the frontend shell**

Create frontend/package.json with scripts:

    {
      "scripts": {
        "dev": "next dev",
        "build": "next build",
        "start": "next start",
        "typecheck": "tsc --noEmit",
        "test": "vitest"
      }
    }

Add Next.js, React, React DOM, TypeScript, TailwindCSS, PostCSS, Autoprefixer, Zustand, Zod, Framer Motion, class-variance-authority, clsx, tailwind-merge, and the Vitest/Testing Library development dependencies. Configure frontend/tsconfig.json with strict true, noEmit true, moduleResolution bundler, and the @/* alias to src/*.

Create frontend/src/app/layout.tsx with metadata title Parchís Online and a body that imports globals.css. Create frontend/src/app/page.tsx with a temporary main element containing the product name. Create frontend/src/test/setup.ts to import @testing-library/jest-dom/vitest and configure frontend/vitest.config.ts with jsdom, setupFiles, and the @/* path alias. Create frontend/src/app/page.test.tsx to assert that the temporary product name renders. Add Tailwind content paths for app, components, hooks, lib, stores, and types.

The page smoke test must be:

    import { render, screen } from "@testing-library/react";
    import { describe, expect, it } from "vitest";
    import HomePage from "./page";

    describe("home page", () => {
      it("renders the product name", () => {
        render(<HomePage />);
        expect(screen.getByText("PARCHÍS ONLINE")).toBeInTheDocument();
      });
    });

- [ ] **Step 4: Add root scripts and environment documentation**

Create package.json:

    {
      "name": "parchis-online",
      "private": true,
      "packageManager": "pnpm@11.1.3",
      "scripts": {
        "frontend:dev": "pnpm --dir frontend dev",
        "frontend:typecheck": "pnpm --dir frontend typecheck",
        "frontend:test": "pnpm --dir frontend test --run",
        "frontend:build": "pnpm --dir frontend build",
        "backend:test": "uv run --project backend pytest -q"
      }
    }

Create pnpm-workspace.yaml with frontend as the only pnpm workspace package. Add .env.example:

    NEXT_PUBLIC_API_ORIGIN=http://localhost:8000
    CORS_ORIGINS=http://localhost:3000
    RESERVATION_TTL_SECONDS=600
    MAX_WEBSOCKET_MESSAGE_BYTES=16384
    ROOM_REQUESTS_PER_MINUTE=20

Create README.md with the project name, a one-paragraph Fase 1 scope, the two local development commands, and a note that the in-memory room state is intentionally temporary.

Ignore node_modules, .next, coverage, .pytest_cache, __pycache__, .venv, .env, and generated cache files. Commit pnpm-lock.yaml and backend/uv.lock when the package managers create them. Do not add a broad ignore rule that hides docs or source files.

- [ ] **Step 5: Verify the bootstrap**

Run:

    pnpm install
    uv sync --project backend
    pnpm frontend:typecheck
    pnpm frontend:test
    pnpm backend:test
    pnpm frontend:build

Expected: all commands pass, with the frontend producing the temporary landing page and the backend serving /health.

- [ ] **Step 6: Commit the bootstrap**

Run from the repository root:

    git add Projects/Parchis_teleton/package.json Projects/Parchis_teleton/pnpm-workspace.yaml Projects/Parchis_teleton/.gitignore Projects/Parchis_teleton/.env.example Projects/Parchis_teleton/pnpm-lock.yaml Projects/Parchis_teleton/frontend Projects/Parchis_teleton/backend/pyproject.toml Projects/Parchis_teleton/backend/uv.lock Projects/Parchis_teleton/backend/app Projects/Parchis_teleton/backend/tests
    git diff --cached --name-only
    git commit -m "chore: bootstrap parchis online monorepo"

Confirm the staged name list contains no path under Projects/parchistel.

### Task 2: Contratos v1 y modelos de transporte

**Files:**
- Create: contracts/v1/protocol.schema.json
- Create: contracts/v1/server-events.schema.json
- Create: contracts/v1/README.md
- Create: backend/app/schemas/rooms.py
- Create: backend/app/schemas/websocket.py
- Create: backend/tests/test_protocol_schemas.py
- Create: frontend/src/types/game.ts
- Create: frontend/src/types/protocol.ts

**Interfaces:**
- Produces JSON wire format with camelCase fields and version: 1.
- Produces Python Pydantic models: CreateRoomRequest, JoinRoomRequest, RoomCredentials, ClientMessage, ReconnectCommand, PlayerReadyCommand, StartGameCommand, ServerEvent, ErrorEvent, and GameStateSyncEvent.
- Produces TypeScript discriminated unions ClientCommand and ServerEvent with the same field names and literals.

- [ ] **Step 1: Write contract validation tests**

Create backend/tests/test_protocol_schemas.py:

    import json
    from pathlib import Path

    import pytest
    from jsonschema import ValidationError, validate

    CONTRACTS = Path(__file__).parents[2] / "contracts" / "v1"

    def load_schema(name: str) -> dict:
        return json.loads((CONTRACTS / name).read_text())

    def test_reconnect_command_matches_v1_schema():
        validate(
            {
                "type": "RECONNECT",
                "version": 1,
                "roomCode": "AB7K2",
                "playerToken": "t" * 32,
            },
            load_schema("protocol.schema.json"),
        )

    def test_ready_command_requires_boolean_ready():
        with pytest.raises(ValidationError):
            validate(
                {
                    "type": "PLAYER_READY",
                    "version": 1,
                    "ready": "yes",
                    "requestId": "req-1",
                },
                load_schema("protocol.schema.json"),
            )

    def test_server_sync_has_state_version():
        validate(
            {
                "type": "GAME_STATE_SYNC",
                "version": 1,
                "roomCode": "AB7K2",
                "stateVersion": 3,
                "eventId": "evt-1",
                "serverTime": "2026-09-14T18:30:00Z",
                "payload": {"room": {}},
            },
            load_schema("server-events.schema.json"),
        )

Run:

    uv run --project backend pytest backend/tests/test_protocol_schemas.py -q

Expected: FAIL because the schemas do not exist.

- [ ] **Step 2: Define the JSON schemas**

Create contracts/v1/protocol.schema.json using draft 2020-12. It must use oneOf for RECONNECT, PLAYER_READY, and START_GAME; set additionalProperties to false; limit roomCode to ^[A-Z2-9]{5}$; require version = 1; and require requestId for mutating commands.

The core definitions must be equivalent to:

    {
      "$defs": {
        "roomCode": {
          "type": "string",
          "pattern": "^[A-Z2-9]{5}$"
        },
        "requestId": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64
        },
        "reconnect": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "version", "roomCode", "playerToken"],
          "properties": {
            "type": {"const": "RECONNECT"},
            "version": {"const": 1},
            "roomCode": {"$ref": "#/$defs/roomCode"},
            "playerToken": {"type": "string", "minLength": 32, "maxLength": 256}
          }
        },
        "playerReady": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "version", "ready", "requestId"],
          "properties": {
            "type": {"const": "PLAYER_READY"},
            "version": {"const": 1},
            "ready": {"type": "boolean"},
            "requestId": {"$ref": "#/$defs/requestId"}
          }
        },
        "startGame": {
          "type": "object",
          "additionalProperties": false,
          "required": ["type", "version", "requestId"],
          "properties": {
            "type": {"const": "START_GAME"},
            "version": {"const": 1},
            "requestId": {"$ref": "#/$defs/requestId"}
          }
        }
      }
    }

Create contracts/v1/server-events.schema.json with definitions for PLAYER_JOINED, PLAYER_LEFT, PLAYER_RECONNECTED, PLAYER_READY, GAME_STARTED, GAME_STATE_SYNC, and ERROR. Every event requires type, version = 1, roomCode, eventId, serverTime, stateVersion, and payload. ERROR additionally requires code and message inside payload and may include requestId.

Document the event payloads, reservation semantics, public/private field boundary, and the fact that future game/social commands are reserved for later phases in contracts/v1/README.md.

- [ ] **Step 3: Implement equivalent Pydantic models**

Create backend/app/schemas/rooms.py with:

    PlayerColor = Literal["green", "red", "blue", "yellow", "purple", "orange"]
    PlayerCount = Literal[4, 5, 6]

    class CreateRoomRequest(BaseModel):
        display_name: str = Field(alias="displayName", min_length=2, max_length=20)
        player_count: PlayerCount = Field(alias="playerCount")
        color: PlayerColor | None = None

    class JoinRoomRequest(BaseModel):
        display_name: str = Field(alias="displayName", min_length=2, max_length=20)
        color: PlayerColor | None = None

    class RoomCredentials(BaseModel):
        room_code: str = Field(alias="roomCode")
        player_id: str = Field(alias="playerId")
        player_token: str = Field(alias="playerToken")
        is_host: bool = Field(alias="isHost")
        ws_path: str = Field(alias="wsPath")

Import ConfigDict from pydantic and use model_config = ConfigDict(populate_by_name=True) on each model or a shared base model. Never serialize playerToken in public room state.

Create backend/app/schemas/websocket.py with a discriminated union keyed by type:

    class ReconnectCommand(BaseModel):
        type: Literal["RECONNECT"]
        version: Literal[1] = 1
        room_code: str = Field(alias="roomCode")
        player_token: str = Field(alias="playerToken", min_length=32, max_length=256)

    class PlayerReadyCommand(BaseModel):
        type: Literal["PLAYER_READY"]
        version: Literal[1] = 1
        ready: bool
        request_id: str = Field(alias="requestId", min_length=1, max_length=64)

    class StartGameCommand(BaseModel):
        type: Literal["START_GAME"]
        version: Literal[1] = 1
        request_id: str = Field(alias="requestId", min_length=1, max_length=64)

    ClientMessage = Annotated[
        ReconnectCommand | PlayerReadyCommand | StartGameCommand,
        Field(discriminator="type"),
    ]

Add typed event payload models and a helper type for public room state. Configure aliases so model_dump(by_alias=True) always emits camelCase.

- [ ] **Step 4: Add matching TypeScript types**

Create frontend/src/types/game.ts:

    export type PlayerColor =
      | "green"
      | "red"
      | "blue"
      | "yellow"
      | "purple"
      | "orange";

    export type RoomStatus = "lobby" | "playing" | "finished";

    export type PublicPlayer = {
      id: string;
      displayName: string;
      color: PlayerColor;
      seatIndex: number;
      isHost: boolean;
      isReady: boolean;
      isConnected: boolean;
      reservationExpiresAt: string | null;
    };

    export type PublicRoomState = {
      roomCode: string;
      status: RoomStatus;
      maxPlayers: 4 | 5 | 6;
      hostPlayerId: string;
      players: PublicPlayer[];
      stateVersion: number;
    };

Create frontend/src/types/protocol.ts with:

    export type ClientCommand =
      | {
          type: "RECONNECT";
          version: 1;
          roomCode: string;
          playerToken: string;
        }
      | {
          type: "PLAYER_READY";
          version: 1;
          ready: boolean;
          requestId: string;
        }
      | {
          type: "START_GAME";
          version: 1;
          requestId: string;
        };

    export type ServerEvent =
      | ServerEventEnvelope<"PLAYER_JOINED", { player: PublicPlayer }>
      | ServerEventEnvelope<"PLAYER_LEFT", { playerId: string; reservationExpiresAt: string }>
      | ServerEventEnvelope<"PLAYER_RECONNECTED", { player: PublicPlayer }>
      | ServerEventEnvelope<"PLAYER_READY", { playerId: string; ready: boolean }>
      | ServerEventEnvelope<"GAME_STARTED", { status: "playing" }>
      | ServerEventEnvelope<"GAME_STATE_SYNC", { room: PublicRoomState }>
      | ServerEventEnvelope<"ERROR", { code: string; message: string }>;

    export type ServerEventEnvelope<T extends string, P> = {
      type: T;
      version: 1;
      roomCode: string;
      stateVersion: number;
      eventId: string;
      serverTime: string;
      requestId?: string;
      payload: P;
    };

Keep future game and social event names in the contract documentation but do not add client behavior for them in this phase.

- [ ] **Step 5: Run contract tests and commit**

Run:

    uv run --project backend pytest backend/tests/test_protocol_schemas.py -q
    pnpm frontend:typecheck

Expected: PASS. Then commit only the contract/schema/type files:

    git add Projects/Parchis_teleton/contracts Projects/Parchis_teleton/backend/app/schemas Projects/Parchis_teleton/backend/tests/test_protocol_schemas.py Projects/Parchis_teleton/frontend/src/types
    git commit -m "feat: add versioned room protocol contracts"

### Task 3: Room domain and in-memory repository

**Files:**
- Create: backend/app/game/models.py
- Create: backend/app/repositories/room_repository.py
- Create: backend/app/repositories/memory_room_repository.py
- Create: backend/tests/test_domain_models.py
- Create: backend/tests/test_repository.py
- Modify: backend/tests/conftest.py

**Interfaces:**
- Produces internal dataclasses RoomState, PlayerState, SessionIdentity, RoomCredentialData, and RoomChange.
- Produces RoomRepository protocol with async create, get, save, delete, and list operations.
- Produces MemoryRoomRepository implementing RoomRepository.
- Produces deterministic constructor injection for code generator, token generator, clock, and reservation TTL.

- [ ] **Step 1: Write failing repository and domain tests**

Create backend/tests/test_domain_models.py:

    def test_new_room_starts_in_lobby_with_zero_state_version():
        room = RoomState(
            room_code="AB7K2",
            max_players=4,
            host_player_id="p1",
            players=[],
        )

        assert room.status == "lobby"
        assert room.state_version == 0
        assert room.processed_changes == {}

Create backend/tests/test_repository.py:

    @pytest.mark.asyncio
    async def test_repository_round_trips_and_deletes_room(room_repository, room):
        await room_repository.create(room)
        assert await room_repository.get(room.room_code) is room

        room.state_version = 1
        await room_repository.save(room)
        assert (await room_repository.get(room.room_code)).state_version == 1

        await room_repository.delete(room.room_code)
        assert await room_repository.get(room.room_code) is None

    @pytest.mark.asyncio
    async def test_repository_returns_none_for_unknown_code(room_repository):
        assert await room_repository.get("AB7K2") is None

Run:

    uv run --project backend pytest backend/tests/test_domain_models.py backend/tests/test_repository.py -q

Expected: FAIL because the domain and repository do not exist.

- [ ] **Step 2: Define domain dataclasses and enums**

Create backend/app/game/models.py with slots-based dataclasses:

    PlayerColor = Literal["green", "red", "blue", "yellow", "purple", "orange"]

    @dataclass(slots=True)
    class PlayerState:
        id: str
        display_name: str
        color: PlayerColor
        seat_index: int
        is_host: bool
        token_hash: str = field(repr=False)
        is_ready: bool = False
        is_connected: bool = False
        has_connected: bool = False
        reservation_expires_at: datetime | None = None

    @dataclass(frozen=True, slots=True)
    class SessionIdentity:
        room_code: str
        player_id: str

    @dataclass(slots=True)
    class RoomChange:
        state: "RoomState"
        event_type: str
        payload: dict[str, object]
        request_id: str | None = None

    @dataclass(slots=True)
    class RoomState:
        room_code: str
        max_players: Literal[4, 5, 6]
        host_player_id: str
        players: list[PlayerState]
        status: Literal["lobby", "playing", "finished"] = "lobby"
        state_version: int = 0
        created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
        processed_changes: OrderedDict[tuple[str, str], RoomChange] = field(
            default_factory=OrderedDict,
            repr=False,
        )

    @dataclass(frozen=True, slots=True)
    class RoomCredentialData:
        room_code: str
        player_id: str
        player_token: str
        is_host: bool
        ws_path: str

    @dataclass(frozen=True, slots=True)
    class AuthenticatedSession:
        identity: SessionIdentity
        is_reconnect: bool

Import Literal, OrderedDict, datetime, and timezone. Use UTC-aware datetime values. Keep token_hash internal and exclude it from all public serializers.

- [ ] **Step 3: Define and implement the repository**

Create backend/app/repositories/room_repository.py:

    class RoomRepository(Protocol):
        async def create(self, room: RoomState) -> None:
            raise NotImplementedError
        async def get(self, room_code: str) -> RoomState | None:
            raise NotImplementedError
        async def save(self, room: RoomState) -> None:
            raise NotImplementedError
        async def delete(self, room_code: str) -> None:
            raise NotImplementedError
        async def list_rooms(self) -> list[RoomState]:
            raise NotImplementedError

Create backend/app/repositories/memory_room_repository.py with an asyncio.Lock around its dictionary. Return room state only through the service boundary; RoomManager owns the per-room mutation lock and the repository does not invent game rules.

Add backend/tests/conftest.py fixtures for MemoryRoomRepository, a controllable clock, a sample RoomState named room, deterministic code/token factories, and RoomManager. The deterministic code factory must return AB7K2 for the first room and request the next code on collision.

- [ ] **Step 4: Run the focused tests**

Run:

    uv run --project backend pytest backend/tests/test_domain_models.py backend/tests/test_repository.py -q

Expected: PASS for the dataclasses and repository round-trip; RoomManager is not part of this task.

- [ ] **Step 5: Commit the domain foundation**

Run:

    git add Projects/Parchis_teleton/backend/app/game Projects/Parchis_teleton/backend/app/repositories Projects/Parchis_teleton/backend/tests/conftest.py Projects/Parchis_teleton/backend/tests/test_domain_models.py Projects/Parchis_teleton/backend/tests/test_repository.py
    git commit -m "feat: add in-memory room domain"

### Task 4: RoomManager admission, readiness and reconnection

**Files:**
- Create: backend/app/services/room_manager.py
- Modify: backend/app/game/models.py
- Modify: backend/app/schemas/rooms.py
- Modify: backend/tests/test_room_manager.py

**Interfaces:**
- Consumes RoomRepository, RoomState, PlayerState, SessionIdentity, and the v1 room schemas.
- Produces async create_room(display_name, player_count, color) -> RoomCredentialData.
- Produces async join_room(room_code, display_name, color) -> RoomCredentialData.
- Produces async get_room(room_code) -> RoomState.
- Produces async public_room(room_code) -> dict.
- Produces public_room_from_state(state) -> dict.
- Produces async authenticate(room_code, player_token) -> AuthenticatedSession.
- Produces async disconnect(session) -> RoomChange.
- Produces async set_ready(session, ready, request_id) -> RoomChange.
- Produces async start_game(session, request_id) -> RoomChange.

- [ ] **Step 1: Write failing admission and reconnection tests**

Add tests with the fixture manager:

    @pytest.mark.asyncio
    async def test_join_assigns_first_available_color_and_seat(room_manager):
        host = await room_manager.create_room("Host", 4, "green")
        guest = await room_manager.join_room(host.room_code, "Guest", None)
        room = await room_manager.get_room(host.room_code)

        assert guest.player_id != host.player_id
        assert room.players[1].seat_index == 1
        assert room.players[1].color == "red"

    @pytest.mark.asyncio
    async def test_join_rejects_duplicate_name_and_color(room_manager):
        host = await room_manager.create_room("Host", 4, "green")

        with pytest.raises(RoomError) as duplicate_name:
            await room_manager.join_room(host.room_code, "host", "red")
        assert duplicate_name.value.code == "INVALID_NAME"

        with pytest.raises(RoomError) as duplicate_color:
            await room_manager.join_room(host.room_code, "Guest", "green")
        assert duplicate_color.value.code == "COLOR_UNAVAILABLE"

    @pytest.mark.asyncio
    async def test_disconnect_reserves_seat_and_authenticate_reconnects(room_manager):
        host = await room_manager.create_room("Host", 4, "green")
        session = await room_manager.authenticate(host.room_code, host.player_token)

        await room_manager.disconnect(session)
        room = await room_manager.get_room(host.room_code)
        assert room.players[0].is_connected is False
        assert room.players[0].reservation_expires_at is not None

        reconnected = await room_manager.authenticate(host.room_code, host.player_token)
        assert reconnected.identity == session.identity
        assert (await room_manager.get_room(host.room_code)).players[0].is_connected is True

    @pytest.mark.asyncio
    async def test_expired_reservation_frees_seat(room_manager, clock):
        host = await room_manager.create_room("Host", 4, "green")
        session = await room_manager.authenticate(host.room_code, host.player_token)
        await room_manager.disconnect(session)

        clock.advance(seconds=601)
        await room_manager.prune_expired_reservations(host.room_code)

        with pytest.raises(RoomError) as missing:
            await room_manager.authenticate(host.room_code, host.player_token)
        assert missing.value.code == "UNAUTHENTICATED"

    @pytest.mark.asyncio
    async def test_expired_host_reservation_transfers_host(room_manager, clock):
        host = await room_manager.create_room("Host", 4, "green")
        guest = await room_manager.join_room(host.room_code, "Guest", "red")
        host_session = await room_manager.authenticate(host.room_code, host.player_token)
        await room_manager.authenticate(guest.room_code, guest.player_token)
        await room_manager.disconnect(host_session)

        clock.advance(seconds=601)
        await room_manager.prune_expired_reservations(host.room_code)
        room = await room_manager.get_room(host.room_code)

        assert room.host_player_id == guest.player_id
        assert room.players[0].id == guest.player_id
        assert room.players[0].is_host is True

    @pytest.mark.asyncio
    async def test_start_requires_full_ready_room_and_host(room_manager):
        host = await room_manager.create_room("Host", 4, "green")
        players = [host]
        for name, color in [("P2", "red"), ("P3", "blue"), ("P4", "yellow")]:
            players.append(await room_manager.join_room(host.room_code, name, color))

        with pytest.raises(RoomError) as not_ready:
            await room_manager.start_game(
                SessionIdentity(host.room_code, host.player_id),
                "start-1",
            )
        assert not_ready.value.code == "PLAYER_NOT_READY"

        for credentials in players:
            await room_manager.set_ready(
                SessionIdentity(credentials.room_code, credentials.player_id),
                True,
                f"ready-{credentials.player_id}",
            )

        change = await room_manager.start_game(
            SessionIdentity(host.room_code, host.player_id),
            "start-2",
        )
        assert change.event_type == "GAME_STARTED"
        assert change.state.status == "playing"

Run:

    uv run --project backend pytest backend/tests/test_room_manager.py -q

Expected: FAIL because RoomManager and RoomError do not exist.

- [ ] **Step 2: Implement validation and token utilities inside the service boundary**

In backend/app/services/room_manager.py:

    ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    PLAYER_COLORS = ("green", "red", "blue", "yellow", "purple", "orange")

    class RoomError(Exception):
        def __init__(self, code: str, message: str):
            super().__init__(message)
            self.code = code
            self.message = message

    def hash_player_token(player_token: str) -> str:
        return hashlib.sha256(player_token.encode("utf-8")).hexdigest()

    def tokens_match(expected_hash: str, supplied_token: str) -> bool:
        return hmac.compare_digest(expected_hash, hash_player_token(supplied_token))

Use secrets.token_urlsafe(32) for player tokens. Generate room codes from the approved alphabet and check repository uniqueness before storing. Normalize names with strip and casefold for duplicate checks, but preserve the trimmed display name.

- [ ] **Step 3: Implement serialized room mutations**

RoomManager keeps a dictionary of asyncio.Lock objects keyed by room code. Every create/join/read-modify-save/ready/start/disconnect/authenticate operation must use the relevant room lock. Create a fresh lock on room creation and remove it only after the room is deleted.

Implement the exact signatures from the Interfaces block. Validate room code, capacity, name length, duplicate names, selected color, status, token, and reservation expiry. On first authenticate set has_connected = true and is_connected = true. On reconnect within the reservation set is_connected = true and clear reservation_expires_at.

The first available color follows PLAYER_COLORS and the first available seat is the lowest seat_index. A new player cannot displace a disconnected player while that player’s reservation is valid.

- [ ] **Step 4: Implement ready, start, disconnect and public serialization**

set_ready validates the authenticated player and lobby status, updates is_ready, increments state_version, and returns PLAYER_READY with playerId and ready.

start_game validates host identity, exact player count, all players connected, all players ready, and lobby status. It changes status to playing, increments state_version, and returns GAME_STARTED with status = playing. It does not create a board or pieces in Fase 1.

disconnect sets is_connected = false, is_ready = false, and reservation_expires_at = clock() + reservation_ttl_seconds. It returns PLAYER_LEFT with playerId and reservationExpiresAt. authenticate after this returns an AuthenticatedSession with a flag that distinguishes first connection from reconnection.

public_room must return only roomCode, status, maxPlayers, hostPlayerId, players without token_hash, and stateVersion. Use UTC ISO 8601 strings for reservationExpiresAt.

Track up to 128 requestIds per room in processed_changes, keyed by playerId and requestId. Store an immutable or deep-copied RoomChange so later mutations cannot alter the cached response. A repeated requestId from the same authenticated player must return the previously produced RoomChange without incrementing state_version a second time.

- [ ] **Step 5: Run all RoomManager tests and commit**

Run:

    uv run --project backend pytest backend/tests/test_room_manager.py -q

Expected: PASS, including the 4/5/6 parameterization, duplicate validation, TTL, host transfer, host start, request idempotency, and token reconnection tests.

Commit:

    git add Projects/Parchis_teleton/backend/app/services/room_manager.py Projects/Parchis_teleton/backend/app/game/models.py Projects/Parchis_teleton/backend/app/schemas/rooms.py Projects/Parchis_teleton/backend/tests/test_room_manager.py
    git commit -m "feat: implement room admission and reconnection"

### Task 5: REST room API

**Files:**
- Create: backend/app/api/rooms.py
- Modify: backend/app/main.py
- Modify: backend/app/config.py
- Create: backend/app/security/rate_limit.py
- Create: backend/tests/test_rooms_api.py
- Create: backend/tests/test_rate_limit.py

**Interfaces:**
- Produces POST /api/rooms -> RoomCredentials.
- Produces POST /api/rooms/{roomCode}/join -> RoomCredentials.
- Produces GET /api/rooms/{roomCode} -> public room state.
- Maps RoomError codes to stable HTTP JSON errors.

- [ ] **Step 1: Write failing API tests**

Create backend/tests/test_rooms_api.py:

    from fastapi.testclient import TestClient

    def test_create_room_returns_credentials(client):
        response = client.post(
            "/api/rooms",
            json={"displayName": "Host", "playerCount": 4, "color": "green"},
        )

        assert response.status_code == 201
        body = response.json()
        assert body["roomCode"] == "AB7K2"
        assert body["playerId"]
        assert body["playerToken"]
        assert body["isHost"] is True
        assert body["wsPath"] == "/api/ws/rooms/AB7K2"

    def test_join_room_returns_credentials_without_exposing_existing_tokens(client):
        created = client.post(
            "/api/rooms",
            json={"displayName": "Host", "playerCount": 4, "color": "green"},
        ).json()

        joined = client.post(
            f"/api/rooms/{created['roomCode']}/join",
            json={"displayName": "Guest", "color": "red"},
        )

        assert joined.status_code == 201
        public = client.get(f"/api/rooms/{created['roomCode']}")
        assert public.status_code == 200
        assert "playerToken" not in public.text

    def test_join_unknown_room_returns_structured_error(client):
        response = client.post(
            "/api/rooms/ZZZZZ/join",
            json={"displayName": "Guest"},
        )

        assert response.status_code == 404
        assert response.json()["code"] == "ROOM_NOT_FOUND"

Create backend/tests/test_rate_limit.py:

    def test_fixed_window_allows_twenty_requests_and_resets_after_sixty_seconds(clock):
        limiter = FixedWindowRateLimiter(limit=20, window_seconds=60, clock=clock)

        assert [limiter.allow("127.0.0.1") for _ in range(20)] == [True] * 20
        assert limiter.allow("127.0.0.1") is False

        clock.advance(seconds=60)
        assert limiter.allow("127.0.0.1") is True

Run:

    uv run --project backend pytest backend/tests/test_rooms_api.py backend/tests/test_rate_limit.py -q

Expected: FAIL because routes are not registered.

- [ ] **Step 2: Implement route schemas and error mapping**

Create backend/app/api/rooms.py with an APIRouter using prefix /api/rooms and tags ["rooms"]. Define POST /api/rooms with response_model RoomCredentials and status 201. Pass display_name, player_count, and color from CreateRoomRequest to RoomManager.create_room. Define POST /{room_code}/join with JoinRoomRequest, response_model RoomCredentials, and status 201. Define GET /{room_code} returning manager.public_room.

Catch RoomError and return JSON with code and message. Use 404 for ROOM_NOT_FOUND, 409 for ROOM_FULL, COLOR_UNAVAILABLE, ROOM_ALREADY_STARTED, and INVALID_NAME, and 400 for malformed room codes or other service validation errors. FastAPI/Pydantic validation errors keep their normal 422 response.

Create backend/app/security/rate_limit.py with an in-memory fixed-window limiter keyed by client host. Limit room create/join attempts to ROOM_REQUESTS_PER_MINUTE = 20 per 60-second window and raise RoomError with RATE_LIMITED when the limit is exceeded. The failing unit test is in test_rate_limit.py; wire the limiter into both room routes and add one API test in test_rooms_api.py that sends 21 requests from the same TestClient host and expects HTTP 429. Do not apply this limiter to WebSocket social events, which are outside Fase 1.

Use one app-scoped MemoryRoomRepository and RoomManager instance for the local process. Expose get_room_manager through a dependency function so tests can override it. The test client fixture must install a fresh deterministic manager per test and clear dependency overrides after yielding.

- [ ] **Step 3: Register routes and configure CORS**

Update backend/app/main.py to include rooms.router and configure CORSMiddleware from CORS_ORIGINS. Keep /health unchanged. Do not create a database connection or require Redis.

- [ ] **Step 4: Run API tests and commit**

Run:

    uv run --project backend pytest backend/tests/test_rooms_api.py backend/tests/test_rate_limit.py -q
    uv run --project backend pytest -q

Expected: PASS. Commit:

    git add Projects/Parchis_teleton/backend/app/api Projects/Parchis_teleton/backend/app/main.py Projects/Parchis_teleton/backend/app/config.py Projects/Parchis_teleton/backend/app/security/rate_limit.py Projects/Parchis_teleton/backend/tests/test_rooms_api.py Projects/Parchis_teleton/backend/tests/test_rate_limit.py
    git commit -m "feat: add room HTTP API"

### Task 6: WebSocket connection manager and event envelopes

**Files:**
- Create: backend/app/realtime/connection_manager.py
- Create: backend/app/realtime/events.py
- Create: backend/tests/test_connection_manager.py

**Interfaces:**
- Produces ClientConnection with websocket and SessionIdentity.
- Produces ConnectionManager:
  - async add(room_code, connection) -> None
  - async remove(room_code, player_id) -> None
  - async broadcast(room_code, event, exclude_player_id=None) -> None
  - async send(connection, event) -> None
  - connected_player_ids(room_code) -> set[str]
- Produces make_event(type, room_code, state_version, payload, request_id=None) -> dict.

- [ ] **Step 1: Write failing manager and envelope tests**

Create backend/tests/test_connection_manager.py:

    @pytest.mark.asyncio
    async def test_broadcast_sends_only_to_connections_in_room(manager, sockets):
        first = ClientConnection(sockets[0], SessionIdentity("AB7K2", "p1"))
        second = ClientConnection(sockets[1], SessionIdentity("CD3K4", "p2"))
        await manager.add("AB7K2", first)
        await manager.add("CD3K4", second)

        event = make_event(
            "PLAYER_READY",
            "AB7K2",
            2,
            {"playerId": "p1", "ready": True},
        )
        await manager.broadcast("AB7K2", event)

        sockets[0].send_json.assert_awaited_once_with(event)
        sockets[1].send_json.assert_not_awaited()

    def test_event_envelope_uses_wire_names_and_version():
        event = make_event("GAME_STATE_SYNC", "AB7K2", 3, {"room": {}})

        assert event["type"] == "GAME_STATE_SYNC"
        assert event["version"] == 1
        assert event["roomCode"] == "AB7K2"
        assert event["stateVersion"] == 3
        assert event["eventId"]
        assert event["serverTime"].endswith("Z")

Run:

    uv run --project backend pytest backend/tests/test_connection_manager.py -q

Expected: FAIL because the manager and event factory do not exist.

- [ ] **Step 2: Implement event creation**

Create backend/app/realtime/events.py. Generate eventId with uuid4, serverTime as a UTC ISO 8601 string ending in Z, and always include version = 1, roomCode, stateVersion, and payload. Include requestId only when provided.

Use the event names and payload shapes from contracts/v1/server-events.schema.json. Do not place tokens or internal PlayerState fields in event payloads.

- [ ] **Step 3: Implement room-scoped connection management**

Create backend/app/realtime/connection_manager.py with a dictionary room_code -> player_id -> ClientConnection and a lock for the dictionary. broadcast must snapshot the target connections before awaiting sends so a disconnect cannot mutate the iteration. Catch WebSocketDisconnect or send failures, remove the failed connection, and let the endpoint perform the domain disconnect.

Keep ConnectionManager unaware of RoomManager and game rules. It only sends already validated event dictionaries.

- [ ] **Step 4: Run focused tests and commit**

Run:

    uv run --project backend pytest backend/tests/test_connection_manager.py -q

Expected: PASS. Commit:

    git add Projects/Parchis_teleton/backend/app/realtime Projects/Parchis_teleton/backend/tests/test_connection_manager.py
    git commit -m "feat: add room websocket connection manager"

### Task 7: WebSocket handshake and lobby command routing

**Files:**
- Create: backend/app/services/command_router.py
- Create: backend/app/api/websocket.py
- Modify: backend/app/main.py
- Modify: backend/app/realtime/events.py
- Create: backend/tests/test_websocket_flow.py

**Interfaces:**
- Produces WS /api/ws/rooms/{room_code}.
- Accepts RECONNECT as the first message.
- Accepts PLAYER_READY and START_GAME after authentication.
- Sends PLAYER_JOINED or PLAYER_RECONNECTED, PLAYER_LEFT, PLAYER_READY, GAME_STARTED, GAME_STATE_SYNC, and ERROR.
- Never accepts a client-supplied playerId or dice value as authority.

- [ ] **Step 1: Write failing end-to-end WebSocket tests**

Create backend/tests/test_websocket_flow.py with a helper:

    def reconnect_message(room_code: str, token: str) -> dict:
        return {
            "type": "RECONNECT",
            "version": 1,
            "roomCode": room_code,
            "playerToken": token,
        }

Add tests that:

1. Create a room with POST, connect a socket, send the handshake, and receive GAME_STATE_SYNC containing the host.
2. Connect a second player and assert the first socket receives PLAYER_JOINED and then a snapshot containing two players.
3. Send PLAYER_READY from the authenticated socket and assert all connected sockets receive PLAYER_READY plus GAME_STATE_SYNC.
4. Send an invalid token and assert the socket closes with an authentication failure without exposing room state.
5. Send START_GAME from a non-host or before the room is full/ready and assert ERROR with NOT_HOST, INSUFFICIENT_PLAYERS, or PLAYER_NOT_READY.
6. Fill a four-player room, mark all ready, start as host, and assert GAME_STARTED with status playing.
7. Close one socket, reconnect with the same playerToken, and assert PLAYER_RECONNECTED plus GAME_STATE_SYNC preserve the same playerId and seatIndex.

Use FastAPI TestClient websocket_connect and nested contexts so all sockets share the same app-scoped RoomManager. Add a receive_until helper that ignores events until it finds the requested type and fails after 20 messages.

Run:

    uv run --project backend pytest backend/tests/test_websocket_flow.py -q

Expected: FAIL because the WebSocket route is not registered.

- [ ] **Step 2: Implement the command router**

Create backend/app/services/command_router.py with a frozen CommandContext containing SessionIdentity and room_code, and a CommandRouter.handle(context, message) method returning list[RoomChange]. Parse the first message as ReconnectCommand. After authentication, parse subsequent messages as PlayerReadyCommand or StartGameCommand. Use Pydantic validation and convert failures into ERROR with INVALID_MESSAGE. Call RoomManager for every mutation; the router must not inspect or modify PlayerState directly.

For a repeated requestId, RoomManager returns the cached RoomChange and the router broadcasts it without incrementing state_version.

- [ ] **Step 3: Implement the WebSocket lifecycle**

Create backend/app/api/websocket.py with a WebSocket route at /api/ws/rooms/{room_code}. The endpoint must:

1. Reject messages larger than MAX_WEBSOCKET_MESSAGE_BYTES before parsing.
2. Require RECONNECT as the first command.
3. Verify payload roomCode equals the URL room_code.
4. Authenticate playerToken through RoomManager.
5. Add ClientConnection to ConnectionManager.
6. Broadcast PLAYER_JOINED on first connection or PLAYER_RECONNECTED after a valid reservation.
7. Send GAME_STATE_SYNC with public_room to all clients after presence changes.
8. Route PLAYER_READY and START_GAME mutations, then broadcast their semantic event and a fresh snapshot.
9. Return ERROR for malformed or unsupported commands without mutating state.
10. On WebSocketDisconnect, remove the socket, call RoomManager.disconnect, broadcast PLAYER_LEFT and a fresh snapshot.

Use a helper named broadcast_change(change: RoomChange) that creates the semantic event with make_event, broadcasts it, creates GAME_STATE_SYNC from public_room_from_state, and broadcasts the snapshot. Do not send tokenHash, playerToken, internal locks, or request caches in the snapshot.

- [ ] **Step 4: Register the route and verify the complete backend**

Include websocket.router in backend/app/main.py. Run:

    uv run --project backend pytest backend/tests/test_websocket_flow.py -q
    uv run --project backend pytest -q

Expected: PASS for handshake, presence, ready, host/start validation, snapshot synchronization, message validation, and reconnection.

- [ ] **Step 5: Commit the WebSocket lobby**

Run:

    git add Projects/Parchis_teleton/backend/app/services/command_router.py Projects/Parchis_teleton/backend/app/api/websocket.py Projects/Parchis_teleton/backend/app/main.py Projects/Parchis_teleton/backend/app/realtime/events.py Projects/Parchis_teleton/backend/tests/test_websocket_flow.py
    git commit -m "feat: add authenticated lobby websockets"

### Task 8: Frontend session, store and WebSocket client

**Files:**
- Create: frontend/src/lib/session.ts
- Create: frontend/src/lib/websocket.ts
- Create: frontend/src/lib/api.ts
- Create: frontend/src/stores/gameStore.ts
- Create: frontend/src/stores/gameStore.test.ts
- Create: frontend/src/hooks/useGameSocket.ts
- Modify: frontend/src/types/game.ts
- Modify: frontend/src/types/protocol.ts

**Interfaces:**
- Produces session functions saveSession(session) -> void, readSession(roomCode) -> RoomSession | null, and clearSession(roomCode) -> void.
- Produces REST functions createRoom(payload), joinRoom(code, payload), and getRoom(code).
- Produces createRoomSocket(origin, roomCode) -> WebSocket.
- Produces Zustand actions applyEvent, setSession, setConnectionState, setError, and reset.

- [ ] **Step 1: Write failing store and session tests**

Create frontend/src/stores/gameStore.test.ts:

    import { beforeEach, describe, expect, it } from "vitest";
    import type { ServerEvent } from "@/types/protocol";
    import { useGameStore } from "./gameStore";

    const syncEvent = (stateVersion: number): ServerEvent => ({
      type: "GAME_STATE_SYNC",
      version: 1,
      roomCode: "AB7K2",
      stateVersion,
      eventId: "evt-" + stateVersion,
      serverTime: "2026-09-14T18:30:00Z",
      payload: {
        room: {
          roomCode: "AB7K2",
          status: "lobby",
          maxPlayers: 4,
          hostPlayerId: "p1",
          players: [],
          stateVersion,
        },
      },
    });

    describe("game store", () => {
      beforeEach(() => {
        useGameStore.getState().reset();
      });

      it("hydrates the room from GAME_STATE_SYNC", () => {
        useGameStore.getState().applyEvent({
          type: "GAME_STATE_SYNC",
          version: 1,
          roomCode: "AB7K2",
          stateVersion: 2,
          eventId: "evt-1",
          serverTime: "2026-09-14T18:30:00Z",
          payload: {
            room: {
              roomCode: "AB7K2",
              status: "lobby",
              maxPlayers: 4,
              hostPlayerId: "p1",
              players: [],
              stateVersion: 2,
            },
          },
        });

        expect(useGameStore.getState().room?.roomCode).toBe("AB7K2");
        expect(useGameStore.getState().lastStateVersion).toBe(2);
      });

      it("ignores an older state snapshot", () => {
        useGameStore.getState().applyEvent(syncEvent(4));
        useGameStore.getState().applyEvent(syncEvent(3));

        expect(useGameStore.getState().lastStateVersion).toBe(4);
      });
    });

Session tests must verify key format parchis:session:v1:<roomCode>, round-trip data, malformed JSON cleanup, and no browser-global access during server rendering.

Run:

    pnpm frontend:test

Expected: FAIL because store and protocol reducer do not exist.

- [ ] **Step 2: Implement session and REST helpers**

Create frontend/src/lib/session.ts:

    export type RoomSession = {
      roomCode: string;
      playerId: string;
      playerToken: string;
      isHost: boolean;
    };

    const sessionKey = (roomCode: string) =>
      "parchis:session:v1:" + roomCode;

    export function saveSession(session: RoomSession): void {
      if (typeof window === "undefined") return;
      window.localStorage.setItem(sessionKey(session.roomCode), JSON.stringify(session));
    }

    export function readSession(roomCode: string): RoomSession | null {
      if (typeof window === "undefined") return null;
      const raw = window.localStorage.getItem(sessionKey(roomCode));
      if (!raw) return null;
      try {
        return JSON.parse(raw) as RoomSession;
      } catch {
        window.localStorage.removeItem(sessionKey(roomCode));
        return null;
      }
    }

    export function clearSession(roomCode: string): void {
      if (typeof window === "undefined") return;
      window.localStorage.removeItem(sessionKey(roomCode));
    }

Validate the parsed object has roomCode, playerId, playerToken, and isHost before returning it; malformed or incomplete data must be removed and return null.

Create frontend/src/lib/api.ts using NEXT_PUBLIC_API_ORIGIN and fetch. Implement typed createRoom, joinRoom, and getRoom. Parse non-2xx responses into { code, message } and never silently return an empty room.

- [ ] **Step 3: Implement the Zustand store**

Create frontend/src/stores/gameStore.ts:

    export type ConnectionState =
      | "idle"
      | "connecting"
      | "connected"
      | "reconnecting"
      | "disconnected"
      | "error";

    type GameStore = {
      room: PublicRoomState | null;
      session: RoomSession | null;
      connectionState: ConnectionState;
      lastError: { code: string; message: string } | null;
      lastStateVersion: number;
      recentEvents: ServerEvent[];
      setSession: (session: RoomSession) => void;
      setConnectionState: (state: ConnectionState) => void;
      applyEvent: (event: ServerEvent) => void;
      setError: (error: { code: string; message: string } | null) => void;
      reset: () => void;
    };

applyEvent must replace room only when event.stateVersion >= lastStateVersion. PLAYER_JOINED, PLAYER_LEFT, PLAYER_RECONNECTED, PLAYER_READY, and GAME_STARTED may update the current public room from their payload, but GAME_STATE_SYNC is the canonical replacement. Keep social events and local audio preferences out of Fase 1.

- [ ] **Step 4: Implement the WebSocket adapter and hook**

Create frontend/src/lib/websocket.ts:

    export function createRoomSocket(
      apiOrigin: string,
      roomCode: string,
    ): WebSocket {
      const url = new URL("/api/ws/rooms/" + roomCode, apiOrigin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return new WebSocket(url.toString());
    }

Create frontend/src/hooks/useGameSocket.ts. It must:

- Read the session for the route roomCode.
- Create one socket and send RECONNECT after onopen.
- Add requestId to mutating commands using crypto.randomUUID().
- Set connecting/reconnecting/disconnected/error in the store.
- Apply each parsed ServerEvent to the store.
- Retry with delays 500ms, 1000ms, 2000ms, 4000ms, and then 5000ms repeatedly.
- Stop retries on unmount.
- Not retry an authentication ERROR until the user explicitly rejoins.
- Expose sendReady(ready) and sendStartGame() only; do not expose move/dice/social commands in this phase.

Validate incoming event shape with Zod or a narrow runtime guard before calling applyEvent. A malformed server message sets INVALID_MESSAGE locally and does not replace room state.

- [ ] **Step 5: Run frontend checks and commit**

Run:

    pnpm frontend:test
    pnpm frontend:typecheck

Expected: PASS, including stale snapshot rejection and session persistence. Commit:

    git add Projects/Parchis_teleton/frontend/src/lib Projects/Parchis_teleton/frontend/src/stores Projects/Parchis_teleton/frontend/src/hooks Projects/Parchis_teleton/frontend/src/types
    git commit -m "feat: add frontend room session and socket state"

### Task 9: Landing page, join flow and lobby UI

**Files:**
- Create: frontend/src/components/home/LandingPage.tsx
- Create: frontend/src/components/lobby/Lobby.tsx
- Create: frontend/src/components/lobby/PlayerList.tsx
- Create: frontend/src/components/lobby/PlayerCard.tsx
- Create: frontend/src/components/lobby/RoomInvite.tsx
- Create: frontend/src/components/ui/badge.tsx
- Create: frontend/src/components/ui/button.tsx
- Create: frontend/src/components/ui/card.tsx
- Create: frontend/src/components/ui/input.tsx
- Create: frontend/src/lib/utils.ts
- Modify: frontend/src/app/page.tsx
- Create: frontend/src/app/room/[code]/page.tsx
- Modify: frontend/src/app/globals.css

**Interfaces:**
- LandingPage invokes createRoom and joinRoom, saves credentials, and navigates to /room/{code}.
- Lobby consumes useGameStore and useGameSocket; it never computes legal game actions.
- RoomInvite displays room code, /room/{code}, and Copy invitation.
- PlayerList renders public players in seat order and exposes ready/start actions through the socket hook.

- [ ] **Step 1: Write UI behavior tests**

Set up Testing Library with jsdom in frontend/vitest.config.ts and add tests for:

1. Creating a room with name, player count, and color calls createRoom with the selected values.
2. Joining a room normalizes the code to uppercase and calls joinRoom.
3. A room with status lobby renders the player list, current connection label, ready control, and invite copy action.
4. The start button is visible only to the host and disabled unless maxPlayers are present and all players are connected and ready.
5. A non-host does not see the start button.
6. The room page with a stored session starts useGameSocket and displays a reconnecting label when connectionState is reconnecting.

Run:

    pnpm frontend:test

Expected: FAIL because the components and routes are not implemented.

- [ ] **Step 2: Implement shadcn-style primitives**

Create frontend/src/lib/utils.ts:

    import { clsx, type ClassValue } from "clsx";
    import { twMerge } from "tailwind-merge";

    export function cn(...inputs: ClassValue[]) {
      return twMerge(clsx(inputs));
    }

Implement Button, Input, Card, and Badge as small typed components using Tailwind classes, rounded corners, visible focus rings, disabled states, and no domain logic. Keep their APIs stable and generic:

    Button({ variant, size, ...props })
    Input({ ...props })
    Card({ children, className })
    Badge({ children, tone })

- [ ] **Step 3: Implement the landing/create/join flow**

Create LandingPage with two clearly separated actions:

    PARCHÍS ONLINE
    Jugar con amigos en una sala privada
    [Crear partida] [Unirse a partida]

The create form contains display name, player count 4/5/6, and six color choices. The join form contains display name, five-character room code, and optional color. Use local component form state only for fields; persist only the server-returned RoomSession.

On success:

    saveSession(credentials)
    router.push("/room/" + credentials.roomCode)

Show API code/message inline and retain entered values on failure. Disable submit while the request is pending.

- [ ] **Step 4: Implement lobby components**

Lobby must show:

- Room code and copy invitation button.
- Player cards sorted by seatIndex.
- Color swatch, generated avatar, displayName, host badge, ready/waiting state, and connected/disconnected state.
- The current user’s ready toggle.
- Host-only start button.
- A subtle connection banner for connecting, reconnecting, synchronized, and authentication failure.

PlayerCard must render user-provided displayName as text, never HTML. RoomInvite must use navigator.clipboard when available and show Copied for two seconds, with a fallback message when clipboard permission fails.

The start button calls sendStartGame. When the server changes status to playing, show a non-blocking “Partida iniciada; el tablero se incorporará en la siguiente fase” panel instead of inventing board behavior.

- [ ] **Step 5: Implement routes and responsive visual system**

Update frontend/src/app/page.tsx to render LandingPage as a client component. Create frontend/src/app/room/[code]/page.tsx to read params, load the stored session, invoke useGameSocket, and render Lobby. If no session exists, render a link back to the landing page rather than attempting an unauthenticated socket.

Use a warm dark game-room background, saturated player colors, soft shadows, rounded cards, and a centered content width. On narrow screens stack the invite and player cards vertically. Keep the UI social and playful without dashboard tables or payment/premium copy. Add reduced-motion CSS for users who prefer it.

- [ ] **Step 6: Run UI tests, typecheck and build**

Run:

    pnpm frontend:test
    pnpm frontend:typecheck
    pnpm frontend:build

Expected: PASS with no TypeScript errors. Manually verify:

    pnpm frontend:dev
    uv run --project backend uvicorn app.main:app --reload --port 8000

Open two browser tabs, create a room, join it, toggle ready, copy the invitation, and verify that the host-only start button follows server state.

- [ ] **Step 7: Commit the lobby UI**

Run:

    git add Projects/Parchis_teleton/frontend/src/components Projects/Parchis_teleton/frontend/src/app Projects/Parchis_teleton/frontend/src/lib/utils.ts Projects/Parchis_teleton/frontend/src/app/globals.css
    git commit -m "feat: add private room landing and lobby UI"

### Task 10: Full Phase 1 verification and documentation

**Files:**
- Modify: README.md
- Modify: contracts/v1/README.md
- Modify: backend/tests/test_websocket_flow.py
- Modify: frontend/src/app/page.tsx

**Interfaces:**
- Documents exact local setup and commands.
- Provides a repeatable backend integration suite for 4, 5, and 6-player lobby flows.
- Provides final Phase 1 acceptance evidence without relying on Redis, PostgreSQL, or game-board code.

- [ ] **Step 1: Add a four-player full-flow test**

Extend backend/tests/test_websocket_flow.py with a test that:

1. Creates one four-player room over HTTP.
2. Joins three distinct names/colors.
3. Opens four authenticated WebSockets.
4. Confirms each client receives a complete public snapshot.
5. Marks every player ready.
6. Confirms only the host can start.
7. Confirms GAME_STARTED and GAME_STATE_SYNC report status playing to every socket.

Assert that no event payload contains playerToken or token_hash and that all snapshots have the same stateVersion after each mutation.

- [ ] **Step 2: Add five- and six-player capacity coverage**

Parameterize the HTTP/API portion with player_count values 5 and 6. Join exactly the configured number of players and assert the next join returns ROOM_FULL with HTTP 409. Verify all configured colors are unique and seatIndex values are contiguous from 0.

- [ ] **Step 3: Add reconnection and stale-snapshot coverage**

Close a player’s socket, advance the test clock to just before ten minutes, reconnect with the original token, and assert the same playerId, seatIndex, color, and reservation are restored. Advance past ten minutes and assert the old token is rejected.

Send a client snapshot with lower stateVersion into the frontend store test and assert it cannot overwrite the newer room state.

- [ ] **Step 4: Document local operation**

Update README.md with:

    # Parchís Online

    ## Requisitos
    - Node.js 20.9+
    - pnpm 11
    - Python 3.12+
    - uv

    ## Instalación
    pnpm install
    uv sync --project backend

    ## Desarrollo
    pnpm frontend:dev
    uv run --project backend uvicorn app.main:app --reload --port 8000

    ## Verificación
    pnpm frontend:typecheck
    pnpm frontend:test
    pnpm frontend:build
    pnpm backend:test

Document that room state is in memory, a backend restart loses rooms, the reconnection token is stored in browser localStorage, and Redis/PostgreSQL are intentionally deferred. Document that Fase 2 adds GameRules and the board, while Fase 3 adds social features.

- [ ] **Step 5: Run the complete verification suite**

Run:

    pnpm frontend:typecheck
    pnpm frontend:test
    pnpm frontend:build
    pnpm backend:test
    git diff --check

Expected: all commands pass. Manually verify the acceptance flow with browser tabs and record the result in the final task report.

- [ ] **Step 6: Commit the verified Phase 1**

Run:

    git add Projects/Parchis_teleton/README.md Projects/Parchis_teleton/contracts/v1/README.md Projects/Parchis_teleton/backend/tests/test_websocket_flow.py Projects/Parchis_teleton/frontend/src/app/page.tsx
    git diff --cached --name-only
    git commit -m "test: verify phase one room and lobby flow"

Confirm no staged path belongs to Projects/parchistel.

## Plan Self-Review Checklist

Before execution, confirm:

- Task 1 creates a runnable frontend/backend shell and health test.
- Task 2 defines and validates the same v1 wire names in JSON Schema, Pydantic, and TypeScript.
- Task 3 defines repository and domain boundaries without importing FastAPI into the domain.
- Task 4 covers create, join, color/seat allocation, host, ready, start, TTL, token hashing, and idempotency.
- Task 5 covers all HTTP routes and structured error codes.
- Task 6 keeps socket fanout independent from room rules.
- Task 7 covers authenticated handshake, presence, snapshots, command validation, and reconnect.
- Task 8 keeps local session/socket/store concerns out of React presentation.
- Task 9 covers the requested social-game visual tone without implementing future game/social behavior.
- Task 10 verifies 4, 5, and 6 players, reconnection, stale state, build, typecheck, and tests.
- There are no placeholders, unresolved path references, or instructions to mutate the preexisting parchistel changes.
