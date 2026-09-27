# Parchís Online — Diseño de Fase 2: tablero y juego

Fecha: 2026-09-25  
Estado: en revisión escrita por el usuario  
Alcance: tablero, motor de reglas y partida en tiempo real para 4, 5 y 6 jugadores

Esta especificación concreta la Fase 2 del producto y supersede, para el juego, las decisiones provisionales de la especificación general del 2026-09-14 que asumían un dado, bonus de turno con un seis y cierre al primer ganador. La Fase 1 de salas, lobby, credenciales y reconexión sigue siendo la base.

## 1. Objetivo y límites

Convertir una sala de Fase 1 en una partida de Parchís jugable para la capacidad elegida de 4, 5 o 6 personas. El servidor conserva la autoridad sobre el dado, las reglas, las fichas, las capturas, los bonus, los turnos y la clasificación. El cliente dibuja el estado recibido y transmite intenciones; no determina si una jugada es válida.

La fase incluye:

- Tableros completos para 4, 5 y 6 jugadores, con cuatro fichas por jugador.
- Dos dados generados en el servidor, elección de movimientos, turnos y bonus.
- Salida de casa, casillas seguras, barreras, capturas, pasillo final, llegada exacta y clasificación.
- Sincronización WebSocket, snapshot de recuperación y autopiloto temporal para jugadores desconectados.
- Interfaz SVG responsive, animaciones de movimientos confirmados y pantalla de resultados.

Quedan fuera de esta fase chat, reacciones, sonidos sociales, regalos, persistencia PostgreSQL/Redis, pagos, monedas, tienda, anuncios, ranking público y matchmaking.

## 2. Integración con la Fase 1

Se conserva el flujo y las garantías ya implementadas:

- Una sala inicia solamente al alcanzar su capacidad configurada y cuando todos sus asientos están conectados y listos; únicamente el anfitrión puede iniciarla.
- El orden de asientos (`seatIndex`), los colores y la identidad autenticada del WebSocket son la base para crear la partida.
- El token de jugador sigue siendo privado; las acciones de juego obtienen la identidad del handshake autenticado y no de un `playerId` enviado por el cliente.
- Las mutaciones se serializan bajo el lock existente de cada sala. Cada cliente recibe eventos semánticos y el snapshot autoritativo de la misma versión de estado.
- El handshake `RECONNECT` y la reserva de asiento de Fase 1 se mantienen. Durante una partida no se elimina al jugador del roster al expirar la reserva: el autopiloto puede completar la partida. La reserva vigente de diez minutos determina durante cuánto tiempo se acepta su token para recuperar el control manual.

La sala conserva su modelo actual y agrega `gameState` al pasar a `playing`. Al terminar, el resultado se copia a `lastGameResult` con `winnerId` y `placements: [{ playerId, rank }]`, para que pueda seguir visible si se vuelve al lobby; se limpia al iniciar la siguiente partida. En lobby, `gameState` es `null`; en una partida terminada conserva el estado final hasta que alguien vuelva al lobby.

## 3. Arquitectura

### Backend

- `app/game/board.py`: `BoardFactory` y definiciones lógicas de recorridos, salidas, seguridad, entradas y pasillos finales para cada cantidad de asientos.
- `app/game/models.py`: modelos de partida, turnos, dados, fichas, bonus y resultado.
- `app/game/rule_config.py`: valores configurables de la variante.
- `app/game/rules.py`: reglas del dominio, invocables sin FastAPI ni WebSockets.
- `app/game/dice.py`: interfaz de generación de dados; producción usa aleatoriedad segura del servidor y los tests inyectan resultados deterministas.
- `app/game/autoplayer.py`: política sencilla que elige exclusivamente entre acciones legales producidas por el motor.
- `RoomManager` autentica al jugador, coordina la transición de estado, persiste en el repositorio actual y mantiene el lock por sala. El enrutador WebSocket traduce los mensajes de transporte en llamadas al dominio, pero no contiene reglas.

