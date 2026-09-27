# Parchís Online — práctica con bots y movimiento visible

Fecha: 2026-09-26  
Estado: pendiente de revisión de la especificación escrita  
Alcance: modo de prueba individual y animación de fichas en todas las partidas

## 1. Intención y límites

Felipe quiere probar una partida completa sin reunir a otros jugadores. La portada principal y el flujo de salas privadas entre amigos deben conservarse: capacidad de 4, 5 o 6 personas reales, todos presentes y listos antes de comenzar. El nuevo modo de práctica se abre por una entrada discreta en la interfaz, ocupa los asientos restantes con jugadores automáticos y permite jugar contra ellos. Los bots no aparecen en salas normales.

Además, los movimientos confirmados deben verse casilla por casilla en todos los clientes, en lugar de saltar visualmente desde el origen al destino. La animación crea tensión, pero no retrasa ni decide las reglas: el servidor sigue siendo la única autoridad. Se mantiene la variante actual de dos dados, barreras, bonus y clasificación hasta el penúltimo puesto.

No se añaden dificultad de bots, estadísticas de práctica, recompensas, pagos, chat ni cambios a la lógica de legalidad de los movimientos.

## 2. Enfoques considerados y decisión

1. **Sala de práctica separada, recomendada y aprobada:** un humano y el resto bots, usando el motor y el autopiloto del servidor. La partida real se prueba de extremo a extremo y las salas entre amigos conservan sus condiciones de inicio.
2. Completar cualquier sala privada incompleta con bots: reutiliza parte del lobby, pero mezcla pruebas con invitaciones reales y permite iniciar con bots por accidente.
3. Simulación solo en el navegador: no comprueba WebSockets, reconexión, dados ni validación autoritativa.

Se implementa la primera opción. El modo de práctica es discreto, no una nueva opción principal del menú.

## 3. Entrada y experiencia de práctica

El emblema de la portada abre `/practice` después de cinco activaciones consecutivas en una ventana breve. Debe funcionar con toque, ratón y teclado, sin cambiar la jerarquía visual de «Crear partida» y «Unirse a partida». La ruta directa `/practice` permite volver a abrirla. La discreción es una decisión de interfaz, **no autenticación ni medida de seguridad**.

La pantalla de práctica pide nombre, cantidad de asientos (4, 5 o 6) y color. Un solo envío crea una sala marcada `practice`, agrega al humano como anfitrión en el asiento 0, asigna los asientos restantes a bots con colores únicos y crea inmediatamente un `GameState` con el mismo motor que las partidas normales. Guarda el token humano en la sesión local existente y navega a `/room/{code}`. No hay lobby ni espera de «Listo» para práctica. La cabecera y los asientos muestran «Práctica» y distinguen explícitamente cada bot de un humano desconectado.

Las salas de práctica no admiten invitados ni tokens de bot. `join_room` las rechaza incluso si se conoce el código; únicamente el anfitrión humano puede reconectarse con su token. Al terminar, «Jugar de nuevo» crea otra partida de práctica con los mismos asientos y colores; «Salir» regresa al inicio. Las salas privadas normales conservan su lobby, invitaciones, reconexión y criterio de inicio sin modificación.

## 4. Modelo y responsabilidades

`RoomState` incorpora `mode: "friends" | "practice"`; `PlayerState` incorpora `is_bot: bool`. Ambos se publican como `mode` e `isBot` en el snapshot. En salas normales todos los participantes tienen `is_bot=False`; en práctica hay exactamente un humano, el anfitrión, y `max_players - 1` bots. Los bots tienen IDs propios y asientos contiguos. Conservan un hash aleatorio no canjeable para satisfacer el modelo existente, pero nunca se emite un `playerToken` para ellos, ni reciben sesión WebSocket, reserva de reconexión o presencia humana. La autenticación también rechaza explícitamente `is_bot`. Así `GameRules.new_game` sigue recibiendo 4, 5 o 6 participantes y no necesita reglas especiales para prácticas.

`RoomManager` expone una operación de creación de práctica que valida nombre, color y cantidad de asientos, asigna colores sin duplicados y persiste la sala antes de devolver las credenciales del anfitrión. `POST /api/practice` usa la misma validación de entrada y el mismo límite de creación por IP que `POST /api/rooms`. El campo `mode` se decide en el servidor, nunca por un comando WebSocket. El token humano se genera y almacena igual que en las salas normales; cualquier comando atribuido a un bot mediante identidad del cliente se rechaza.

El autopiloto actual ya elige solo opciones legales proporcionadas por `GameRules`. Se reutiliza para los bots; el motor tira los dados y valida sus movimientos. La condición de ejecución será `is_bot OR jugador humano desconectado`, sin confundir ambos estados en la interfaz. El trabajador de sala espera una pausa corta entre tirada y acción de bot, **fuera** del lock de publicación, y revalida el estado al reentrar. Debe programarse también al crear o reanudar una práctica si el turno activo pertenece a un bot. Para un humano desconectado se conserva el comportamiento actual.

El orden, las capturas, las barreras, los bonus y la condición de victoria usan el `GameState` existente. Los bots pueden ganar y aparecen en la clasificación. Un bot no expira por reserva ni se elimina del roster. El replay de práctica inicia inmediatamente otra partida sin exigir `is_ready` o `is_connected` a los bots; el replay de amigos sigue pasando por el lobby y sus comprobaciones actuales.

## 5. Movimiento casilla por casilla

