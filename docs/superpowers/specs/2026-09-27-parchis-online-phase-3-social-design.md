# Parchís Online — Diseño de Fase 3: capa social y personalización gratuita

- Fecha: 2026-09-27
- Estado: aprobado por el usuario
- Alcance: chat, reacciones, regalos gratuitos, efectos de audio, skins gratuitas y presentación compacta de jugadores/dados

## 1. Objetivo

Completar la experiencia privada entre amigos añadiendo una capa social ligera a las partidas de Fase 2. El tablero continúa siendo el elemento dominante; las interacciones sociales no bloquean turnos, no desplazan el tablero y se sincronizan mediante la sala WebSocket existente.

La Fase 3 añade chat de sala, reacciones, regalos animados y gratuitos, sonidos opcionales, estilos visuales gratuitos para dados y fichas, y una presentación en la que cada jugador y sus dados se asocian a su zona alrededor del tablero. Se mantiene la orientación local del tablero: el color de la persona conectada queda abajo, sin cambiar los índices lógicos ni el estado autoritativo.

## 2. Decisiones aprobadas

- Reutilizar FastAPI, el WebSocket autenticado y el estado en memoria por sala; no crear un servicio social separado.
- Presentar el diseño «Esquinas de mesa · chat plegable»: nombres, color, dado y acción de regalo junto a cada zona de jugador; chat compacto que puede abrirse o cerrarse.
- En tableros de cuatro personas, las zonas se ubican en las esquinas. Para cinco o seis, se distribuyen alrededor del perímetro radial, manteniendo al jugador local abajo y el tablero centrado.
- Mostrar el resultado más reciente de cada jugador junto a su nombre. Al recibir `DICE_ROLLED`, todos los clientes animan brevemente los dados de esa persona y revelan los valores generados por el servidor. El resultado permanece visible hasta la siguiente tirada de ese jugador. Un snapshot o una reconexión muestran el valor sin volver a animarlo.
- En móvil, conservar la partida en una sola pantalla habitual, sin scroll vertical de documento. El chat se abre superpuesto como panel/drawer y no reacomoda el tablero. En pantallas muy cortas, zoom o texto ampliado se permite scroll natural antes que recortar controles.
- Cada jugador tiene un botón de regalo junto a su zona. Al elegir un regalo, el emoji viaja visualmente desde quien lo envía hasta quien lo recibe. El último regalo recibido permanece como distintivo en la zona receptora, sustituyendo visualmente el icono neutral de regalo; el control sigue siendo interactivo. El siguiente regalo recibido lo reemplaza.
- Efectos de juego y sonidos de reacción tienen controles separados. No habrá música.
- Incluir cuatro estilos gratuitos iniciales para dados y cuatro para fichas —clásico y tres variantes en cada categoría—, sin monedas, tienda, compras ni desbloqueos. Una selección cambia solo la apariencia.
- El chat conserva los 50 mensajes más recientes de la sala para recuperación durante una reconexión. Límite de 280 caracteres y cinco mensajes por jugador cada diez segundos.
- Reacciones y animaciones de vuelo son efímeras. No se guardan ni se reproducen al reconectar. Los regalos sí conservan el último regalo visible de cada destinatario en el estado público de la sala.

## 3. Fuera de alcance

- Cuentas, perfiles persistentes, inventarios, monedas, pagos, tienda, anuncios o contenido premium.
- Música, chat privado, voz, ranking global, matchmaking público, estadísticas e historial duradero.
- PostgreSQL/Redis o almacenamiento durable para salas/social. Las salas y su buffer de chat siguen limitados al proceso actual; al reiniciar el backend se pierden, igual que las partidas existentes.
- Cambios a las reglas, resultados, permisos o autoridad del motor de Parchís.

## 4. Arquitectura e invariantes

### Backend

- El WebSocket autenticado determina `playerId`; no se aceptan identidades de emisor enviadas por el cliente.
- El `RoomManager` valida catálogo, destinatario, longitud y límites de frecuencia, y coordina las mutaciones públicas bajo el lock existente de la sala.
- Chat, reacciones y regalos se habilitan durante una partida activa. La selección de skins está disponible en el lobby y durante la partida; se congela al terminarla y se conserva para la siguiente repetición.
- `GameRules` no conoce chat, sonidos, regalos ni cosméticos. La lógica social vive en servicios/modelos de sala separados del motor del juego.
- Los mensajes de chat se guardan en un buffer FIFO acotado por sala, máximo 50. La interfaz del repositorio de sala mantiene una frontera que permite trasladar después el buffer y los rate limits a Redis si se ejecutan varias instancias.
- La identidad de una sala y sus participantes sigue siendo la fuente de autorización. Solo se puede regalar a otro asiento de esa sala; no se permite enviarse un regalo a sí mismo.

