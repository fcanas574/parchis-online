# Parchís Online Fase 2 — tablero y partida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir salas privadas de 4, 5 o 6 personas en partidas completas de Parchís, con reglas y estado autoritativos en FastAPI y tablero SVG sincronizado en tiempo real.

**Architecture:** El dominio de `backend/app/game/` será puro y determinista salvo por la fuente de dados inyectada; el `RoomManager` ejecutará sus transiciones bajo el lock por sala, guardará snapshots y expondrá eventos versionados mediante el WebSocket existente. El frontend conservará el snapshot del servidor como única autoridad, traducirá posiciones lógicas a tres layouts SVG y ofrecerá controles que solo envían intenciones.

**Tech Stack:** Python 3.12, FastAPI, Pydantic v2, pytest; Next.js 15, React 19, TypeScript estricto, Zustand, Vitest/Testing Library, SVG y Framer Motion ya presentes en el proyecto.

**Spec:** `docs/superpowers/specs/2026-09-25-parchis-online-phase-2-gameplay-design.md`

## Global Constraints

- “La fase incluye tableros completos para 4, 5 y 6 jugadores, con cuatro fichas por jugador.”
- “La ruta común tiene 17 casillas por asiento: 68 para 4 jugadores, 85 para 5 y 102 para 6. La salida del asiento `i` está en el índice `i * 17`; la entrada al pasillo de ese asiento está en `(startCell + (seatCount - 1) * 17) % trackLength`.”
- “La Fase 2 usa una longitud común y configurable de siete casillas para cada pasillo final, seguida por la meta. Las salidas son seguras. Cada segmento de 17 casillas tiene otra casilla segura en el offset relativo `+8` desde su salida, de modo que las casillas seguras son simétricas en los tres tamaños.”
- “En una casilla segura no hay capturas.” “Ninguna ficha puede atravesar una barrera; una ficha rival no puede aterrizar en ella. Una barrera no es capturable.”
- “pieces_per_player = 4; dice_count = 2; die_sides = 6; exit_value = 5; exact_finish = true; capture_bonus_steps = 20; goal_bonus_steps = 10; blockades_enabled = true; blockade_size = 2; extra_turn_condition = doubles.”
- “Si existe una secuencia legal que use ambos dados por separado, se debe usar ambos; en ese caso no se permite sustituirla por la suma. Si no hay secuencia completa separada, se ofrece la suma cuando sea legal y también cualquier movimiento legal que use un solo dado.”
- “Si el jugador que tiene una barrera obtiene dobles, mueve una de las fichas que la forman usando uno de los dados; ese movimiento rompe la barrera y el otro dado sigue disponible. Si hay varias barreras, elige una que pueda abrir legalmente. Si ninguna ficha de barrera tiene un movimiento legal, se ofrecen las demás jugadas legales del doble.”
- “Capturar concede 20 casillas; completar el pasillo final y llegar a meta con una ficha concede 10.” Los bonus “se encolan en el orden en que se generan, se resuelven después de gastar los dados y antes de cerrar el turno” y “no concede turno extra”.
- “El turno extra depende exclusivamente de un doble.” Un seis individual no concede turno extra y no hay penalización por dobles consecutivos.
- “La partida concluye cuando han terminado todos menos uno. El último jugador recibe el puesto restante aunque aún tenga fichas sin llegar a meta.”
- “Al reconectarse con su token, el jugador recupera el control en la siguiente decisión pendiente. El autopiloto no altera fichas, turnos ni identidad; únicamente ejecuta acciones normales cuando el jugador está desconectado. Si vence la reserva de token durante una partida, se mantiene el asiento de juego y el autopiloto puede continuar, pero el token expirado ya no permite recuperar control manual.”
- “La reserva vigente de diez minutos determina durante cuánto tiempo se acepta su token para recuperar el control manual.”
- “Las mutaciones se serializan bajo el lock existente de cada sala. Cada cliente recibe eventos semánticos y el snapshot autoritativo de la misma versión de estado.”
- “El almacenamiento de partidas sigue en memoria y el despliegue presupone una instancia de backend; Redis y persistencia duradera quedan aplazados.” Chat, reacciones, sonidos, regalos, pagos, monedas, tienda, anuncios, ranking público y matchmaking también quedan fuera de esta fase.
- “Se respeta el sistema visual de `DESIGN.md`: fieltro violeta, madera oscura, tipografía y colores de ficha existentes. La interfaz sigue en español y funciona en escritorio y tablet; el layout se adapta a móvil sin desplazar el tablero fuera de pantalla.”

## Review Focus

1. Dos dados permiten movimientos individuales por separado, pero una opción inicial que impide completar la secuencia no debe poder elegirse cuando existe otro plan completo. Test propietario: Task 2, `test_first_die_options_preserve_a_complete_two_move_plan`.
2. Un cliente malicioso envía índices de dado duplicados, vacíos, invertidos o fuera de rango; el servidor debe rechazarlo sin consumir dados ni cambiar versión. Test propietario: Task 8, `test_move_command_rejects_malformed_dice_indices_without_mutation`.
3. Un bonus de meta/captura encadena otra llegada y clasifica al penúltimo jugador; la partida debe terminar con un puesto para el último sin fichas completadas. Test propietario: Task 4, `test_bonus_chain_finishes_match_at_penultimate_player`.
4. Vence la reserva de un token durante una partida; el jugador debe conservar su asiento para el autopiloto, pero el token vencido no debe recuperar control humano. Test propietario: Task 6, `test_expired_game_token_keeps_autopilot_seat_but_rejects_reconnect`.
5. Un comando repetido llega después de una reconexión o de que el cliente no recibió el primer acuse; se debe devolver el cambio idempotente sin gastar dados ni aplicar el movimiento dos veces. Test propietario: Task 8, `test_replayed_move_request_does_not_apply_twice`.

---

## Mapa de archivos y responsabilidades

### Backend

- Crear `backend/app/game/board.py`: definición lógica por capacidad con ruta común, salidas, entradas, casillas seguras y pasillos finales; ninguna coordenada SVG.
- Crear `backend/app/game/rule_config.py`: valores de la variante aprobada en una configuración inmutable.
- Modificar `backend/app/game/models.py`: fichas, opciones de movimiento, bonus, participantes de juego, estado y resultado; extender `RoomState`/`RoomChange` sin exponer tokens.
- Crear `backend/app/game/dice.py`: protocolo para dados del servidor y generador seguro inyectable.
- Crear `backend/app/game/rules.py`: motor puro, validación, generación de opciones, transiciones y eventos de dominio; sin FastAPI, repositorio ni WebSocket.
- Crear `backend/app/game/autoplayer.py`: política determinista que elige entre opciones legales del motor.
- Crear `backend/tests/game_support.py`: constructores de participantes/estados de juego y fuente de dados determinista compartidos por los tests de dominio.
- Modificar `backend/app/services/room_manager.py`: inicio, comandos de juego, snapshots públicos, reservas en partida, autopiloto, repetición y vuelta al lobby bajo el lock existente.
- Modificar `backend/app/schemas/websocket.py`: comandos y modelos públicos/eventos Pydantic, con campos cerrados y aliases camelCase.
- Modificar `backend/app/services/command_router.py`: validar mensajes y despacharlos usando la identidad autenticada.
- Modificar `backend/app/api/websocket.py` y `backend/app/realtime/events.py`: publicar el lote semántico y el snapshot a la misma versión y a todos los asientos.
- Crear `backend/app/realtime/autopilot_runner.py`: ejecutar pasos automáticos por sala con un solo worker activo y permitir que una reconexión interrumpa el worker en el siguiente punto de decisión.
- Crear `backend/tests/test_board.py`, `backend/tests/test_game_rules.py`, `backend/tests/test_autoplayer.py`, `backend/tests/test_autopilot_runner.py` y `backend/tests/test_game_flow.py`; extender `backend/tests/test_room_manager.py`, `backend/tests/test_protocol_schemas.py` y `backend/tests/test_websocket_flow.py`.

### Contrato

- Modificar `contracts/v1/protocol.schema.json`, `contracts/v1/server-events.schema.json` y `contracts/v1/README.md` para describir comandos, eventos, estados y errores reales de gameplay en v1.

### Frontend

- Modificar `frontend/src/types/game.ts` y `frontend/src/types/protocol.ts`: snapshot, opciones autorizadas y mensajes discriminados del protocolo.
- Modificar `frontend/src/stores/gameStore.ts` y `frontend/src/hooks/useGameSocket.ts`: sincronización completa, acciones tipadas, reconexión sin estado optimista.
- Crear `frontend/src/test/game-fixtures.ts`: fixtures tipados de sala, partida, opciones y eventos de sync para las pruebas de UI/estado.
- Crear `frontend/src/lib/board-layouts.ts`: proyección de posiciones lógicas a geometría SVG para 4, 5 y 6 participantes.
- Crear `frontend/src/components/game/Board.tsx`, `Piece.tsx`, `Dice.tsx`, `TurnIndicator.tsx`, `VictoryModal.tsx` y `GameTable.tsx`: tablero y experiencia de partida separados del transporte.
- Modificar `frontend/src/components/lobby/Lobby.tsx` y `frontend/src/app/room/[code]/RoomPageClient.tsx`: transición lobby/partida y control único del socket.
- Modificar `frontend/src/app/globals.css` y `DESIGN.md`: estilos del tablero y componentes de Fase 2, manteniendo sistema visual y accesibilidad.
- Crear `frontend/src/lib/board-layouts.test.ts`, `frontend/src/components/game/Board.test.tsx` y `frontend/src/components/game/GameTable.test.tsx`; extender `frontend/src/types/protocol.test.ts`, `frontend/src/stores/gameStore.test.ts` y `frontend/src/hooks/useGameSocket.test.ts`.
- Modificar `README.md` al completar el flujo para reflejar qué incluye Fase 2 y cómo se verifica.

