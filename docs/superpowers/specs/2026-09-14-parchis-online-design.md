# Parchís Online privado — Diseño del MVP

Fecha: 2026-09-14
Estado: diseño validado en conversación; listo para revisión escrita

## 1. Objetivo

Construir desde cero una aplicación web de Parchís multijugador para partidas privadas entre amigos. Una sala tendrá de 4 a 6 jugadores, código y enlace de invitación, lobby, presencia en tiempo real, tablero, dado, turnos, movimientos, reglas autoritativas del servidor, reconexión y pantalla de victoria.

El producto no incluirá pagos, monedas, tienda, publicidad, suscripciones, ranking global ni matchmaking público. Chat, reacciones, sonidos y regalos gratuitos pertenecen al MVP 2 y se diseñarán como una capa social independiente del motor de juego.

El diseño prioriza una primera instalación local sencilla, pero mantiene interfaces explícitas para migrar el estado temporal a Redis y añadir PostgreSQL cuando se necesiten historial y estadísticas.

## 2. Decisiones principales

- Monorepo poliglota: Next.js/React/TypeScript para frontend y FastAPI/Python para backend.
- El backend es la única autoridad para identidad de sesión, turnos, dados, movimientos, capturas y ganador.
- La lógica de juego no depende de FastAPI, WebSockets, Redis ni coordenadas visuales.
- La primera persistencia será en memoria detrás de un repositorio abstracto.
- La comunicación entre frontend y backend tendrá contratos versionados v1.
- La variante inicial será flexible: reglas tradicionales como base, con opciones por sala.
- El tablero lógico será común para 4, 5 y 6 jugadores; únicamente cambiará su layout visual.
- No se usará estado optimista para dados ni movimientos.

## 3. Arquitectura del repositorio

La estructura inicial será:

    /Users/felipecanas/Projects/Parchis_teleton/
    ├── frontend/
    ├── backend/
    ├── contracts/
    ├── docs/
    ├── .env.example
    └── README.md

El backend tendrá límites internos:

    backend/
    ├── app/
    │   ├── main.py
    │   ├── api/
    │   │   ├── rooms.py
    │   │   └── websocket.py
    │   ├── game/
    │   │   ├── models.py
    │   │   ├── board.py
    │   │   ├── rules.py
    │   │   ├── rule_config.py
    │   │   └── dice.py
    │   ├── realtime/
    │   │   ├── connection_manager.py
    │   │   └── events.py
    │   ├── services/
    │   │   └── room_manager.py
    │   ├── repositories/
    │   │   ├── room_repository.py
    │   │   └── memory_room_repository.py
    │   └── schemas/
    │       ├── rooms.py
    │       └── websocket.py
    └── tests/

El frontend tendrá rutas, componentes y estado separados:

    frontend/
    ├── app/
    │   ├── page.tsx
    │   └── room/[code]/page.tsx
    ├── components/
    │   ├── game/
    │   ├── lobby/
    │   └── social/
    ├── hooks/
    │   ├── useGameSocket.ts
    │   └── useLocalSession.ts
    ├── stores/
    │   └── gameStore.ts
    ├── lib/
    │   ├── websocket.ts
    │   └── board-layouts.ts
    ├── types/
    │   └── game.ts
    └── styles/

contracts/ contendrá los tipos de sobre, comandos, eventos y payloads JSON de la versión v1. Python los validará con Pydantic y TypeScript tendrá tipos y validación equivalente. El motor no importará contratos de transporte: recibirá comandos de dominio ya validados.

La aplicación se ejecutará inicialmente con una única instancia del backend. Cada sala tendrá un asyncio.Lock para serializar acciones concurrentes. RoomRepository será la frontera para sustituir el almacenamiento en memoria por Redis; no se introducirá pub/sub ni despliegue multi-instancia hasta que exista esa necesidad.

## 4. Modelo de dominio

Una sala contiene el código, capacidad, host, jugadores, estado de juego y reservas temporales. El código tendrá cinco caracteres alfanuméricos en mayúsculas, evitando caracteres visualmente ambiguos. No habrá espectadores en MVP 1.

Jugador:

    id: str
    display_name: str
    color: PlayerColor
    seat_index: int
    is_host: bool
    is_ready: bool
    is_connected: bool
    finished_rank: int | None