Las funciones del motor reciben estado y acciones de dominio, validan invariantes y devuelven una transición y eventos de dominio. Las pruebas de reglas no requieren iniciar FastAPI.

### Frontend

- `types/game.ts` y `types/protocol.ts` describen el estado de juego y los mensajes.
- `stores/gameStore.ts` conserva el snapshot del servidor, la versión aplicada y el estado de conexión.
- `hooks/useGameSocket.ts` administra conexión, reconexión, comandos y eventos.
- `components/game/Board.tsx`, `Piece.tsx`, `Dice.tsx`, `TurnIndicator.tsx` y `VictoryModal.tsx` presentan el juego.
- `lib/board-layouts.ts` convierte identificadores lógicos de casilla a coordenadas SVG.

Los componentes no calculan movimientos legales ni actualizan posiciones de manera optimista. Las animaciones se reproducen a partir de eventos aceptados por el servidor.

## 4. Modelo lógico del tablero

El dominio representa casillas con identificadores e índices, nunca con coordenadas gráficas. `BoardDefinition` contiene:

```text
seatCount
trackLength
boardPath
startCellsBySeat
goalEntryCellsBySeat
safeCells
homePathsBySeat
finishCellsBySeat
```

La ruta común tiene 17 casillas por asiento: 68 para 4 jugadores, 85 para 5 y 102 para 6. La salida del asiento `i` está en el índice `i * 17`; la entrada al pasillo de ese asiento está en `(startCell + (seatCount - 1) * 17) % trackLength`. Cada jugador recorre la ruta en la misma dirección hasta su entrada al pasillo final. La geometría se guarda en `BoardDefinition`, no se recalcula desde coordenadas visuales.

La Fase 2 usa una longitud común y configurable de siete casillas para cada pasillo final, seguida por la meta. Las salidas son seguras. Cada segmento de 17 casillas tiene otra casilla segura en el offset relativo `+8` desde su salida, de modo que las casillas seguras son simétricas en los tres tamaños.

El tablero visual es una proyección independiente:

- **4 jugadores:** recorrido tradicional en cruz.
- **5 jugadores:** tablero radial con cinco sectores de 72 grados, cinco casas y cinco pasillos finales simétricos.
- **6 jugadores:** tablero radial con seis sectores de 60 grados, seis casas y seis pasillos finales simétricos.

Para 5 y 6 jugadores cambia el layout, no las reglas ni la forma de almacenar las posiciones. El frontend conserva una tabla de coordenadas SVG normalizadas para cada capacidad; las fichas en casa, ruta común, pasillo final y meta se proyectan desde su estado lógico.

Estado lógico de una ficha:

```text
id
playerId
state: yard | track | finish_path | finished
trackPosition: índice absoluto de la ruta común o null
finishProgress: índice relativo del pasillo final o null
```

`yard` significa la casa de salida; `finished` significa que la ficha llegó a la meta. Esta distinción evita confundir estar en casa al inicio con haber terminado.

## 5. Reglas iniciales

Los valores se centralizan en `GameRulesConfig` para permitir variantes futuras sin acoplarlas a transporte o interfaz.

```text
pieces_per_player = 4
dice_count = 2
die_sides = 6
exit_value = 5
exact_finish = true
capture_bonus_steps = 20
goal_bonus_steps = 10
blockades_enabled = true
blockade_size = 2
extra_turn_condition = doubles
```

### Dados y movimientos