## Interfaces compartidas

Los nombres y tipos siguientes son contratos entre tareas; cualquier ajuste debe actualizar primero sus consumidores y tests en la misma tarea.

~~~python
BoardFactory.create(seat_count: Literal[4, 5, 6]) -> BoardDefinition
GameRules.new_game(room_code: str, players: Sequence[GameParticipant]) -> GameState
GameRules.available_moves(state: GameState) -> tuple[MoveOption, ...]
GameRules.roll_dice(state: GameState, player_id: str) -> GameTransition
GameRules.move_piece(state: GameState, player_id: str, piece_id: str, dice_indices: tuple[int, ...]) -> GameTransition
GameRules.move_bonus_piece(state: GameState, player_id: str, piece_id: str) -> GameTransition
AutopilotPolicy.choose_move(state: GameState) -> MoveOption
~~~

~~~ts
type GameState = {
  status: "playing" | "finished";
  playerOrder: string[];
  currentPlayerId: string | null;
  turnPhase: "waiting_for_roll" | "waiting_for_move" | "waiting_for_bonus" | "finished";
  diceValues: [number, number] | null;
  usedDiceIndices: number[];
  availableMoves: MoveOption[];
  pendingBonuses: PendingBonus[];
  pieces: Piece[];
  finishOrder: string[];
  winnerId: string | null;
  result: GameResult | null;
};

type ClientCommand =
  | { type: "RECONNECT"; version: 1; roomCode: string; playerToken: string }
  | { type: "PLAYER_READY"; version: 1; ready: boolean; requestId: string }
  | { type: "START_GAME"; version: 1; requestId: string }
  | { type: "ROLL_DICE" | "RETURN_TO_LOBBY" | "PLAY_AGAIN"; version: 1; requestId: string }
  | { type: "MOVE_PIECE"; version: 1; requestId: string; pieceId: string; diceIndices: number[] }
  | { type: "MOVE_BONUS_PIECE"; version: 1; requestId: string; pieceId: string };
~~~

`MoveOption` contiene `pieceId`, `diceIndices`, `steps`, `destination: PiecePosition`, `capturePieceId` nullable y banderas `completesPiece`, `captures`, `landsSafe`, `leavesHome`, `progress` y `completesSplitPlan`; `PiecePosition` contiene estado de ficha, índice de ruta o avance final nullable. `RoomChange` conserva `event_type`, `payload` y `request_id` de Fase 1 y agrega eventos semánticos siguientes; su snapshot público se construye una sola vez después de la transición. `GameState` conserva `playerOrder` (IDs en orden de asiento), piezas, dados, índices ya usados, opciones legales, cola de bonus, orden de llegada, ganador y resultado final.

## Plan de implementación

### Task 1: Modelos de dominio y tablero lógico

**Files:**
- Create: `backend/app/game/board.py`
- Create: `backend/app/game/rule_config.py`
- Modify: `backend/app/game/models.py`
- Test: `backend/tests/test_board.py`
- Test: `backend/tests/test_domain_models.py`

**Interfaces:**
- Consumes: `PlayerState.seat_index`, `PlayerState.id` y capacidades `Literal[4, 5, 6]` existentes.
- Produces: `BoardDefinition`, `BoardFactory.create(seat_count)`, `GameRulesConfig`, `PieceState`, `MoveOption`, `PendingBonus`, `GameParticipant`, `GameState`, `GameResult` y `GameTransition`.

- [ ] **Step 1: Escribir tests fallidos para recorridos y variantes**

~~~python
from app.game.board import BoardFactory
import pytest

@pytest.mark.parametrize("seat_count", [4, 5, 6])
def test_board_defines_symmetric_logical_tracks(seat_count):
    board = BoardFactory.create(seat_count)
    assert board.track_length == 17 * seat_count
    assert len(board.board_path) == board.track_length
    assert board.start_cells_by_seat == {seat: seat * 17 for seat in range(seat_count)}
    assert len(board.safe_cells) == 2 * seat_count
    assert all(len(board.finish_cells_by_seat[seat]) == 7 for seat in range(seat_count))
    for seat in range(seat_count):
        assert board.goal_entry_cells_by_seat[seat] == (
            board.start_cells_by_seat[seat] + (seat_count - 1) * 17
        ) % board.track_length
~~~

- [ ] **Step 2: Ejecutar los tests y confirmar que fallan**

Run: `rtk uv run --project backend pytest backend/tests/test_board.py backend/tests/test_domain_models.py -q`
Expected: FAIL porque `BoardFactory`, `BoardDefinition` y los modelos de partida aún no existen.

- [ ] **Step 3: Implementar modelos, tablero y configuración**

Crear `BoardDefinition` con `seat_count`, `track_length`, `board_path`, `start_cells_by_seat`, `goal_entry_cells_by_seat`, `safe_cells`, `home_paths_by_seat` y `finish_cells_by_seat`; sus caminos de casa tienen cuatro nodos y sus pasillos siete nodos por asiento. Completar la fábrica así, manteniendo índices de dominio sin coordenadas:

~~~python
class BoardFactory:
    @staticmethod
    def create(seat_count: Literal[4, 5, 6]) -> BoardDefinition:
        if seat_count not in (4, 5, 6):
            raise ValueError("seat_count must be 4, 5, or 6")
        track_length = 17 * seat_count
        starts = {seat: seat * 17 for seat in range(seat_count)}
        entries = {
            seat: (starts[seat] + (seat_count - 1) * 17) % track_length
            for seat in range(seat_count)
        }
        safe = frozenset(
            (starts[seat] + offset) % track_length
            for seat in range(seat_count)
            for offset in (0, 8)
        )
        return BoardDefinition(
            seat_count=seat_count,
            track_length=track_length,
            board_path=tuple(range(track_length)),
            start_cells_by_seat=starts,
            goal_entry_cells_by_seat=entries,
            safe_cells=safe,
            home_paths_by_seat={seat: tuple(f"home:{seat}:{n}" for n in range(4)) for seat in range(seat_count)},
            finish_cells_by_seat={seat: tuple(f"finish:{seat}:{n}" for n in range(7)) for seat in range(seat_count)},
        )
~~~

Validar capacidades inválidas con `ValueError`. Añadir configuración inmutable y modelos tipados sin coordenadas gráficas:

~~~python
@dataclass(frozen=True, slots=True)
class GameRulesConfig:
    pieces_per_player: int = 4
    dice_count: int = 2
    die_sides: int = 6
    exit_value: int = 5
    exact_finish: bool = True
    capture_bonus_steps: int = 20
    goal_bonus_steps: int = 10
    blockades_enabled: bool = True
    blockade_size: int = 2
    extra_turn_condition: Literal["doubles"] = "doubles"
~~~

`PieceState` contiene `id`, `player_id`, `state`, `track_position` y `finish_progress`; `PiecePosition` contiene esos tres campos de posición. `GameState` contiene los campos de las interfaces compartidas más `room_code`, `seat_count`, `requires_split_plan` y `result`; su orden de jugadores es `player_order: list[str]`. `GameTransition` contiene el estado resultante y una tupla ordenada de `DomainEvent(type, payload)`. `GameResult` contiene `winner_id` y lista de `PlayerPlacement(player_id, rank)`. En `test_domain_models.py`, verificar los cuatro estados de ficha (`yard`, `track`, `finish_path`, `finished`) y que un `GameState` inicial represente la fase `waiting_for_roll`.

- [ ] **Step 4: Ejecutar tests del dominio y confirmar que pasan**

Run: `rtk uv run --project backend pytest backend/tests/test_board.py backend/tests/test_domain_models.py -q`
Expected: PASS para 4, 5 y 6 asientos; el resto de pruebas de backend no debe romperse.

- [ ] **Step 5: Confirmar tests existentes y crear commit acotado**

Run: `rtk uv run --project backend pytest backend/tests/test_domain_models.py backend/tests/test_board.py -q`
~~~bash
rtk git add backend/app/game/board.py backend/app/game/rule_config.py backend/app/game/models.py backend/tests/test_board.py backend/tests/test_domain_models.py
rtk git commit -m "feat: define logical boards and game models"
~~~

### Task 2: Dados autoritativos y opciones legales de movimiento

**Files:**
- Create: `backend/app/game/dice.py`
- Create: `backend/app/game/rules.py`
- Create: `backend/tests/game_support.py`
- Test: `backend/tests/test_game_rules.py`

**Interfaces:**
- Consumes: modelos y `BoardFactory.create` de Task 1.
- Produces: `DiceSource.roll_pair() -> tuple[int, int]`, `SecureDiceSource`, `GameRules.new_game`, `GameRules.roll_dice`, `GameRules.available_moves`, `GameRules.can_leave_home`, `GameRules.enter_finish_path` e `IllegalMoveError`.

- [ ] **Step 1: Escribir tests fallidos para inicio, dados y planes legales**

~~~python
import pytest
from collections import deque
from app.game.rules import GameRules
from game_support import SequenceDice, make_game_state, make_players

def test_roll_uses_injected_server_dice_and_returns_only_legal_options():
    rules = GameRules(dice=SequenceDice([(2, 3)]))
    state = rules.new_game("AB7K2", make_players(4))
    transition = rules.roll_dice(state, "p1")
    assert transition.state.dice_values == (2, 3)
    assert transition.state.turn_phase == "waiting_for_move"
    assert all(option.steps in (2, 3, 5) for option in transition.state.available_moves)