El servidor conservará el hash del playerToken junto al jugador. El token plano solo se devuelve al crear o unirse a una sala y el cliente lo almacena localmente.

Ficha:

    id: str
    player_id: str
    state: "home" | "board" | "finish_path" | "finished"
    position: int | None

La posición es un índice absoluto de la ruta compartida cuando state es board, un índice relativo del pasillo del jugador cuando state es finish_path y None en home o finished.

Estado de partida:

    room_code: str
    status: "lobby" | "playing" | "finished"
    settings: GameSettings
    players: list[Player]
    pieces: list[Piece]
    board: BoardDefinition
    current_player_id: str | None
    turn_phase: "waiting_for_roll" | "waiting_for_piece" | "waiting_for_bonus_piece" | "finished"
    dice: DiceState
    pending_bonus_steps: int
    winner_ids: list[str]
    sequence: int

DiceState contendrá value, rolled, rolled_by_player_id y consecutive_sixes. El servidor limpiará el dado al comenzar un nuevo turno. Cuando no existan movimientos legales, el motor avanzará el turno según la configuración, sin permitir que el cliente fuerce un movimiento.

## 5. Reglas configurables

La configuración por defecto del MVP será:

    player_count: 4 | 5 | 6
    pieces_per_player: 4
    exit_roll: 5
    extra_turn_rolls: [6]
    exact_finish: true
    capture_bonus_steps: 20
    safe_cells_block_capture: true
    allow_blockades: true
    blockade_size: 2
    triple_six_rule: "none" | "return_last_piece_home"
    must_move_if_possible: true

La configuración se guardará dentro de la sala para que todos los clientes reciban la misma variante. Las reglas no se implementarán dentro de los WebSockets ni en React.

GameRules expondrá operaciones puras equivalentes a:

    can_roll(state, player_id)
    available_moves(state, player_id, dice_value)
    can_leave_home(state, piece_id, dice_value)
    move_piece(state, piece_id, dice_value)
    capture_piece(state, moved_piece_id)
    enter_finish_path(state, piece_id, dice_value)
    has_won(state, player_id)
    next_turn(state)

Las operaciones reciben el estado y los datos de dominio necesarios, validan invariantes y producen un nuevo estado junto con un resultado de dominio; no mutan el estado recibido. La identidad autorizada la resolverá RoomManager antes de invocar el motor, y RoomManager confirmará el nuevo estado bajo el lock de la sala.

Un resultado de movimiento puede incluir la ficha movida, origen y destino lógicos, fichas capturadas, si entró en pasillo final, si terminó una ficha y si el jugador ganó. Si una captura genera bonus, pending_bonus_steps toma capture_bonus_steps y el mismo jugador pasa a waiting_for_bonus_piece. Puede escoger cualquier ficha propia con un movimiento legal usando ese valor; después se limpia el bonus y se aplica la regla de turno del lanzamiento original. Si ninguna ficha puede usar el bonus, se descarta y se aplica directamente la regla de turno. La generación del dado dependerá de una interfaz DiceRoller: producción usa aleatoriedad segura del servidor y los tests inyectan valores deterministas.

En el recorrido compartido nunca puede haber más de dos fichas en una misma casilla, incluidas las casillas seguras. Una barrera contiene blockade_size fichas del mismo jugador en una casilla común. Ninguna ficha puede atravesar una barrera rival ni aterrizar normalmente en ella; su dueño puede romperla moviendo una ficha, y al sacar dobles la salida de la barrera usa uno de los dados según la configuración. Con allow_blockades desactivado, se ignoran las restricciones de barrera, pero se conserva la capacidad máxima de dos fichas por casilla.

En una jugada normal, una casilla segura impide capturas. Cada asiento tiene su propia casilla segura de salida (`start_cells_by_seat`); no hay una única salida compartida. Al sacar una ficha del patio, si solo hay una ficha rival en esa salida, no se captura y ambas fichas pueden compartirla. Si ya hay dos fichas en la casilla y al menos una es rival, la salida captura a la ficha rival que llegó más recientemente y concede el bonus habitual de `capture_bonus_steps` (20 por defecto). Esto aplica tanto a dos rivales (sean del mismo color o distintos) como a una ficha propia junto a una rival. Después de la captura, la casilla queda con dos fichas como máximo; si las dos fichas que ya están allí son propias, el bloqueo impide salir.