1. `ROLL_DICE` no lleva valores. El servidor genera ambos resultados y registra cuáles siguen disponibles.
2. Se puede jugar cada dado como un movimiento individual; los dos movimientos pueden usar fichas distintas o, si las reglas del recorrido lo permiten, la misma ficha de manera secuencial.
3. También se puede sumar ambos dados para un movimiento de una ficha.
4. Si existe una secuencia legal que use ambos dados por separado, se debe usar ambos; en ese caso no se permite sustituirla por la suma. Si no hay secuencia completa separada, se ofrece la suma cuando sea legal y también cualquier movimiento legal que use un solo dado.
5. La ficha sale de `yard` con valor total exactamente 5: puede ser un dado que muestre 5 o la suma de ambos dados. Si queda alguna ficha en `yard` y existe una salida legal, salir es obligatorio y prevalece sobre otros movimientos, incluso sobre una secuencia normal de dados separados. Si se usa un dado que muestra 5, el otro dado queda disponible; si se usa la suma, se consumen ambos. Si no hay fichas en `yard` o la salida no es legal, se ofrecen los demás movimientos legales.
6. El movimiento a meta requiere el valor exacto. Toda opción debe respetar el recorrido, las barreras y la entrada al pasillo final.
7. Un doble (dos resultados iguales) otorga otro turno después de completar los movimientos y bonus pendientes. Un seis individual no concede turno extra. No hay penalización por dobles consecutivos en esta fase.
8. Si no existe movimiento legal, se cierra la fase de movimiento; un doble sigue concediendo el turno extra.

El motor produce las opciones legales completas. El cliente puede resaltarlas, pero el servidor vuelve a validar el dado, la ficha, el orden y el destino antes de aplicar cada acción.

### Casillas seguras, capturas y barreras

- En una jugada normal, las casillas seguras impiden capturas. Cada jugador tiene su propia casilla segura de salida (`start_cells_by_seat`), no una única casilla global.
- Si al salir de `yard` solo hay una ficha rival en esa salida, no se captura; la ficha que sale y la rival comparten la casilla segura.
- Si ya hay dos fichas en la salida y al menos una es rival, salir captura a la rival que llegó más recientemente y concede el bonus habitual de +20. Esto incluye dos rivales del mismo color, dos de colores distintos o una ficha propia junto a una rival. Tras la captura quedan como máximo dos fichas; un bloqueo de dos fichas propias impide la salida.
- Una captura manda la ficha rival a `yard` y encola un bonus de 20 casillas para una ficha propia elegible.
- Dos o más fichas del mismo jugador en una misma casilla común forman una barrera.
- Ninguna ficha puede atravesar una barrera; una ficha rival no puede aterrizar en ella. Una barrera no es capturable.
- Si el jugador que tiene una barrera obtiene dobles, mueve una de las fichas que la forman usando uno de los dados; ese movimiento rompe la barrera y el otro dado sigue disponible. Si hay varias barreras, elige una que pueda abrir legalmente. Si ninguna ficha de barrera tiene un movimiento legal, se ofrecen las demás jugadas legales del doble. La tirada sigue concediendo turno extra.

### Bonus de captura y de meta

- Capturar concede 20 casillas; completar el pasillo final y llegar a meta con una ficha concede 10.
- Cada bonus es un movimiento exacto de una ficha propia elegible y se aplica como movimiento del dominio, no como una nueva tirada.
- Los bonus se encolan en el orden en que se generan, se resuelven después de gastar los dados y antes de cerrar el turno. Un bonus sin ningún movimiento legal se descarta.
- Una captura o llegada a meta producida por un movimiento de bonus puede encolar el bonus correspondiente.
- El bonus no concede turno extra. El turno extra depende exclusivamente de un doble.

## 6. Turno, victoria y repetición

El orden inicial es `seatIndex` ascendente; al pasar turno se omiten jugadores que ya completaron sus cuatro fichas. `GameState` contiene:

```text
status
currentPlayerId
turnPhase: waiting_for_roll | waiting_for_move | waiting_for_bonus | finished
diceValues: [d1, d2] | null
usedDiceIndices
availableMoves: opciones legales calculadas por el servidor
pendingBonuses
pieces
finishOrder
winnerId
```

`RoomState` conserva `lastGameResult` fuera de `GameState`, como puestos finales de la partida anterior o `null`.

El servidor crea las cuatro fichas por jugador al iniciar, inicia el turno del primer asiento y conserva el estado y los dados usados en snapshots de reconexión.