def test_first_die_options_preserve_a_complete_two_move_plan():
    state = make_game_state(dice_values=(2, 4), track_by_player={"p1": (10, 40), "p2": (12, 12)})
    options = GameRules(dice=SequenceDice([])).available_moves(state)
    assert options
    assert all(len(option.dice_indices) == 1 for option in options)
    assert all(option.completes_split_plan for option in options)
    assert not any(option.dice_indices == (0, 1) for option in options)

def test_exit_requires_a_single_five_or_a_two_dice_sum_of_five():
    rules = GameRules(dice=SequenceDice([(2, 3), (1, 2)]))
    state = rules.new_game("AB7K2", make_players(4))
    exit_options = rules.roll_dice(state, "p1").state.available_moves
    assert {option.dice_indices for option in exit_options} == {(0, 1)}
    assert {option.steps for option in exit_options} == {5}
    no_exit = rules.roll_dice(rules.new_game("CD3E4", make_players(4)), "p1")
    assert no_exit.state.current_player_id == "p2"
    assert no_exit.state.available_moves == ()
~~~

- [ ] **Step 2: Ejecutar los tests de reglas y confirmar que fallan**

Run: `rtk uv run --project backend pytest backend/tests/test_game_rules.py -q`
Expected: FAIL por módulos, fuente de dados y métodos de reglas ausentes.

- [ ] **Step 3: Implementar los constructores de test, dados inyectables y generación de opciones**

~~~python
import secrets
from abc import abstractmethod
from collections import deque
from collections.abc import Iterable, Mapping
from typing import Protocol
from app.game.models import GameParticipant, GameState, PendingBonus, PieceState, TurnPhase
from app.game.rules import GameRules

class DiceSource(Protocol):
    @abstractmethod
    def roll_pair(self) -> tuple[int, int]:
        raise NotImplementedError

class SecureDiceSource:
    def roll_pair(self) -> tuple[int, int]:
        return secrets.randbelow(6) + 1, secrets.randbelow(6) + 1

class SequenceDice:
    def __init__(self, rolls: Iterable[tuple[int, int]]) -> None:
        self._rolls = deque(rolls)

    def roll_pair(self) -> tuple[int, int]:
        return self._rolls.popleft()

def make_players(seat_count: int) -> tuple[GameParticipant, ...]:
    if seat_count not in (4, 5, 6):
        raise ValueError("seat_count must be 4, 5, or 6")
    return tuple(GameParticipant(id=f"p{seat + 1}", seat_index=seat) for seat in range(seat_count))

def make_game_state(
    seat_count: int = 4,
    *,
    dice_values: tuple[int, int] | None = (1, 1),
    track_by_player: Mapping[str, tuple[int, ...]] | None = None,
    finished_by_player: Mapping[str, int] | None = None,
    finish_order: tuple[str, ...] = (),
    pending_bonuses: tuple[PendingBonus, ...] = (),
    turn_phase: TurnPhase = "waiting_for_move",
) -> GameState:
    players = make_players(seat_count)
    track_positions = track_by_player or {}
    finished_counts = finished_by_player or {}
    pieces = []
    for player in players:
        finished_count = finished_counts.get(player.id, 0)
        positions = track_positions.get(player.id, ())
        for number in range(4):
            position_index = number - finished_count
            if number < finished_count:
                piece = PieceState(f"{player.id}-piece-{number + 1}", player.id, "finished", None, None)
            elif position_index < len(positions):
                piece = PieceState(f"{player.id}-piece-{number + 1}", player.id, "track", positions[position_index], None)
            else:
                piece = PieceState(f"{player.id}-piece-{number + 1}", player.id, "yard", None, None)
            pieces.append(piece)
    state = GameState(
        room_code="AB7K2",
        seat_count=seat_count,
        player_order=[player.id for player in players],
        status="playing",
        current_player_id="p1",
        turn_phase=turn_phase,
        dice_values=dice_values,
        used_dice_indices=[],
        available_moves=[],
        pending_bonuses=list(pending_bonuses),
        pieces=pieces,
        finish_order=list(finish_order),
        winner_id=None,
        result=None,
        requires_split_plan=False,
    )
    state.available_moves = list(GameRules().available_moves(state)) if dice_values is not None else []
    return state
~~~

En `game_support.py`, `make_players(seat_count)` devuelve `GameParticipant(id=f"p{seat+1}", seat_index=seat)` para cada asiento. `make_game_state(...)` crea el `GameState` con cuatro `PieceState` por participante, marca primero las fichas terminadas indicadas, después las posiciones compartidas indicadas y deja las restantes en casa; establece fase, dados, orden de llegada y bonus. `GameRules` acepta el protocolo `DiceSource` por constructor, crea cuatro fichas por participante y valida identidad/turno/fase antes de tirar. Genera candidatos con uno de los dados o ambos; la suma de ambos solo se incluye si la búsqueda exhaustiva de secuencias de dos movimientos individuales no encuentra un plan completo. La búsqueda simula el primer movimiento antes de generar el segundo, admite mover la misma ficha secuencialmente y devuelve solo primeros pasos que completen un plan posible. Salir de `yard` requiere que el movimiento candidato tenga valor exactamente 5. Rechazar dados inyectados que no sean dos enteros de 1 a 6.

- [ ] **Step 4: Ejecutar la suite de reglas y confirmar que pasa**

Run: `rtk uv run --project backend pytest backend/tests/test_game_rules.py -q`
Expected: PASS; verificar en particular que no se ofrezca la suma cuando exista un plan separado completo.

- [ ] **Step 5: Confirmar regresión de modelos/tablero y crear commit**

Run: `rtk uv run --project backend pytest backend/tests/test_domain_models.py backend/tests/test_board.py backend/tests/test_game_rules.py -q`
~~~bash
rtk git add backend/app/game/dice.py backend/app/game/rules.py backend/tests/game_support.py backend/tests/test_game_rules.py
rtk git commit -m "feat: generate authoritative dice and legal moves"
~~~

### Task 3: Aplicación de movimientos, barreras y capturas

**Files:**
- Modify: `backend/app/game/rules.py`
- Modify: `backend/app/game/models.py`
- Test: `backend/tests/test_game_rules.py`

**Interfaces:**
- Consumes: `MoveOption` legal y fuente de opciones de Task 2.
- Produces: `GameRules.move_piece(state, player_id, piece_id, dice_indices)`, revalidación de opciones, eventos `PIECE_MOVED`, `PIECE_CAPTURED` y estado de destino lógico.

- [ ] **Step 1: Escribir tests fallidos para rutas, barreras, seguridad y captura**

~~~python
import copy
import pytest
from app.game.rules import GameRules, IllegalMoveError
from game_support import SequenceDice, make_game_state

def test_move_rejects_crossing_or_landing_on_an_opponent_blockade():
    rules = GameRules(dice=SequenceDice([]))
    state = make_game_state(dice_values=(4, 2), track_by_player={"p1": (10,), "p2": (12, 12)})
    before = copy.deepcopy(state)
    with pytest.raises(IllegalMoveError):
        rules.move_piece(state, "p1", "p1-piece-1", (0,))
    assert state == before

def test_safe_cell_prevents_capture_and_ordinary_cell_captures():
    safe_state = make_game_state(dice_values=(2, 4), track_by_player={"p1": (6,), "p2": (8,)})
    capture_state = make_game_state(dice_values=(1, 4), track_by_player={"p1": (10,), "p2": (11,)})
    safe = GameRules().move_piece(safe_state, "p1", "p1-piece-1", (0,))
    captured = GameRules().move_piece(capture_state, "p1", "p1-piece-1", (0,))
    assert not any(event.type == "PIECE_CAPTURED" for event in safe.events)
    assert any(event.type == "PIECE_CAPTURED" for event in captured.events)
    assert next(piece for piece in captured.state.pieces if piece.player_id == "p2").state == "yard"

def test_double_roll_breaks_a_movable_own_blockade_with_one_die():
    state = make_game_state(dice_values=(3, 3), track_by_player={"p1": (20, 20)})
    transition = GameRules().move_piece(state, "p1", "p1-piece-1", (0,))
    assert transition.state.used_dice_indices == [0]
    assert transition.state.turn_phase == "waiting_for_move"
    assert transition.state.current_player_id == "p1"
~~~

- [ ] **Step 2: Ejecutar los tests y comprobar que fallan**

Run: `rtk uv run --project backend pytest backend/tests/test_game_rules.py -q`
Expected: FAIL porque `move_piece` y las reglas de ocupación aún no aplican transiciones.

- [ ] **Step 3: Implementar movimiento atómico y efectos sobre el recorrido común**

~~~python
def move_piece(
    self,
    state: GameState,
    player_id: str,
    piece_id: str,
    dice_indices: tuple[int, ...],
) -> GameTransition:
    option = self._require_current_legal_option(state, player_id, piece_id, dice_indices)
    next_state = copy.deepcopy(state)
    events = self._apply_option(next_state, option)
    return GameTransition(next_state, tuple(events))
~~~

Resolver destino con el camino común y el pasillo del dueño; exigir llegada exacta a meta y rechazar movimiento fuera de tablero. Detectar barreras de dos o más fichas propias; impedir cruzarlas y aterrizar en ellas; impedir captura en las casillas seguras y capturar únicamente una ficha rival sola en casilla común no segura. La acción de dobles que rompe una barrera propia mueve un integrante usando exactamente un índice de dado y conserva el otro índice para el siguiente cálculo de opciones; si no existe salida legal de la barrera, el motor ofrece las demás opciones válidas. La entrada de movimiento debe volver a buscar la opción exacta en `available_moves`, sin fiarse de datos anteriores del cliente.

- [ ] **Step 4: Ejecutar tests de movimiento y verificar invariancia ante rechazo**

Run: `rtk uv run --project backend pytest backend/tests/test_game_rules.py -q`
Expected: PASS; todo intento inválido deja estado, dados y posiciones sin cambios.