Si una ficha permanece en el patio y existe una salida legal usando un valor total de 5, esa salida es obligatoria antes que cualquier movimiento ordinario. El 5 puede ser el resultado de un dado o la suma de los dos dados. Al usar un único dado de 5, el otro dado sigue disponible; al sumar ambos para obtener 5, se consumen ambos. Si todas las fichas del jugador están fuera o ninguna salida es legal, se ofrecen las demás jugadas legales.

Con triple_six_rule igual a return_last_piece_home, tres seises consecutivos del mismo jugador en la secuencia de turnos hacen que la última ficha movida por ese jugador vuelva a home. Con none no existe esa penalización. La partida continúa hasta que hayan terminado seat_count - 1 jugadores: en una mesa de cuatro se espera al tercer puesto; en una de cinco al cuarto; y así sucesivamente. El jugador restante recibe automáticamente el último puesto sin tener que terminar las cuatro fichas. winner_id conserva al ganador y result/finish_order conserva las posiciones para la clasificación.

## 6. Tablero lógico y layouts visuales

BoardDefinition será:

    seat_count: int
    track_length: int
    board_path: list[int]
    start_cells: dict[str, int]
    player_home_paths: dict[str, list[int]]
    safe_cells: set[int]
    finish_cells: dict[str, list[int]]

La ruta compartida tendrá 17 casillas por asiento:

- 4 jugadores: 68 casillas.
- 5 jugadores: 85 casillas.
- 6 jugadores: 102 casillas.

Cada asiento recibe un sector equivalente y un offset de salida. Cada jugador tiene cuatro fichas, su entrada, un pasillo final y una meta. Las posiciones de seguridad y los offsets canónicos serán datos del BoardFactory, no coordenadas escritas en los componentes. Las salidas serán seguras por defecto.

El backend solo trabaja con índices y estados. En el frontend, board-layouts.ts traducirá esa definición a coordenadas SVG normalizadas:

    track: Record<number, { x: number; y: number }>
    starts: Record<string, { x: number; y: number }>
    homePaths: Record<string, Array<{ x: number; y: number }>>
    goals: Record<string, { x: number; y: number }>

Para cuatro jugadores se usará un layout cross inspirado en el tablero tradicional. Para cinco y seis se usará un layout radial simétrico. El cambio de layout no modifica reglas, IDs, posiciones ni eventos.

## 7. API y protocolo WebSocket

Endpoints HTTP:

    POST /api/rooms
    POST /api/rooms/{roomCode}/join
    GET  /api/rooms/{roomCode}
    GET  /health
    WS   /api/ws/rooms/{roomCode}

Crear sala recibe nombre, cantidad de jugadores y color opcional:

    {
      "displayName": "Felipe",
      "playerCount": 4,
      "color": "green"
    }

La respuesta incluye roomCode, playerId, playerToken, isHost y wsPath. Unirse recibe displayName y color opcional; el servidor valida capacidad, nombre, color y reservas.

El cliente abre el WebSocket y envía el handshake:

    {
      "type": "RECONNECT",
      "roomCode": "AB7K2",
      "playerToken": "random-secret-token"
    }

El mismo handshake sirve para la primera conexión después de crear/unirse, refresh y reconexión. El servidor verifica que el código del payload coincida con la ruta, compara el token con su hash, marca al jugador conectado y emite un snapshot completo.

Comandos del cliente:

    RECONNECT
    PLAYER_READY
    START_GAME
    ROLL_DICE
    MOVE_PIECE
    CHAT_MESSAGE
    REACTION_SENT
    GIFT_SENT

Los comandos de juego no contienen playerId. MOVE_PIECE solo contiene pieceId y ROLL_DICE no contiene valor. Los comandos mutables incluirán requestId para correlacionar errores y prevenir reenvíos duplicados durante una reconexión.

Eventos del servidor:

    PLAYER_JOINED
    PLAYER_LEFT
    PLAYER_RECONNECTED
    PLAYER_READY
    GAME_STARTED
    TURN_STARTED
    DICE_ROLLED
    PIECE_MOVED
    PIECE_CAPTURED
    TURN_ENDED
    PLAYER_FINISHED
    GAME_FINISHED
    CHAT_MESSAGE
    REACTION_SENT
    GIFT_SENT
    GAME_STATE_SYNC
    ERROR