### Frontend

- `useGameSocket` conserva propiedad exclusiva del transporte y distribuye eventos tipados al store. Los componentes de presentación no abren WebSockets ni determinan aceptación de acciones.
- El store distingue estado público versionado de la sala, historial reciente del chat, eventos visuales efímeros y preferencias locales de audio/cosméticos.
- La animación comienza al recibir el evento del servidor; no se usa estado optimista para afirmar que se envió un mensaje, regalo o cambio de skin. Si se rechaza un comando, se muestra una respuesta breve y accionable sin mover el layout.
- Las animaciones respetan `prefers-reduced-motion`; con movimiento reducido se muestra el resultado final sin vuelo/giro.

## 5. Modelo de datos

Los campos se añaden al estado público existente sin exponer tokens ni hashes.

```text
PlayerPublic:
  diceSkinId: DiceSkinId
  pieceSkinId: PieceSkinId
  lastReceivedGiftId: GiftId | null

GameState:
  lastRollsByPlayerId: map[playerId, { values: [1..6, 1..6], turnNumber }]

ChatMessage:
  messageId: string
  playerId: string
  displayName: string
  text: string
  sentAt: server timestamp
```

El estado activo del turno (`diceValues`, dados consumidos y movimientos válidos) mantiene su semántica actual. `lastRollsByPlayerId` solo alimenta el indicador visual persistente junto a cada asiento; no permite mover fichas ni volver a usar resultados anteriores.

`lastReceivedGiftId` forma parte del snapshot público del destinatario para que su distintivo sobreviva a una reconexión. El evento animado de regalo no forma parte del snapshot. El buffer de chat es interno a la sala y se entrega aparte mediante `CHAT_HISTORY_SYNC`; no se incluye repetidamente en cada snapshot de gameplay.

El catálogo inicial se valida por identificador permitido. Se contemplan cuatro estilos por categoría (clásico más tres variantes gratuitas); la dirección final de ilustración puede ajustar nombres y acabado sin cambiar el contrato:

```text
DiceSkinId: classic | brass | jade | midnight
PieceSkinId: classic | porcelain | walnut | glow
GiftId: rose | tomato | applause | confetti | heart | fire
ReactionId: laugh | cry | angry | cool | shocked | heart | applause
```

Las preferencias se guardan localmente en el navegador. Al entrar o reconectar, el cliente propone la selección guardada; el backend valida los identificadores y publica la elección en el asiento autenticado. Sin cuenta, otro dispositivo empieza con el estilo clásico.

## 6. Protocolo WebSocket

Se amplía el contrato JSON v1 y el mismo canal autenticado. Todo mensaje conserva el sobre actual con `version`, `requestId` cuando sea comando, y respuesta correlacionada. Los comandos no llevan un `fromPlayerId` confiable.

### Comandos cliente → servidor

```text
CHAT_MESSAGE       { requestId, text }
REACTION_SENT      { requestId, reactionId }
GIFT_SENT          { requestId, toPlayerId, giftId }
SET_COSMETICS      { requestId, diceSkinId, pieceSkinId }
```

### Eventos servidor → clientes

```text
CHAT_HISTORY_SYNC       { messages: ChatMessage[] }              // hasta 50 al conectar/reconectar
CHAT_MESSAGE            { messageId, playerId, displayName, text, sentAt }
REACTION_SENT           { playerId, reactionId }
GIFT_SENT               { fromPlayerId, toPlayerId, giftId }
PLAYER_COSMETICS_UPDATED { playerId, diceSkinId, pieceSkinId }
GAME_STATE_SYNC         { room, game }                           // incluye cosméticos, último regalo y últimas tiradas
```

`DICE_ROLLED` existente continúa incluyendo los valores autoritativos; su resultado se añade a `lastRollsByPlayerId` antes de publicar el estado. Cada evento conserva `eventId` y `serverTime` del sobre común. `CHAT_HISTORY_SYNC` se emite tras la sincronización inicial o de reconexión. Las reacciones y la animación del regalo se publican una sola vez y nunca se reproducen desde un snapshot.

Los cambios visibles persistentes (selección de cosméticos y último regalo recibido) actualizan la versión de sala y se acompañan del snapshot autoritativo existente. Chat y reacciones son eventos sociales separados del estado de reglas; el buffer de chat no provoca un snapshot completo de juego por cada mensaje. El buffer se recupera explícitamente con `CHAT_HISTORY_SYNC`.