- [ ] **Step 5: Crear commit de movimiento**

~~~bash
rtk git add backend/app/game/models.py backend/app/game/rules.py backend/tests/test_game_rules.py
rtk git commit -m "feat: validate piece movement and captures"
~~~

### Task 4: Bonus, cierre de turnos y clasificación

**Files:**
- Modify: `backend/app/game/rules.py`
- Modify: `backend/app/game/models.py`
- Test: `backend/tests/test_game_rules.py`

**Interfaces:**
- Consumes: transiciones de movimiento y eventos de Task 3.
- Produces: `GameRules.move_bonus_piece`, resolución de cola de bonus, cierre de fase de dados, avance de turno, orden de puestos y `GameResult`.

- [ ] **Step 1: Escribir tests fallidos para bonus, dobles, meta y fin en N−1**

~~~python
from app.game.board import BoardFactory
from app.game.models import PendingBonus
from app.game.rules import GameRules
from game_support import SequenceDice, make_game_state, make_players

def test_capture_grants_exactly_twenty_steps_after_both_dice_are_used():
    state = make_game_state(dice_values=(1, 2), track_by_player={"p1": (10,), "p2": (11,)})
    after_capture = GameRules().move_piece(state, "p1", "p1-piece-1", (0,))
    assert after_capture.state.pending_bonuses[0].steps == 20
    assert after_capture.state.turn_phase == "waiting_for_move"

def test_single_six_does_not_grant_extra_turn_but_doubles_do():
    single_rules = GameRules(dice=SequenceDice([(6, 2)]))
    double_rules = GameRules(dice=SequenceDice([(4, 4)]))
    single_six = single_rules.roll_dice(single_rules.new_game("AB7K2", make_players(4)), "p1")
    double = double_rules.roll_dice(double_rules.new_game("CD3E4", make_players(4)), "p1")
    assert single_six.state.current_player_id == "p2"
    assert double.state.current_player_id == "p1"

def test_bonus_chain_finishes_match_at_penultimate_player():
    entry = BoardFactory.create(4).goal_entry_cells_by_seat[2]
    state = make_game_state(
        finished_by_player={"p1": 4, "p2": 4, "p3": 3},
    track_by_player={"p3": ((entry - 2) % 68,)},
    finish_order=("p1", "p2"),
    pending_bonuses=(PendingBonus("p3", 10, "goal"),),
)
state.current_player_id = "p3"
transition = GameRules().move_bonus_piece(state, "p3", "p3-piece-4")
    assert transition.state.finish_order == ["p1", "p2", "p3"]
    assert transition.state.status == "finished"
    assert transition.state.winner_id == "p1"
    assert transition.state.result.placements[-1].rank == 4
~~~

- [ ] **Step 2: Ejecutar tests y confirmar el fallo inicial**

Run: `rtk uv run --project backend pytest backend/tests/test_game_rules.py -q`
Expected: FAIL porque bonus y ranking aún no se resuelven.

- [ ] **Step 3: Implementar cola de bonus y finalización de partida**

~~~python
captured_piece.state = "yard"
next_state.pending_bonuses.append(PendingBonus(player_id=player_id, steps=20, reason="capture"))
next_state.available_moves = self.available_bonus_moves(next_state)
next_state.turn_phase = "waiting_for_bonus" if next_state.available_moves else "waiting_for_move"
~~~

Encolar captura `20` y llegada a meta `10` en el orden en que ocurren; calcular opciones de bonus como movimiento exacto independiente de los dados. Rechazar pieza ajena o opción inválida. Descartar bonus sin jugadas con `BONUS_SKIPPED`; permitir que un bonus capture o llegue a meta y encole nuevos bonus. Solo avanzar de jugador cuando dados y bonus estén resueltos. Un doble conserva el turno incluso si no hubo movimiento; un seis simple no lo conserva. Saltar jugadores con cuatro fichas terminadas. Al completar la cuarta ficha, asignar puesto; al llegar a `N-1` personas clasificadas, terminar la partida, asignar el último puesto a quien queda y fijar como ganador a quien terminó primero.

- [ ] **Step 4: Ejecutar motor completo y confirmar escenarios de cadena**

Run: `rtk uv run --project backend pytest backend/tests/test_game_rules.py -q`
Expected: PASS para bonus simple, bonus descartado, cadena de captura/meta, dobles sin movimientos y partida que concluye exactamente en N−1.

- [ ] **Step 5: Crear commit del ciclo de turno y clasificación**

~~~bash
rtk git add backend/app/game/models.py backend/app/game/rules.py backend/tests/test_game_rules.py
rtk git commit -m "feat: resolve game bonuses and placements"
~~~

### Task 5: Autopiloto determinista para jugadores desconectados

**Files:**
- Create: `backend/app/game/autoplayer.py`
- Modify: `backend/app/game/models.py`
- Test: `backend/tests/test_autoplayer.py`

**Interfaces:**
- Consumes: opciones legales y señales de resultado generadas por `GameRules`.
- Produces: `AutopilotPolicy.choose_move(state) -> MoveOption` y `AutopilotPolicy.choose_bonus_move(state) -> str | None`.
- Produce `NoLegalMoveError` para el caso en que el motor no haya ofrecido una opción.

- [ ] **Step 1: Escribir tests fallidos para prioridades, desempate y legalidad**

~~~python
from dataclasses import replace
from app.game.autoplayer import AutopilotPolicy
from game_support import make_game_state

def test_autopilot_prefers_finishing_then_capture_then_safe_then_exit_then_progress():
    template = make_game_state(dice_values=(5, 5)).available_moves[0]
    state = make_game_state(dice_values=(5, 5))
    state.available_moves = (
        replace(template, piece_id="progress", progress=2),
        replace(template, piece_id="exit", leaves_home=True),
        replace(template, piece_id="safe", lands_safe=True),
        replace(template, piece_id="capture", captures=True),
        replace(template, piece_id="finish", completes_piece=True, lands_safe=True),
    )
    assert AutopilotPolicy().choose_move(state).piece_id == "finish"

def test_autopilot_tie_break_is_deterministic_and_returns_only_listed_option():
    template = make_game_state(dice_values=(5, 5)).available_moves[0]
    state = make_game_state(dice_values=(5, 5))
    state.available_moves = (
        replace(template, piece_id="p1-piece-2"),
        replace(template, piece_id="p1-piece-1"),
    )
    first = AutopilotPolicy().choose_move(state)
    second = AutopilotPolicy().choose_move(state)
    assert first == second
    assert first in state.available_moves
~~~

- [ ] **Step 2: Ejecutar tests y verificar que fallan**

Run: `rtk uv run --project backend pytest backend/tests/test_autoplayer.py -q`
Expected: FAIL porque la política aún no está definida.

- [ ] **Step 3: Implementar selección pura y estable**

~~~python
class AutopilotPolicy:
    def choose_move(self, state: GameState) -> MoveOption:
        if not state.available_moves:
            raise NoLegalMoveError
        return min(state.available_moves, key=self._priority_key)
~~~

Ordenar por completar ficha, capturar, casilla segura, salida de casa y progreso; resolver empates por `piece_id`, tupla de índices de dado y destino estable. Para bonus, usar solo las opciones exactas que calcule `GameRules`. El autopiloto no genera dados ni reimplementa geometría/reglas.

- [ ] **Step 4: Ejecutar tests de autopiloto y motor**

Run: `rtk uv run --project backend pytest backend/tests/test_autoplayer.py backend/tests/test_game_rules.py -q`
Expected: PASS; cada opción elegida pertenece a las opciones legales vigentes.

- [ ] **Step 5: Crear commit de autopiloto**

~~~bash
rtk git add backend/app/game/autoplayer.py backend/app/game/models.py backend/tests/test_autoplayer.py
rtk git commit -m "feat: choose legal moves for disconnected players"
~~~

### Task 6: Integrar partida, reservas y repetición en RoomManager

**Files:**
- Modify: `backend/app/game/models.py`
- Modify: `backend/app/services/room_manager.py`
- Modify: `backend/tests/game_support.py`
- Test: `backend/tests/test_room_manager.py`
- Test: `backend/tests/test_game_flow.py`

**Interfaces:**
- Consumes: `GameRules` y `AutopilotPolicy`.
- Produces: `RoomState.game_state`, `RoomState.last_game_result`, `RoomManager.roll_dice`, `move_piece`, `move_bonus_piece`, `return_to_lobby`, `play_again` y snapshots públicos completos.
- Produce `RoomManager.run_autopilot_step(room_code) -> RoomChange | None`, que aplica como máximo una decisión automática y vuelve a comprobar presencia en el siguiente paso.

- [ ] **Step 1: Escribir tests fallidos de inicio, autenticación y replay**

~~~python
import pytest
from typing import Literal
from app.game.models import GameResult, PlayerPlacement, RoomCredentialData, SessionIdentity
from app.services.room_manager import RoomError, RoomManager
from game_support import make_game_state

async def create_ready_room(manager: RoomManager, seat_count: Literal[4, 5, 6]) -> list[RoomCredentialData]:
    colors = ("green", "red", "blue", "yellow", "purple", "orange")
    players = [await manager.create_room("Player 1", seat_count, colors[0])]
    for seat in range(1, seat_count):
        players.append(await manager.join_room(players[0].room_code, f"Player {seat + 1}", colors[seat]))
    for player in players:
        await manager.set_ready(SessionIdentity(player.room_code, player.player_id), True, f"ready-{player.player_id}")
    return players