El sobre de evento será:

    {
      "type": "DICE_ROLLED",
      "version": 1,
      "roomCode": "AB7K2",
      "stateVersion": 18,
      "eventId": "evt_456",
      "serverTime": "2026-09-14T18:30:00Z",
      "payload": {}
    }

stateVersion aumentará en cada mutación de estado de sala. Los eventos semánticos se usarán para animaciones y, después de cada mutación, el servidor enviará GAME_STATE_SYNC con el estado completo autoritativo. El cliente ignorará snapshots antiguos. Los eventos sociales son efímeros y no requieren reconstruir el estado del juego.

GAME_STATE_SYNC será obligatorio después del handshake y después de una reconexión. El servidor también lo enviará tras cambios de presencia, ready, inicio, dado, movimiento, turno y victoria.

## 8. Flujo de lobby e inicio

Crear:

1. El cliente envía POST /api/rooms.
2. El servidor genera roomCode, playerId y playerToken.
3. El cliente guarda roomCode, playerId y playerToken.
4. El cliente conecta el WebSocket y recibe GAME_STATE_SYNC.

Unirse:

1. El cliente envía nombre y color a POST /join.
2. El servidor reserva un asiento y devuelve credenciales.
3. El cliente guarda la sesión y conecta el WebSocket.
4. Todos los clientes reciben PLAYER_JOINED y un snapshot.

La sala se inicia solo cuando tiene exactamente la cantidad configurada de jugadores, todos están conectados, todos están listos y el comando lo envía el host. Al iniciar se genera BoardDefinition, se crean fichas y se emite GAME_STARTED seguido de TURN_STARTED y GAME_STATE_SYNC.

Una desconexión cambia al jugador a disconnected_reserved y conserva su asiento diez minutos por defecto. Si reconecta antes de expirar, se emiten PLAYER_RECONNECTED y GAME_STATE_SYNC. Si la reserva expira, el asiento se libera. Si el host pierde su reserva, el host pasa al jugador conectado con menor seat_index.

## 9. Frontend y experiencia de usuario

La página inicial priorizará Crear partida y Unirse a partida con una presentación de juego social, no administrativa. Crear mostrará nombre, 4/5/6 jugadores y color. Después mostrará código, enlace /room/AB7K2 y Copiar invitación.

El lobby mostrará jugadores, avatar generado, nombre, color, estado conectado/listo y host. En la partida, el tablero ocupará el área principal. Escritorio usará jugadores a la izquierda, tablero al centro y chat a la derecha. Tablet usará paneles laterales plegables. La barra inferior alojará dado, reacciones y regalos.

useGameSocket será responsable de conexión, reconexión con backoff, serialización de comandos, recepción de sobres y envío de eventos al store. gameStore conservará únicamente serverGameState, connectionState, lastError, lastStateVersion, comandos pendientes, eventos sociales recientes y preferencias locales de audio.

Board, Piece, Dice, PlayerCard, TurnIndicator, VictoryModal, Lobby, PlayerList, RoomInvite y los componentes sociales serán de presentación. Ninguno decidirá si una ficha puede moverse.

No habrá movimientos optimistas. Las fichas válidas se resaltarán usando availablePieces recibido del servidor. Los eventos PIECE_MOVED, PIECE_CAPTURED, TURN_STARTED y GAME_FINISHED dispararán animaciones Framer Motion sin bloquear la interacción.

La interfaz será responsive para escritorio y tablet, tendrá etiquetas accesibles, foco visible, botones de dado con estado deshabilitado y una banda clara para conectando, reconectando y partida sincronizada.

## 10. Errores, seguridad y límites

Los fallos no mutarán el estado y se devolverán como ERROR:

    ROOM_NOT_FOUND
    ROOM_FULL
    ROOM_ALREADY_STARTED
    INVALID_ROOM_CODE
    INVALID_NAME
    COLOR_UNAVAILABLE
    UNAUTHENTICATED
    NOT_HOST
    INSUFFICIENT_PLAYERS
    PLAYER_NOT_READY
    NOT_YOUR_TURN
    DICE_ALREADY_ROLLED
    INVALID_MOVE
    NO_AVAILABLE_MOVES
    RATE_LIMITED
    INVALID_MESSAGE