Cada transición `PIECE_MOVED` añade al protocolo v1 un campo `path: PiecePosition[]`. La lista contiene las posiciones lógicas visitadas después del origen y termina en `to`. El motor de reglas la deriva de la opción legal elegida y de `BoardDefinition`, sin coordenadas gráficas. Un movimiento desde casa tiene un único salto a la salida; uno sobre la ruta compartida enumera cada casilla, incluyendo el cruce por el índice cero; al entrar en el pasillo final continúa por sus casillas; el paso final llega a `finished`. La suma de dados y los bonus generan el mismo tipo de ruta. Si una acción usa dos movimientos separados, cada `PIECE_MOVED` lleva su propia ruta. Los eventos de captura siguen llegando después del movimiento que la causó.

El servidor confirma y persiste el destino antes de emitir el evento y el `GAME_STATE_SYNC` de esa versión. El cliente mantiene por separado el snapshot autoritativo y una capa efímera de **posiciones visuales**: encola los `PIECE_MOVED` por `stateVersion` y orden de recepción, proyecta cada punto del `path` mediante `board-layouts`, y solo al acabar muestra la posición del snapshot. No decide destinos ni envía comandos desde la animación. La ficha capturada vuelve visualmente a casa al terminar la llegada del capturador; la ficha que llega a meta recibe una breve señal visual.

El ritmo objetivo es cercano a 90 ms por casilla, con duración total acotada para movimientos largos y bonus. Las tiradas de bots se espacian para que dado y ficha sean legibles, pero la presentación local no bloquea las transiciones autoritativas. Si entran varios eventos seguidos, se reproducen en cola, sin sobrescribir una ruta a mitad de camino. El `GAME_STATE_SYNC` ordinario de la misma versión actualiza el snapshot sin cancelar su animación pendiente. Un `GAME_STATE_SYNC` inicial o de reconexión, cambio de sala o salto de versión sí vacía la cola y dibuja directamente el estado recibido; no reproduce un historial atrasado. Con `prefers-reduced-motion`, la ficha muestra directamente el destino.

La numeración orientada al color del espectador y la rotación visual del tablero no modifican `path`: cada cliente proyecta los mismos índices lógicos en su propia orientación. Los controles de movimiento se basan en el snapshot y se deshabilitan mientras haya una animación pendiente de la acción local, para impedir una segunda selección accidental; no se ralentiza el servidor por motivos visuales.

## 6. Protocolo y compatibilidad

La creación de práctica es HTTP, no un comando WebSocket. Las acciones durante la partida usan los mensajes v1 existentes (`ROLL_DICE`, `MOVE_PIECE`, `MOVE_BONUS_PIECE`, `PLAY_AGAIN`). Los snapshots `GAME_STATE_SYNC` añaden `room.mode` y `room.players[].isBot`; `PIECE_MOVED` añade `path`. Se actualizan los tipos TypeScript y el validador estricto de mensajes. No se acepta `playerId` del cliente para actuar como bot.

Clientes de esta versión del proyecto deben comprender esos campos nuevos; no se promete compatibilidad con clientes antiguos. La secuencia de publicación continúa siendo eventos semánticos seguidos del snapshot de la misma versión. `eventId` evita reproducir dos veces un movimiento recibido de forma duplicada. La reconexión sustituye la presentación local por el snapshot reciente.

## 7. Errores, seguridad y carga

- La entrada oculta no protege el endpoint. La API valida los datos, usa límite por IP y expone `PRACTICE_MODE_ENABLED` para deshabilitar prácticas en un despliegue público si se desea. Estará habilitado por defecto para poder probarlo localmente sin pasos extra; la guía de despliegue indicará cómo ponerlo en `false`. Si está deshabilitado, responde con un error claro y la interfaz lo muestra sin crear una sala parcial.
- Las prácticas no admiten `join` y no fabrican credenciales reutilizables para bots. El servidor rechaza cualquier intento de accionar una ficha ajena, tanto en amigos como en práctica.
- El trabajador de bots se limita a una instancia activa por sala y nunca duerme con el lock tomado. Debe detenerse al terminar la partida o cuando el turno pase al humano.
- Si el navegador se desconecta, el juego puede continuar con el autopiloto existente para el humano. Al reconectar, el snapshot autoritativo sustituye cualquier animación incompleta.
- La ausencia o invalidez de `path` en un evento nuevo se trata como error de protocolo y fuerza resincronización, nunca una inferencia de legalidad en el cliente.

## 8. Pruebas y aceptación

- **Dominio:** rutas lógicas al salir, recorrer, cruzar el índice cero, entrar en pasillo, llegar a meta y mover bonus; el último punto coincide con el destino validado.
- **Sala:** crear prácticas de 4, 5 y 6 con un humano y bots completos; nombres/colores/asientos únicos; bloquear `join`; rechazar identidad de bot; replay inmediato; salas normales mantienen inicio con todos presentes y listos.
- **Autopiloto y transporte:** dados y movimientos de bots salen del servidor y respetan las opciones legales; el trabajador se detiene al volver al turno humano; los eventos conservan orden y versión; reconexión entrega snapshot correcto.
- **Frontend:** cinco activaciones del emblema abren práctica sin alterar los CTA normales; bots etiquetados; `path` animado paso a paso y en cola; captura, meta, movimiento reducido y reconexión no producen teletransporte inesperado ni fichas desfasadas.
- **Verificación visual:** partida de práctica visible en escritorio y móvil, incluido tablero de cinco jugadores; el tablero sigue cabiendo en una pantalla y el dado permanece legible junto al jugador activo.

El trabajo puede implementarse en dos cortes mantenibles: primero creación de práctica/bots y sus pruebas de extremo a extremo; después `path` y capa de animación. En ambos cortes el proyecto debe seguir ejecutable y las partidas entre amigos no deben perder funciones existentes.