@pytest.mark.asyncio
@pytest.mark.parametrize("seat_count", [4, 5, 6])
async def test_start_creates_four_pieces_per_seat_and_public_game_snapshot(room_manager, seat_count):
    credentials = await create_ready_room(room_manager, seat_count)
    room_code = credentials[0].room_code
    change = await room_manager.start_game(SessionIdentity(room_code, credentials[0].player_id), f"start-{seat_count}")
    room = room_manager.public_room_from_state(change.state)
    assert change.state.game_state.current_player_id == credentials[0].player_id
    assert change.state.game_state.player_order == [player.player_id for player in credentials]
    assert len(room["gameState"]["pieces"]) == seat_count * 4
    assert room["lastGameResult"] is None

@pytest.mark.asyncio
async def test_expired_game_token_keeps_autopilot_seat_but_rejects_reconnect(room_manager, clock):
    credentials = await create_ready_room(room_manager, 4)
    room_code = credentials[0].room_code
    host_identity = SessionIdentity(room_code, credentials[0].player_id)
    await room_manager.start_game(host_identity, "start")
    await room_manager.disconnect(host_identity)
    clock.advance(seconds=601)
    await room_manager.prune_expired_reservations(room_code)
    room = await room_manager.get_room(room_code)
    assert len(room.players) == 4
    assert not room.players[0].is_connected
    with pytest.raises(RoomError, match="Invalid room credentials"):
        await room_manager.authenticate(room_code, credentials[0].player_token)

@pytest.mark.asyncio
async def test_play_again_keeps_seats_resets_ready_and_preserves_last_result(room_manager, room_repository):
    credentials = await create_ready_room(room_manager, 4)
    room_code = credentials[0].room_code
    room = await room_manager.get_room(room_code)
    room.status = "finished"
    room.game_state = make_game_state(turn_phase="finished")
    room.game_state.status = "finished"
    room.last_game_result = GameResult(
        winner_id=credentials[0].player_id,
        placements=[
            PlayerPlacement(credentials[0].player_id, 1),
            PlayerPlacement(credentials[1].player_id, 2),
            PlayerPlacement(credentials[2].player_id, 3),
            PlayerPlacement(credentials[3].player_id, 4),
        ],
    )
    await room_repository.save(room)
    change = await room_manager.play_again(SessionIdentity(room_code, credentials[0].player_id), "again")
    assert change.state.status == "lobby"
    assert change.state.game_state is None
    assert change.state.last_game_result is not None
    assert change.state.players[0].is_ready
    assert all(not player.is_ready for player in change.state.players[1:])
~~~

Colocar `create_ready_room` en `backend/tests/game_support.py`, ya creada en Task 2, e importarla desde los módulos de test de RoomManager y flujo.

- [ ] **Step 2: Ejecutar tests y verificar el fallo**

Run: `rtk uv run --project backend pytest backend/tests/test_room_manager.py backend/tests/test_game_flow.py -q`
Expected: FAIL porque RoomState y RoomManager todavía solo representan el lobby.

- [ ] **Step 3: Extender el estado y coordinar transiciones bajo el lock de sala**

Implementar las firmas descritas en Interfaces para `roll_dice`, `move_piece`, `move_bonus_piece`, `return_to_lobby`, `play_again` y `run_autopilot_step`, cada mutación con request ID validado bajo el lock existente. El inicio sigue exigiendo host, capacidad exacta, conexión y ready de todos; crea estado de juego y borra únicamente el resultado anterior al empezar. Tras desconectar, conservar todos los asientos mientras `game_state` siga activo, incluso cuando `status` sea `finished`; la autenticación rechaza un token cuya reserva venció, pero no elimina el asiento. Marcar internamente la reserva expirada para no incrementar `stateVersion` en cada lectura. `run_autopilot_step` actúa solo si el jugador actual está desconectado, aplica exactamente una tirada, movimiento o bonus del motor y devuelve `None` cuando le corresponde jugar a una persona conectada o la partida terminó. Al finalizar el motor, copiar `GameResult` a `last_game_result` y cambiar `RoomState.status` a `finished`. Publicar dentro de `RoomState` el estado y resultado serializados sin `token_hash`. `RETURN_TO_LOBBY` y `PLAY_AGAIN` solo se aceptan desde `finished`; ambos limpian el juego, conservan resultado, roster y colores y ponen a todos no listos; `PLAY_AGAIN` además marca listo al solicitante.

- [ ] **Step 4: Ejecutar tests de integración del manager y regresión de lobby**

Run: `rtk uv run --project backend pytest backend/tests/test_room_manager.py backend/tests/test_game_flow.py -q`
Expected: PASS para salas de 4/5/6, expiración en partida, un paso de autopiloto y vuelta/revancha; iniciar partida como invitado o sin todos conectados/listos sigue rechazándose.

- [ ] **Step 5: Crear commit de integración de dominio y sala**

~~~bash
rtk git add backend/app/game/models.py backend/app/services/room_manager.py backend/tests/game_support.py backend/tests/test_room_manager.py backend/tests/test_game_flow.py
rtk git commit -m "feat: integrate gameplay with private rooms"
~~~

### Task 7: Definir contrato v1 de gameplay en Pydantic y JSON Schema

**Files:**
- Modify: `backend/app/schemas/websocket.py`
- Modify: `contracts/v1/protocol.schema.json`
- Modify: `contracts/v1/server-events.schema.json`
- Modify: `contracts/v1/README.md`
- Test: `backend/tests/test_protocol_schemas.py`

**Interfaces:**
- Consumes: modelos públicos serializables y eventos acordados en la especificación.
- Produces: comandos Pydantic estrictos y eventos/snapshots camelCase que reflejan exactamente el contrato v1.

- [ ] **Step 1: Escribir tests fallidos para cada comando y snapshot de juego**

~~~python
from copy import deepcopy
from app.realtime.events import make_event
from game_support import make_game_state

@pytest.mark.parametrize("message", [
    {"type": "ROLL_DICE", "version": 1, "requestId": "roll-1"},
    {"type": "MOVE_PIECE", "version": 1, "requestId": "move-1", "pieceId": "p1-piece-1", "diceIndices": [0]},
    {"type": "MOVE_BONUS_PIECE", "version": 1, "requestId": "bonus-1", "pieceId": "p1-piece-1"},
    {"type": "RETURN_TO_LOBBY", "version": 1, "requestId": "lobby-1"},
    {"type": "PLAY_AGAIN", "version": 1, "requestId": "again-1"},
])
def test_gameplay_commands_validate_against_pydantic_and_json_schema(message):
    TypeAdapter(ClientMessage).validate_python(message)
    validate(message, load_schema("protocol.schema.json"))

def test_sync_schema_contains_public_game_and_last_result_without_credentials(room, room_manager):
    state = deepcopy(room)
    state.status = "playing"
    state.game_state = make_game_state()
    public_room = room_manager.public_room_from_state(state)
    snapshot = make_event(
        "GAME_STATE_SYNC",
        state.room_code,
        state.state_version,
        {"room": public_room, "game": public_room["gameState"]},
    )
    validate(snapshot, load_schema("server-events.schema.json"))
    assert "playerToken" not in json.dumps(snapshot)
    assert "tokenHash" not in json.dumps(snapshot)
~~~

Importar `room` y `room_manager` de los fixtures existentes de `backend/tests/conftest.py`, `make_game_state` de `game_support.py` y `make_event` de `app.realtime.events` en la prueba de sync.

- [ ] **Step 2: Ejecutar tests de contrato y verificar que fallan**

Run: `rtk uv run --project backend pytest backend/tests/test_protocol_schemas.py -q`
Expected: FAIL porque `ClientMessage` y schemas aún no incluyen comandos ni estado de partida.

- [ ] **Step 3: Añadir modelos cerrados y actualizar ambos JSON Schemas**

~~~python
class RollDiceCommand(WireModel):
    type: Literal["ROLL_DICE"]
    version: Literal[1] = 1
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)

class MovePieceCommand(WireModel):
    type: Literal["MOVE_PIECE"]
    version: Literal[1] = 1
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)
    piece_id: str = Field(alias="pieceId", min_length=1, max_length=64)
    dice_indices: list[StrictInt] = Field(alias="diceIndices", min_length=1, max_length=2)
~~~

Añadir los cinco comandos de la especificación a la unión discriminada: `ROLL_DICE`, `MOVE_PIECE`, `MOVE_BONUS_PIECE`, `RETURN_TO_LOBBY` y `PLAY_AGAIN`. Definir estados públicos para juego, pieza, movimiento, bonus y resultado con `extra="forbid"`; `PublicRoomState` requiere `gameState` nullable y `lastGameResult` nullable. El contrato define `PLAYER_JOINED`, `PLAYER_LEFT`, `PLAYER_RECONNECTED`, `PLAYER_READY`, `GAME_STARTED`, `TURN_STARTED`, `DICE_ROLLED`, `PIECE_MOVED`, `PIECE_CAPTURED`, `BONUS_GRANTED`, `BONUS_SKIPPED`, `TURN_ENDED`, `PLAYER_FINISHED`, `GAME_FINISHED`, `GAME_STATE_SYNC`, `GAME_RESET` y `ERROR`, con sus payloads exactos descritos en la especificación. `GAME_STATE_SYNC` lleva `{ room, game }` con `lastGameResult` dentro del room. El schema de `diceIndices` limita los valores a 0/1, dos elementos como máximo y `uniqueItems: true`; el router mantiene además la validación del orden permitido. JSON Schemas deben rechazar propiedades de autoridad del cliente y credenciales privadas, y admitir `requestId` en errores correlacionados. Actualizar el README del contrato con campos, semántica, idempotencia y versión compartida.

- [ ] **Step 4: Ejecutar validación cruzada de Pydantic y JSON Schema**

Run: `rtk uv run --project backend pytest backend/tests/test_protocol_schemas.py -q`
Expected: PASS; validar también que `MOVE_PIECE` no acepta índices duplicados fuera del dominio al pasar por el router (la restricción semántica se prueba en Task 8).