El nombre tendrá entre 2 y 20 caracteres, sin duplicados ignorando mayúsculas. Los payloads WebSocket tendrán un tamaño máximo. El chat tendrá 280 caracteres y un límite de 5 mensajes cada 10 segundos. Reacciones tendrán un límite de 8 cada 5 segundos y regalos de 3 cada 10 segundos. Los mensajes serán limpiados en backend y renderizados como texto, nunca como HTML.

El servidor validará siempre sala, identidad, turno, fase, dado, ficha, color, capacidad y host. No confiará en playerId, seatIndex, color ni valor de dado enviados por el cliente. El código de sala tendrá validación estricta y los endpoints de creación/unión tendrán límites básicos de frecuencia.

El token se generará con aleatoriedad criptográfica, se hasheará en el servidor y se transmitirá solo por una conexión segura en despliegue. La memoria temporal se perderá al reiniciar el proceso durante MVP 1; esto se comunicará en README y se resolverá con Redis en la fase de persistencia.

## 11. Pruebas y verificación

El módulo game se probará sin iniciar FastAPI:

- Crear partida para 4, 5 y 6 jugadores.
- Orden de turnos.
- Salida desde casa con valor permitido y no permitido.
- Movimiento válido e inválido.
- Intentar mover durante turno ajeno.
- Casillas seguras y capturas.
- Bonificación configurable de captura.
- Entrada al camino final.
- Llegada exacta y ficha terminada.
- Victoria y clasificación.
- Variantes de bloqueo, seis adicional y triple seis.

RoomManager probará creación, capacidad, colores duplicados, nombres duplicados, ready, autorización de host, inicio, desconexión, TTL y reconexión con token. Las pruebas WebSocket verificarán handshake válido e inválido, broadcast de presencia, snapshot completo, rechazo de comandos malformados y rate limiting.

Frontend tendrá typecheck y build estrictos, además de pruebas del store y del adaptador WebSocket. La verificación manual de Fase 1 cubrirá varias pestañas: crear sala, ocupar 4–6 asientos, ver presencia, marcar ready, iniciar como host, refrescar y recuperar el asiento reservado.

## 12. Fases y criterios de aceptación

Fase 1 — salas, lobby y tiempo real:

- Scaffold ejecutable de frontend y backend.
- Crear y unirse a sala.
- Código y enlace de invitación.
- Selección y reserva de color.
- Lobby para 4–6 jugadores.
- Host y estado ready.
- WebSocket autenticado con token.
- PLAYER_JOINED, PLAYER_LEFT, PLAYER_RECONNECTED, PLAYER_READY y GAME_STATE_SYNC.
- Reconexión básica y reserva de diez minutos.
- Tests de RoomManager, protocolo y cliente.

Fase 1 se considera terminada cuando varias pestañas pueden completar ese flujo y los tests pasan sin ejecutar todavía reglas de movimiento.

Fase 2 — juego:

- GameRules y BoardFactory.
- SVG cross para 4 y radial para 5–6.
- Dado generado por servidor.
- Turnos y movimientos.
- Capturas, seguridad, pasillo final, meta y victoria.
- GAME_STARTED, TURN_STARTED, DICE_ROLLED, PIECE_MOVED, PIECE_CAPTURED, TURN_ENDED, PLAYER_FINISHED y GAME_FINISHED.
- Pantalla de victoria con Jugar de nuevo y Volver al lobby.

Fase 3 — capa social:

- Chat con emojis y hora.
- Reacciones rápidas con control individual de música, efectos y reacciones.
- Regalos gratuitos: rosa, tomate, aplausos, confeti, corazón y fuego.
- Animaciones ligeras y no bloqueantes.
- Skins visuales de dados y fichas, gratuitas para todos, sin tienda, monedas, inventario limitado ni efecto sobre las reglas.

Fase 4 — persistencia y personalización:

- Redis para estado temporal y presencia distribuida.
- PostgreSQL para partidas e historial.
- Estadísticas, avatares y personalización adicional.

## 13. Migración futura

RoomRepository abstraerá lectura, escritura y eliminación de salas. ConnectionManager abstraerá conexiones locales y podrá delegar broadcasts a Redis pub/sub. El dominio no cambiará al sustituir MemoryRoomRepository. PostgreSQL no será necesario para identidad anónima ni para el flujo de juego inicial; se incorporará cuando exista una necesidad real de historial o cuentas.

Este diseño mantiene la primera instalación simple sin cerrar la puerta a múltiples instancias, recuperación de estado ni funciones sociales adicionales.