## 7. Interacción social

### Chat

- Un botón compacto con indicador de mensajes sin leer abre/cierra el panel. El panel no cambia el tamaño ni la posición del tablero; en móvil se superpone como drawer/panel con cierre accesible por teclado.
- Se muestra nombre, hora del servidor y texto plano con emojis. No se interpreta HTML/Markdown ni se admiten mensajes de más de 280 caracteres.
- Se conservan los 50 mensajes recientes por sala. Al reconectar, se entrega el buffer; el cliente sustituye su copia por el snapshot de historial para no duplicar mensajes.
- Límite: cinco mensajes por jugador en una ventana de diez segundos. Mensajes vacíos tras normalización se rechazan.

### Reacciones

- Barra rápida: 😂 😭 😡 😎 🤯 ❤️ 👏.
- Una reacción aceptada aparece unos instantes sobre la zona del emisor y se transmite a todos. No entra en el chat ni en el snapshot.
- Límite: ocho reacciones por jugador cada cinco segundos. Solo se aceptan IDs de la lista.

### Regalos

- Catálogo gratuito: 🌹 rosa, 🍅 tomate, 👏 aplausos, 🎉 confeti, ❤️ corazón y 🔥 fuego.
- Se pulsa el botón junto al asiento receptor, se elige un regalo y el servidor valida que el jugador esté en esa sala y que no sea el propio emisor.
- El evento `GIFT_SENT` activa una animación corta (aprox. 700 ms) del emoji desde el asiento emisor al receptor. Es decorativa, no bloqueante y usa `pointer-events: none`.
- El último regalo recibido reemplaza el icono neutral del receptor y permanece visible hasta que llegue otro. Ese distintivo también abre el selector al pulsarlo; por tanto no se pierde la acción de regalar.
- Límite: tres regalos enviados por jugador cada diez segundos. Regalos y catálogo no consumen saldo ni crean inventario.

## 8. Dados, distribución de jugadores y móvil

- El tablero conserva la mayor superficie disponible y la orientación local existente; no cambian coordenadas lógicas ni orden de turno.
- Los asientos se proyectan alrededor del borde de la mesa. En cuatro jugadores, cada nombre y sus controles se alinean con una esquina. En cinco/seis, ocupan posiciones perimetrales simétricas del layout radial.
- Cada asiento presenta nombre, color, indicador de conexión/turno, dado(s) y botón de regalo compacto. El resultado más reciente de cada participante permanece junto a su nombre; solo el jugador activo puede accionar la tirada.
- Cuando llega `DICE_ROLLED`, los clientes animan brevemente el par de dados en la zona del jugador correspondiente (aprox. 500–700 ms), y luego muestran exactamente los dos valores del servidor. El efecto no decide ni retrasa la transición lógica del turno.
- En reconexión se dibujan las últimas tiradas sin animación. No se simula una tirada nueva ni se altera el estado vigente.
- El chat se pliega por defecto para priorizar el tablero. En un viewport móvil habitual de 390 × 844, el tablero, los jugadores y los controles esenciales caben sin scroll vertical del documento. Paneles sociales flotan o se superponen; no reordenan el tablero.
- El texto accesible anuncia quién tiró y qué valores obtuvo, además del indicador visual. El resultado no depende exclusivamente del color.

## 9. Audio y cosméticos

### Audio

- No hay música ni carga de audio remoto.
- Dos controles independientes: «Efectos de juego» y «Sonidos de reacciones». El primero gobierna feedback breve de dados, movimiento/captura/meta y regalo; el segundo, sonidos asociados a emojis/reacciones.
- Ambas preferencias se almacenan localmente. La reproducción respeta el gesto inicial requerido por navegadores y `prefers-reduced-motion` no obliga a reproducir audio.
- Los sonidos son cortos y discretos; apagar un control no modifica animación, eventos ni sincronización.

### Skins gratuitas

- Cuatro estilos iniciales de dados y cuatro de fichas; todos disponibles desde el inicio.
- Selector accesible desde lobby y ajustes de partida. Un cambio se aplica localmente y se comunica mediante `SET_COSMETICS`; todos los clientes lo reflejan tras `PLAYER_COSMETICS_UPDATED`/snapshot.
- Selección recordada en `localStorage` del dispositivo. El servidor conserva únicamente la selección pública de la sala; no hay colección/inventario ni progresión.
- Los IDs permitidos se validan en servidor. Los recursos visuales se sirven con la aplicación y no requieren descargar contenido de un tercero.
- Contraste, forma y estado de una ficha siguen siendo identificables sin depender solo de su skin; todas las variantes respetan el color del jugador.