- [ ] **Step 5: Crear commit del contrato**

~~~bash
rtk git add backend/app/schemas/websocket.py contracts/v1/protocol.schema.json contracts/v1/server-events.schema.json contracts/v1/README.md backend/tests/test_protocol_schemas.py
rtk git commit -m "feat: specify gameplay websocket protocol v1"
~~~

### Task 8: Despacho autenticado, autopiloto concurrente y publicación WebSocket

**Files:**
- Modify: `backend/app/game/models.py`
- Modify: `backend/app/services/command_router.py`
- Modify: `backend/app/api/websocket.py`
- Modify: `backend/app/realtime/events.py`
- Create: `backend/app/realtime/autopilot_runner.py`
- Modify: `backend/tests/conftest.py`
- Test: `backend/tests/test_websocket_flow.py`
- Test: `backend/tests/test_autopilot_runner.py`
- Test: `backend/tests/test_game_flow.py`

**Interfaces:**
- Consumes: comandos Pydantic de Task 7 y métodos autenticados de Task 6.
- Produces: dispatch de gameplay por `CommandContext.identity`, lote de eventos semánticos por versión y snapshot final idéntico para todos; worker único por sala que cede el lock entre pasos y se detiene si el asiento vuelve a conectarse.
- `RoomAutopilotRunner.schedule(room_code: str, coroutine_factory: Callable[[], Awaitable[None]]) -> asyncio.Task[None]` devuelve el worker ya activo de la sala o crea uno; al completarse elimina su propia entrada.

- [ ] **Step 1: Escribir tests fallidos de auth, batch, versión, índices e idempotencia**

~~~python
import asyncio
import pytest
from app.game.models import SessionIdentity
from app.services.command_router import CommandContext, CommandRouter
from app.realtime.autopilot_runner import RoomAutopilotRunner
from game_support import create_ready_room

@pytest.mark.asyncio
@pytest.mark.parametrize("dice_indices", [[], [0, 0], [1, 0], [2]])
async def test_move_command_rejects_malformed_dice_indices_without_mutation(room_manager, dice_indices):
    players = await create_ready_room(room_manager, 4)
    room_code = players[0].room_code
    identity = SessionIdentity(room_code, players[0].player_id)
    await room_manager.start_game(identity, "start")
    before = (await room_manager.get_room(room_code)).state_version
    router = CommandRouter(room_manager)
    context = CommandContext(identity, room_code)
    changes = await router.handle(context, {"type": "MOVE_PIECE", "version": 1, "requestId": "bad", "pieceId": "p1-piece-1", "diceIndices": dice_indices})
    assert changes[0].event_type == "ERROR"
    assert changes[0].request_id == "bad"
    assert changes[0].state.state_version == before

@pytest.mark.asyncio
async def test_replayed_move_request_does_not_apply_twice(room_manager):
    players = await create_ready_room(room_manager, 4)
    host = SessionIdentity(players[0].room_code, players[0].player_id)
    await room_manager.start_game(host, "start")
    rolled = await room_manager.roll_dice(host, "roll")
    option = rolled.state.game_state.available_moves[0]
    first = await room_manager.move_piece(host, "move-once", option.piece_id, option.dice_indices)
    replay = await room_manager.move_piece(host, "move-once", option.piece_id, option.dice_indices)
    assert replay.state.state_version == first.state.state_version
    assert replay.state.game_state.pieces == first.state.game_state.pieces

@pytest.mark.asyncio
async def test_reconnected_player_takes_control_before_the_next_autopilot_step(room_manager):
    players = await create_ready_room(room_manager, 4)
    room_code = players[0].room_code
    identity = SessionIdentity(room_code, players[0].player_id)
    session = await room_manager.authenticate(room_code, players[0].player_token)
    await room_manager.start_game(identity, "start")
    await room_manager.disconnect(session)
    assert await room_manager.run_autopilot_step(room_code) is not None
    await room_manager.authenticate(room_code, players[0].player_token)
    assert await room_manager.run_autopilot_step(room_code) is None

@pytest.mark.asyncio
async def test_autopilot_runner_deduplicates_workers_per_room():
    runner = RoomAutopilotRunner()
    release = asyncio.Event()
    async def wait_for_release():
        await release.wait()
    first = runner.schedule("AB7K2", wait_for_release)
    second = runner.schedule("AB7K2", wait_for_release)
    assert first is second
    release.set()
    await first
~~~

Además de los dos ejemplos anteriores, ampliar la prueba WebSocket existente para comprobar que dos clientes reciben `DICE_ROLLED` y `GAME_STATE_SYNC` con la misma versión y el mismo snapshot. En `conftest.py`, inyectar `GameRules(dice=SequenceDice([(5, 2)]))` para cada instancia de `RoomManager` de tests; la producción sigue usando `SecureDiceSource`.

- [ ] **Step 2: Ejecutar pruebas WebSocket existentes y nuevas; confirmar el fallo esperado**

Run: `rtk uv run --project backend pytest backend/tests/test_websocket_flow.py backend/tests/test_game_flow.py -q`
Expected: FAIL en los nuevos comandos o en la publicación de más de un evento semántico.

- [ ] **Step 3: Enrutar comandos y publicar transiciones serializadas**

~~~python
if isinstance(command, RollDiceCommand):
    change = await self._room_manager.roll_dice(context.identity, command.request_id)
elif isinstance(command, MovePieceCommand):
    change = await self._room_manager.move_piece(
        context.identity, command.request_id, command.piece_id, tuple(command.dice_indices)
    )
~~~

Rechazar en el router listas de índices que no sean exactamente `(0,)`, `(1,)` o `(0, 1)` sin repetición. Nunca leer `playerId` del mensaje para autorizar. Mantener el cache por `(playerId, requestId)`. Extender `RoomChange` con eventos semánticos adicionales conservando campos de Fase 1; el endpoint publica evento primario, adicionales y luego un solo `GAME_STATE_SYNC`, todos con la versión resultante. En reintento, retransmitir exactamente el cambio cacheado sin incrementar la versión. Los errores correlacionan el request y no publican un snapshot mutado. Todos los destinatarios reciben los mismos payloads y versiones.

Crear `RoomAutopilotRunner` con `schedule(room_code, coroutine_factory)` y al menos una tarea activa por sala. Tras desconexión y después de cada acción que pueda dejar turno a un asiento desconectado, el endpoint programa un loop que toma el lock de publicación, llama `RoomManager.run_autopilot_step`, publica la transición y libera el lock antes de la siguiente acción; entre iteraciones hace `await asyncio.sleep(0)`. En el siguiente paso el manager vuelve a leer `is_connected`, por lo que una reconexión autenticada detiene el piloto antes de la siguiente decisión. Una tarea fallida se registra y se retira del mapa para que una nueva acción pueda volver a programarla; no mantener el lock mientras se espera a una persona ni mientras se duerme.

- [ ] **Step 4: Ejecutar flujos WebSocket y verificar que reconectar interrumpe el siguiente paso automático**

Run: `rtk uv run --project backend pytest backend/tests/test_websocket_flow.py backend/tests/test_game_flow.py -q`
Run: `rtk uv run --project backend pytest backend/tests/test_autopilot_runner.py -q`
Expected: PASS para worker único, cesión entre pasos, parada al reconectar, roll/move, rechazo de acciones de otro turno/campos de autoridad falsificados, reintentos y snapshots iguales para todos.

- [ ] **Step 5: Crear commit de protocolo en ejecución**

~~~bash
rtk git add backend/app/game/models.py backend/app/services/command_router.py backend/app/api/websocket.py backend/app/realtime/events.py backend/app/realtime/autopilot_runner.py backend/tests/conftest.py backend/tests/test_websocket_flow.py backend/tests/test_autopilot_runner.py backend/tests/test_game_flow.py
rtk git commit -m "feat: publish authoritative gameplay websocket events"
~~~

### Task 9: Sincronización y acciones tipadas del frontend

**Files:**
- Modify: `frontend/src/types/game.ts`
- Modify: `frontend/src/types/protocol.ts`
- Modify: `frontend/src/stores/gameStore.ts`
- Modify: `frontend/src/hooks/useGameSocket.ts`
- Create: `frontend/src/test/game-fixtures.ts`
- Test: `frontend/src/types/protocol.test.ts`
- Test: `frontend/src/stores/gameStore.test.ts`
- Test: `frontend/src/hooks/useGameSocket.test.ts`

**Interfaces:**
- Consumes: contrato v1 validado en backend y snapshot público con `gameState`.
- Produces: tipos `Piece`, `MoveOption`, `PendingBonus`, `GameState`, `GameResult`; `ClientCommand`; callbacks `sendRollDice`, `sendMovePiece`, `sendMoveBonusPiece`, `sendReturnToLobby`, `sendPlayAgain`.

- [ ] **Step 1: Escribir tests fallidos de snapshot, eventos y comandos**

~~~ts
import { gameRoomFixture, gameStateFixture, gameSyncEvent } from "@/test/game-fixtures";

it("applies a current full snapshot and ignores an older gameplay snapshot", () => {
  useGameStore.getState().applyEvent(gameSyncEvent({
    stateVersion: 12,
    room: gameRoomFixture({ status: "playing", stateVersion: 12, gameState: gameStateFixture() }),
  }));
  useGameStore.getState().applyEvent(gameSyncEvent({
    stateVersion: 11,
    room: gameRoomFixture({ stateVersion: 11, gameState: null }),
  }));
  expect(useGameStore.getState().room?.status).toBe("playing");
  expect(useGameStore.getState().room?.gameState?.currentPlayerId).toBe("p1");
});
~~~