Al terminar las cuatro fichas, un jugador obtiene su puesto según el orden de llegada. La partida concluye cuando han terminado todos menos uno. El último jugador recibe el puesto restante aunque aún tenga fichas sin llegar a meta. Así se esperan los puestos 1.º a 3.º en una partida de cuatro, 1.º a 4.º en una de cinco y 1.º a 5.º en una de seis.

La pantalla final muestra todos los puestos y ofrece **Jugar de nuevo** y **Volver al lobby**. Cualquier participante puede elegir una acción; por tratarse de una sala compartida, el cambio de fase se sincroniza con todos. Ambas conservan participantes, colores y `lastGameResult`, limpian la partida activa y ponen a todos como no listos. Jugar de nuevo también marca listo al jugador que lo solicitó. No empieza otra partida hasta que todos vuelvan a estar conectados y listos y el anfitrión la inicie. El último resultado permanece visible en el snapshot del lobby hasta que comience la siguiente partida.

## 7. Protocolo WebSocket

Se extiende el contrato JSON v1 existente para los clientes de esta aplicación. Los comandos mutables incluyen `requestId`; los rechazos devuelven `ERROR` correlacionado y no modifican el estado.

Comandos nuevos:

```text
ROLL_DICE       { type, version, requestId }
MOVE_PIECE      { type, version, requestId, pieceId, diceIndices }
MOVE_BONUS_PIECE { type, version, requestId, pieceId }
RETURN_TO_LOBBY  { type, version, requestId }
PLAY_AGAIN       { type, version, requestId }
```

`diceIndices` solo identifica el resultado que el cliente quiere usar (`[0]`, `[1]` o `[0, 1]`); nunca contiene valores ni destinos. Para usar los dos dados por separado, el jugador envía sus movimientos secuenciales y el servidor conserva la obligación y legalidad del segundo. La opción presentada para el primer movimiento debe garantizar que el plan pueda completarse conforme a las reglas.

Eventos nuevos o ampliados:

```text
GAME_STARTED
TURN_STARTED
DICE_ROLLED          { playerId, values: [d1, d2], availableMoves }
PIECE_MOVED          { pieceId, from, to, diceIndices }
PIECE_CAPTURED       { capturedPieceId, byPieceId, bonusSteps: 20 }
BONUS_GRANTED        { playerId, steps: 10 | 20, reason }
BONUS_SKIPPED
TURN_ENDED
PLAYER_FINISHED      { playerId, rank }
GAME_FINISHED        { finishOrder, lastPlayerId }
GAME_STATE_SYNC      { room, game: GameState | null }
GAME_RESET           { status: "lobby", requestedReplay, requesterId }
ERROR
```

`GAME_STATE_SYNC` incluye `lastGameResult` cuando exista. `GAME_RESET` acompaña la transición posterior al resultado: `RETURN_TO_LOBBY` usa `requestedReplay: false`; `PLAY_AGAIN` usa `requestedReplay: true` y marca listo al solicitante.

Los eventos semánticos de una transición y su `GAME_STATE_SYNC` comparten la versión resultante. Las versiones son monotónicas y el cliente ignora snapshots antiguos. El snapshot no incluye credenciales privadas. Tras reconectar, el servidor envía el estado completo, incluidos dados ya usados, opciones legales calculadas, bonus pendientes, orden de llegada y modo automático.

## 8. Autopiloto y reconexión durante la partida

Una desconexión en una partida no bloquea a los demás. Al tocarle el turno a una persona desconectada, el servidor opera por esa identidad autenticada y ejecuta tiradas y movimientos mediante el mismo motor y las mismas validaciones que para una persona conectada.

La política MVP elige exclusivamente de las acciones legales y prioriza, en este orden: completar una ficha, capturar, ocupar un destino seguro, sacar una ficha cuando sea legal y avanzar una ficha propia. Los empates se resuelven de forma determinista para que los tests sean reproducibles. El dado sigue siendo aleatorio y generado en servidor.

Al reconectarse con su token, el jugador recupera el control en la siguiente decisión pendiente. El autopiloto no altera fichas, turnos ni identidad; únicamente ejecuta acciones normales cuando el jugador está desconectado. Si vence la reserva de token durante una partida, se mantiene el asiento de juego y el autopiloto puede continuar, pero el token expirado ya no permite recuperar control manual.