## 10. Seguridad, límites y reconexión

- Derivar el emisor de la identidad autenticada por WebSocket. Rechazar destinatarios inexistentes, auto-regalos, sala incorrecta y comandos sociales fuera del estado permitido.
- Validar IDs de reacción, regalo y skins con listas cerradas; normalizar longitud del mensaje y representarlo como texto.
- Límites por jugador autenticado: chat 5/10 s; reacciones 8/5 s; regalos 3/10 s. Rechazar sin mutar estado y devolver `ERROR` correlacionado.
- Fijar un máximo de tamaño de payload compatible con el contrato existente. Evitar HTML, URLs embebidas o recursos no permitidos en chat.
- Al reconectar, recuperar estado de juego, los 50 mensajes recientes, cosméticos y el último regalo visible. Reacciones, vuelos de regalos y tiradas animadas anteriores no se reproducen de nuevo.
- Los límites y buffer viven junto a la abstracción de sala actual. Una futura implementación multi-instancia deberá trasladarlos a almacenamiento compartido; no se incorpora esa infraestructura en esta fase.

## 11. Criterios de aceptación

1. Una sala de 4–6 personas puede usar chat, reacciones, regalos y skins desde la conexión WebSocket existente, sin crear otra sesión ni cuenta.
2. Un mensaje válido llega a todos los participantes; exceder longitud o frecuencia se rechaza, y tras reconectar se recuperan como máximo los 50 últimos sin duplicados.
3. Una reacción se muestra para todos, suena solo donde la preferencia de reacción está activa y no reaparece tras reconectar.
4. Enviar regalo activa el vuelo una vez; el destinatario ve el último regalo en su zona después de un snapshot/reconexión, y puede pulsarlo para enviar uno nuevo.
5. Emisor, destinatario, regalo, reacción y cosméticos se validan en servidor; el cliente no puede falsificar su identidad ni escoger IDs arbitrarios.
6. Dos controles de audio funcionan independientemente; no existe música. Las preferencias permanecen al recargar el mismo navegador.
7. Todos ven las mismas skins públicas en tiempo real. El estilo no cambia movimiento, captura, accesibilidad del botón ni reglas.
8. Una tirada produce una animación breve en la zona correcta en todos los clientes y muestra los valores autoritativos; al reconectar se muestran estáticos.
9. El tablero conserva orientación por jugador y, en un móvil habitual, chat plegado, nombres, dados y controles caben sin scroll vertical del documento.
10. Con movimiento reducido, los estados finales siguen comprensibles sin animaciones de vuelo/giro.

## 12. Pruebas

### Backend

- Esquemas de comandos/eventos; catálogo permitido e IDs inválidos; rechazo de emisor/destinatario no autenticados o fuera de sala.
- Buffer de chat de 50 mensajes, normalización, límite de longitud/frecuencia y `CHAT_HISTORY_SYNC` tras reconexión.
- Reacciones y regalos se transmiten a todos; límites de frecuencia; el regalo actualiza solo el último distintivo del destinatario y no se reproduce desde `GAME_STATE_SYNC`.
- `SET_COSMETICS` solo acepta catálogo; publica selección en snapshot y no modifica `GameState` de reglas.
- `DICE_ROLLED` conserva el último par por jugador y `GAME_STATE_SYNC` lo restaura sin crear otro evento de tirada.
- Tests completos existentes de motor, lobby y WebSocket se mantienen verdes.

### Frontend

- Pruebas del store/socket para historial, comandos correlacionados, cosméticos, regalo persistente y eventos efímeros sin replay.
- Componentes prueban selector de regalo, destinatario correcto, reemplazo del último regalo, chat plegable, contadores de reacciones, ajustes de audio y selección de skins.
- Cada cliente anima el jugador identificado por `DICE_ROLLED` y muestra sus valores; la hidratación desde snapshot no dispara animaciones nuevas.
- Verificación a 390 × 844 y escritorio: tablero visible, chat plegado, nombre/dado/regalo alineados con asiento, sin scroll de documento en viewport objetivo.
- Accesibilidad: navegación por teclado, nombres accesibles, estado anunciado, foco visible, contraste, modo movimiento reducido y botones operables sin color como única señal.

## 13. Actualización documental

La Fase 3 queda planificada, no implementada. El README enumera el alcance de forma veraz y enlaza esta especificación y su plan. El protocolo v1 se actualiza en el trabajo de implementación para documentar los mensajes sociales y nuevos campos de snapshot. La aprobación del spec y del plan no inicia por sí sola la implementación.