En `useGameSocket.test.ts`, ampliar la prueba existente de socket falso: montar `renderHook(() => useGameSocket("AB7K2"))`, abrir el socket falso, entregar un snapshot activo por `onmessage`, guardar las posiciones y llamar `result.current.sendMovePiece("p1-piece-1", [0])` dentro de `act`. Comprobar el comando JSON con `type: "MOVE_PIECE"`, `pieceId: "p1-piece-1"` y `diceIndices: [0]`, y que las posiciones en Zustand solo cambian tras recibir otro snapshot.

En `game-fixtures.ts`, definir constructores completos y tipados `gameStateFixture(overrides)`, `gameRoomFixture(overrides)`, `gameWithLegalOptions(pieceIds)` y `gameSyncEvent({room, stateVersion})`. `gameRoomFixture` contiene cuatro jugadores ordenados, `stateVersion`, `gameState` nullable y `lastGameResult` nullable; el estado usa una ficha por jugador en casa, dados null, turno inicial y cero bonus. `gameSyncEvent` construye envoltura v1 con `room` y `game` iguales a los campos del room.

- [ ] **Step 2: Ejecutar la suite frontend focalizada y verificar que falla**

Run: `rtk pnpm --dir frontend exec vitest run src/types/protocol.test.ts src/stores/gameStore.test.ts src/hooks/useGameSocket.test.ts`
Expected: FAIL por tipos/validadores/callbacks nuevos ausentes y sync sin `gameState`.

- [ ] **Step 3: Implementar tipos, validación runtime, snapshots y acciones**

~~~ts
type GameState = {
  status: "playing" | "finished";
  playerOrder: string[];
  currentPlayerId: string | null;
  turnPhase: "waiting_for_roll" | "waiting_for_move" | "waiting_for_bonus" | "finished";
  diceValues: [number, number] | null;
  usedDiceIndices: number[];
  availableMoves: MoveOption[];
  pendingBonuses: PendingBonus[];
  pieces: Piece[];
  finishOrder: string[];
  winnerId: string | null;
  result: GameResult | null;
};
~~~

En el hook, construir callbacks de red como estos y aplicar el mismo patrón a movimiento de bonus, vuelta al lobby y replay:

~~~ts
const sendRollDice = () => sendCommand({ type: "ROLL_DICE", version: 1, requestId: crypto.randomUUID() });

const sendMovePiece = (pieceId: string, diceIndices: number[]) =>
  sendCommand({ type: "MOVE_PIECE", version: 1, requestId: crypto.randomUUID(), pieceId, diceIndices });
~~~

Crear `Piece`, `PiecePosition`, `MoveOption`, `PendingBonus`, `GameResult` y `PublicRoomState` además del estado mostrado. Ampliar `ClientCommand` y `ServerEvent` con todos los comandos/eventos del contrato; `GAME_STATE_SYNC` contiene `room` y `game: GameState | null`. Ampliar discriminated unions y runtime guards para eventos de juego; si sync no valida por completo o `payload.game` difiere de `payload.room.gameState`, mantener el último estado válido y registrar `INVALID_MESSAGE`. `GAME_STATE_SYNC` reemplaza el snapshot completo solo si su `stateVersion` no es antiguo. Los eventos semánticos se conservan en `recentEvents` para animaciones, pero no mutan piezas optimistamente. Añadir acciones que envían exactamente los comandos de la especificación con `crypto.randomUUID()` y no incluyen identidad, resultado del dado ni destino.

- [ ] **Step 4: Ejecutar tests frontend y typecheck**

Run: `rtk pnpm --dir frontend exec vitest run src/types/protocol.test.ts src/stores/gameStore.test.ts src/hooks/useGameSocket.test.ts`
Run: `rtk pnpm frontend:typecheck`
Expected: PASS; typescript estricto no debe necesitar casts `any` para snapshots de juego.

- [ ] **Step 5: Crear commit de estado y transporte del frontend**

~~~bash
rtk git add frontend/src/types/game.ts frontend/src/types/protocol.ts frontend/src/stores/gameStore.ts frontend/src/hooks/useGameSocket.ts frontend/src/test/game-fixtures.ts frontend/src/types/protocol.test.ts frontend/src/stores/gameStore.test.ts frontend/src/hooks/useGameSocket.test.ts
rtk git commit -m "feat: sync authoritative gameplay in frontend"
~~~

### Task 10: Proyección SVG de los tres tableros

**Files:**
- Create: `frontend/src/lib/board-layouts.ts`
- Create: `frontend/src/components/game/Board.tsx`
- Create: `frontend/src/components/game/Piece.tsx`
- Test: `frontend/src/lib/board-layouts.test.ts`
- Test: `frontend/src/components/game/Board.test.tsx`

**Interfaces:**
- Consumes: `GameState`, `PublicPlayer`, `BoardDefinition` equivalente solo en índices y estado lógico.
- Produces: `buildCrossLayout(4)`, `buildRadialLayout(5 | 6)`, `getBoardLayout(seatCount)`, `projectPiece(piece, layout, occupancy)` y `<Board room={room} game={game} currentPlayerId={id} onSelectPiece={callback} />`.

- [ ] **Step 1: Escribir tests fallidos de geometría, índices y selección**