## 9. Experiencia de juego

- El tablero ocupa el área central y es la superficie dominante.
- El turno activo, el nombre del jugador y el resultado de los dados se muestran de forma persistente y legible.
- Se resaltan únicamente fichas y opciones legales informadas por el servidor.
- Los botones de dado y movimiento reflejan conexión, fase, acción pendiente y estado deshabilitado.
- Los eventos confirmados animan dado, movimiento, captura, bonus, ruptura de barrera, llegada a meta, cambio de turno y victoria sin bloquear otras acciones.
- Se respeta el sistema visual de `DESIGN.md`: fieltro violeta, madera oscura, tipografía y colores de ficha existentes. La interfaz sigue en español y funciona en escritorio y tablet; el layout se adapta a móvil sin desplazar el tablero fuera de pantalla.
- Chat, regalos y reacciones no aparecen en esta fase.

## 10. Pruebas y aceptación

### Motor de juego, sin FastAPI

- Creación de tablero para 4, 5 y 6 asientos, con ruta, entradas, casillas seguras y pasillos simétricos.
- Creación de cuatro fichas por jugador, orden de turnos y omisión de jugadores ya clasificados.
- Tiradas de dos dados inyectadas: suma, división en dos movimientos, orden de movimiento y dados que no se pueden usar.
- Salida con un cinco o con suma cinco; rechazo de salidas inválidas.
- Dobles conceden turno extra; un seis que no sea doble no lo hace.
- Doble rompe una barrera propia moviendo una de sus fichas con un dado y deja el otro disponible.
- Barreras impiden cruzar; rivales no aterrizan; casillas seguras no capturan.
- Captura reinicia la ficha rival y otorga 20; llegada exacta a meta otorga 10.
- Bonus pendientes, bonus no utilizables, captura/meta encadenada y prioridad antes de cerrar turno.
- Pasillo final, llegada exacta, cuatro fichas completadas, orden de puestos y final con N−1 jugadores clasificados.
- Acciones del autopiloto son siempre legales y la reconexión devuelve control manual en la siguiente decisión.

### Integración

- Inicio reservado al host con capacidad completa, jugadores conectados y listos.
- Rechazo de tirada fuera de turno, segundo lanzamiento prematuro, ficha ajena, movimiento ilegal, dado del cliente y comandos sin autenticar.
- Eventos semánticos y snapshots con las mismas versiones para todos; recuperación del estado de dados, barrera, bonus y clasificación al reconectar.
- Desconexión en turno activo activa autopiloto, y reconexión devuelve el control sin duplicar acciones.
- Idempotencia por `requestId` ante reintentos.

### Frontend

- Pruebas de proyección SVG para 4/5/6, selección visual de acciones válidas, estado del turno y snapshot antiguo ignorado.
- Typecheck estricto, suite de frontend y build de producción.

La fase se acepta cuando una sala real de 4, 5 y 6 navegadores puede empezar, completar turnos con dos dados, validar barreras/bonus, reconectar con autopiloto, mostrar las posiciones hasta el penúltimo puesto y volver al lobby sin divergencia entre clientes.

## 11. Riesgos y decisiones conservadoras

- Las variantes regionales se limitan a la configuración de reglas; no se ofrecerá un editor de reglas en esta fase.
- 5 y 6 jugadores son layouts radiales nuevos, no se intentará duplicar una geometría tradicional de cuatro colores. La lógica se mantiene independiente del layout para poder ajustar su apariencia después.
- El almacenamiento de partidas sigue en memoria y el despliegue presupone una instancia de backend; Redis y persistencia duradera quedan aplazados.
- El autopiloto es una política ligera para mantener fluidez, no una IA estratégica; nunca puede saltarse una regla ni cambiar el resultado del dado.
- Los movimientos de varias fichas se aplican y sincronizan bajo el lock de sala para impedir que dos comandos concurrentes gasten el mismo dado.