~~~ts
import { vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { gameRoomFixture, gameWithLegalOptions } from "@/test/game-fixtures";

it.each([4, 5, 6] as const)("projects %i-seat logical track to unique SVG cells", (seatCount) => {
  const layout = getBoardLayout(seatCount);
  expect(layout.trackCells).toHaveLength(17 * seatCount);
  expect(new Set(layout.trackCells.map(({ x, y }) => `${x},${y}`)).size).toBe(17 * seatCount);
  expect(layout.finishPathsBySeat).toHaveLength(seatCount);
  expect(layout.finishPathsBySeat.every((path) => path.length === 7)).toBe(true);
});

it("renders only server-authorized movable pieces as selectable", () => {
  const onSelect = vi.fn();
  render(<Board room={gameRoomFixture()} game={gameWithLegalOptions(["p1-piece-2"])} currentPlayerId="p1" onSelectPiece={onSelect} />);
  const selectable = screen.getByRole("button", { name: /ficha 2.*mover/i });
  expect(selectable).toBeEnabled();
  expect(screen.getByRole("button", { name: /ficha 1/i })).toBeDisabled();
  fireEvent.click(selectable);
  expect(onSelect).toHaveBeenCalledWith("p1-piece-2", [0]);
});
~~~

- [ ] **Step 2: Ejecutar tests de geometría/UI y confirmar el fallo**

Run: `rtk pnpm --dir frontend exec vitest run src/lib/board-layouts.test.ts src/components/game/Board.test.tsx`
Expected: FAIL porque no hay proyección ni componentes de tablero.

- [ ] **Step 3: Implementar coordenadas normalizadas y SVG accesible**

~~~ts
type Point = { x: number; y: number };

type BoardLayout = {
  viewBox: "0 0 1000 1000";
  trackCells: readonly Point[];
  startCellIndicesBySeat: readonly number[];
  goalEntryCellIndicesBySeat: readonly number[];
  safeCellIndices: readonly number[];
  homeSlotsBySeat: readonly (readonly Point[])[];
  finishPathsBySeat: readonly (readonly Point[])[];
  goal: Point;
};

const boardLayouts: Record<4 | 5 | 6, BoardLayout> = {
  4: buildCrossLayout(4),
  5: buildRadialLayout(5),
  6: buildRadialLayout(6),
};

export function getBoardLayout(seatCount: 4 | 5 | 6): BoardLayout {
  return boardLayouts[seatCount];
}
~~~

Usar recorrido ortogonal en cruz para cuatro y sectores polares simétricos de 72°/60° para cinco/seis, con índices lógicos idénticos a backend. Definir casas, salidas, casillas seguras, carriles y meta en un viewBox normalizado. Fichas en la misma casilla se distribuyen en subposiciones estables; el estado `yard`, `track`, `finish_path` o `finished` decide la proyección. Dibujar selección y halo únicamente a partir de `availableMoves` del servidor; selección llama al callback y no mueve localmente. Agregar `aria-label`, `title`/`desc`, targets accesibles y animación con Framer Motion respetando `prefers-reduced-motion`.

- [ ] **Step 4: Ejecutar pruebas de proyección y verificar los tres conteos**

Run: `rtk pnpm --dir frontend exec vitest run src/lib/board-layouts.test.ts src/components/game/Board.test.tsx`
Expected: PASS; ninguna ficha debe quedar fuera del viewBox para las tres capacidades.

- [ ] **Step 5: Crear commit de tablero SVG**

~~~bash
rtk git add frontend/src/lib/board-layouts.ts frontend/src/components/game/Board.tsx frontend/src/components/game/Piece.tsx frontend/src/lib/board-layouts.test.ts frontend/src/components/game/Board.test.tsx
rtk git commit -m "feat: render responsive four-to-six player boards"
~~~

### Task 11: Mesa jugable, turnos y resultados

**Files:**
- Create: `frontend/src/components/game/Dice.tsx`
- Create: `frontend/src/components/game/TurnIndicator.tsx`
- Create: `frontend/src/components/game/VictoryModal.tsx`
- Create: `frontend/src/components/game/GameTable.tsx`
- Modify: `frontend/src/components/lobby/Lobby.tsx`
- Modify: `frontend/src/app/room/[code]/RoomPageClient.tsx`
- Modify: `frontend/src/app/globals.css`
- Modify: `DESIGN.md`
- Test: `frontend/src/components/game/GameTable.test.tsx`
- Test: `frontend/src/app/room/[code]/page.test.tsx`

**Interfaces:**
- Consumes: tablero de Task 10 y acciones/snapshots de Task 9.
- Produces: experiencia lobby/partida con un solo `useGameSocket` montado, roll, selección de ficha, bonus, controles de repetición y lista final de puestos.

- [ ] **Step 1: Escribir tests fallidos de estados principales y cambios de sala**

~~~tsx
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { gameRoomFixture, gameStateFixture, gameWithLegalOptions } from "@/test/game-fixtures";

it("shows the active player, authoritative dice, and roll availability", () => {
  const actions = { sendRollDice: vi.fn(), sendMovePiece: vi.fn(), sendMoveBonusPiece: vi.fn(), sendReturnToLobby: vi.fn(), sendPlayAgain: vi.fn() };
  render(<GameTable room={gameRoomFixture()} game={gameStateFixture({ turnPhase: "waiting_for_roll", currentPlayerId: "p1", diceValues: null })} currentPlayerId="p1" actions={actions} />);
  expect(screen.getByText("Tu turno")).toBeVisible();
  expect(screen.getByRole("button", { name: /tirar dados/i })).toBeEnabled();
});

it("shows only legal piece choices and offers bonus movement separately", () => {
  const actions = { sendRollDice: vi.fn(), sendMovePiece: vi.fn(), sendMoveBonusPiece: vi.fn(), sendReturnToLobby: vi.fn(), sendPlayAgain: vi.fn() };
  const legalGame = gameWithLegalOptions(["p1-piece-2"]);
  render(<GameTable room={gameRoomFixture()} game={gameStateFixture({ turnPhase: "waiting_for_bonus", pendingBonuses: [{ playerId: "p1", steps: 20, reason: "capture" }], availableMoves: legalGame.availableMoves })} currentPlayerId="p1" actions={actions} />);
  expect(screen.getByRole("button", { name: /ficha 2.*mover/i })).toBeEnabled();
  expect(screen.getByText(/bonus de 20/i)).toBeVisible();
});

it("shows complete standings and replay/lobby actions after the server finishes", () => {
  const actions = { sendRollDice: vi.fn(), sendMovePiece: vi.fn(), sendMoveBonusPiece: vi.fn(), sendReturnToLobby: vi.fn(), sendPlayAgain: vi.fn() };
  render(<GameTable room={gameRoomFixture()} game={gameStateFixture({ status: "finished", turnPhase: "finished", winnerId: "p1", finishOrder: ["p1", "p2", "p3"] })} currentPlayerId="p1" actions={actions} />);
  expect(screen.getByRole("heading", { name: /felipe ganó/i })).toBeVisible();
  expect(screen.getByText(/4.*ana/i)).toBeVisible();
  expect(screen.getByRole("button", { name: /jugar de nuevo/i })).toBeEnabled();
});
~~~

En `frontend/src/app/room/[code]/page.test.tsx`, añadir la transición autoritativa:

~~~tsx
it("switches the room route from lobby to the game only after authoritative sync", async () => {
  readSessionMock.mockReturnValue({ roomCode: "AB7K2", playerId: "p1", playerToken: "token-1", isHost: true });
  render(<RoomPageClient code="AB7K2" />);
  act(() => useGameStore.getState().applyEvent(gameSyncEvent({
    stateVersion: 9,
    room: gameRoomFixture({ status: "playing", stateVersion: 9, gameState: gameStateFixture() }),
  })));
  expect(await screen.findByRole("heading", { name: /mesa de juego/i })).toBeInTheDocument();
});
~~~

Importar `act`, `gameRoomFixture`, `gameStateFixture` y `gameSyncEvent` en ese test; ampliar el mock `useGameSocketMock` con los cinco callbacks de juego para que el componente de sala pueda montar la mesa.

- [ ] **Step 2: Ejecutar tests de mesa y ruta; confirmar el fallo inicial**

Run: `rtk pnpm --dir frontend exec vitest run 'src/components/game/GameTable.test.tsx' 'src/app/room/[code]/page.test.tsx'`
Expected: FAIL porque la ruta aún muestra el placeholder de partida y los componentes no existen.

- [ ] **Step 3: Construir mesa de juego y conectar fase por snapshot**

~~~tsx
export function GameTable({ room, game, currentPlayerId, actions }: GameTableProps) {
  return (
    <main className="game-shell">
      <TurnIndicator room={room} game={game} currentPlayerId={currentPlayerId} />
      <Board room={room} game={game} currentPlayerId={currentPlayerId} onSelectPiece={actions.sendMovePiece} />
      <Dice game={game} onRoll={actions.sendRollDice} />
      {game.status === "finished" ? <VictoryModal room={room} game={game} actions={actions} /> : null}
    </main>
  );
}
~~~

Montar `useGameSocket` una sola vez en el componente cliente de la sala y pasar callbacks al lobby o a la mesa para no crear sockets dobles al cambiar fase. Mostrar nombre, color, presencia/autopiloto, jugador activo, valores de dados, fase, bonus y posiciones; controles deshabilitados según conexión y fase. El overlay de victoria calcula posiciones desde `finishOrder` y el jugador restante; los botones envían `PLAY_AGAIN` o `RETURN_TO_LOBBY`, sin limpiar estado local optimistamente. La mesa da prioridad visual al SVG y se adapta a escritorio/tablet/móvil sin scroll horizontal. Actualizar `DESIGN.md` para incorporar superficies de juego, estados activos/deshabilitados y movimiento reducido; mantener fieltro violeta, madera oscura y colores existentes. No añadir chat, sonidos sociales, regalos ni reacciones.

- [ ] **Step 4: Ejecutar pruebas focalizadas y confirmar estados accesibles**

Run: `rtk pnpm --dir frontend exec vitest run 'src/components/game/GameTable.test.tsx' 'src/app/room/[code]/page.test.tsx'`
Expected: PASS para lobby, partida, bonus, jugador desconectado, ganador y vuelta/replay; botones de acción deben reflejar fase y conexión.

- [ ] **Step 5: Crear commit de la mesa de juego**

~~~bash
rtk git add frontend/src/components/game/Dice.tsx frontend/src/components/game/TurnIndicator.tsx frontend/src/components/game/VictoryModal.tsx frontend/src/components/game/GameTable.tsx frontend/src/components/game/GameTable.test.tsx frontend/src/components/lobby/Lobby.tsx frontend/src/app/room/[code]/RoomPageClient.tsx frontend/src/app/room/[code]/page.test.tsx frontend/src/app/globals.css DESIGN.md
rtk git commit -m "feat: build playable game table and results screen"
~~~

### Task 12: Flujo de aceptación, documentación y verificación de extremo a extremo

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: suites de motor, protocolo y UI integrados en Tasks 1–11.
- Produces: documentación de alcance/ejecución actualizada y evidencia final de aceptación en las suites completas.

- [ ] **Step 1: Actualizar la documentación del alcance ya implementado**

In `README.md`, describir Fase 2 con estas frases: “La Fase 2 incluye tableros para 4, 5 y 6 personas, partida autoritativa en tiempo real, reconexión con autopiloto y repetición en la misma sala”; “El estado permanece en memoria y chat, reacciones y regalos se aplazan a Fase 3”. Enlazar la especificación de juego del 2026-09-25 junto a la especificación general.

- [ ] **Step 2: Ejecutar primero las pruebas de aceptación y examinar fallos reales**

Run: `rtk rg -n 'Fase 2 incluye tableros|estado permanece en memoria|2026-09-25-parchis-online-phase-2-gameplay-design' README.md`
Expected: encontrar las dos afirmaciones y el enlace a la especificación.

- [ ] **Step 3: Comprobar aceptación funcional y visual en la aplicación**

Confirmar con las pruebas ya escritas que los límites de capacidad 4/5/6, el ciclo de dados/movimientos, el final N−1, la reconexión y la vista lobby→mesa→resultado→lobby están cubiertos. Después, ejecutar backend y frontend según el README, crear una sala de cada capacidad con las ventanas/navegadores disponibles y revisar las mesas en escritorio, tablet y móvil; verificar que el tablero no se recorta ni fuerza scroll horizontal, que los seis asientos se distinguen, que el turno y los controles siguen legibles y que lobby, resultado, vuelta al lobby y revancha se pueden recorrer. Activar `prefers-reduced-motion` en el navegador/SO y confirmar que las transiciones no son imprescindibles para entender el estado. Si alguna prueba o revisión falla, corregir primero la tarea propietaria y repetir su suite focalizada.

- [ ] **Step 4: Ejecutar todas las verificaciones requeridas**

Run: `rtk uv run --project backend pytest -q`
Expected: PASS en todas las pruebas backend, incluidas las preexistentes de Fase 1.

Run: `rtk pnpm frontend:typecheck`
Expected: PASS sin relajar TypeScript estricto.

Run: `rtk pnpm frontend:test`
Expected: PASS en toda la suite frontend.

Run: `rtk pnpm frontend:build`
Expected: build de producción exitoso.

Run: `rtk rg -n 'table-felt|piece-green|prefers-reduced-motion|tablero|mesa de juego' DESIGN.md frontend/src/app/globals.css`
Expected: encontrar los tokens visuales y las pautas incorporadas en Task 11; la revisión visual manual y de movimiento reducido se documenta en Task 12, Step 3.

- [ ] **Step 5: Crear commit de aceptación y documentación**

~~~bash
rtk git add README.md
rtk git commit -m "test: verify complete multiplayer gameplay flows"
~~~

## Criterio de salida

La Fase 2 está lista cuando las suites de backend y frontend y el build pasan; las pruebas demuestran creación de salas de 4/5/6, dados y movimientos autoritativos, barreras/bonus/clasificación, desconexión con autopiloto y recuperación por token vigente; y el snapshot proyecta los mismos estados de partida para todos los navegadores. Las pruebas de contrato deben confirmar que no se filtran tokens y que reintentos no aplican una mutación dos veces. La aceptación visual manual debe revisar una mesa de 4, 5 y 6 participantes, tablet/móvil y movimiento reducido antes de integrar el branch.
