import { Button } from "@/components/ui/button";
import type { PublicRoomState } from "@/types/game";
import { PlayerCard } from "./PlayerCard";

const plural = (count: number, singular: string, pluralForm: string) =>
  count === 1 ? singular : pluralForm;

export function PlayerList({
  room,
  currentPlayerId,
  socketConnected,
  onReady,
  onStart,
}: {
  room: PublicRoomState;
  currentPlayerId: string | null;
  socketConnected: boolean;
  onReady: (ready: boolean) => void;
  onStart: () => void;
}) {
  const orderedPlayers = [...room.players].sort((left, right) => left.seatIndex - right.seatIndex);
  const currentPlayer = orderedPlayers.find((player) => player.id === currentPlayerId);
  const isHost = currentPlayerId !== null && room.hostPlayerId === currentPlayerId;
  const missingPlayers = Math.max(room.maxPlayers - orderedPlayers.length, 0);
  const disconnectedPlayers = orderedPlayers.filter((player) => !player.isConnected).length;
  const waitingPlayers = orderedPlayers.filter((player) => !player.isReady).length;
  const canStart =
    missingPlayers === 0 && disconnectedPlayers === 0 && waitingPlayers === 0 && socketConnected;

  let startGuidance = "Todos están listos. Puedes iniciar la partida.";
  if (!socketConnected) {
    startGuidance = "Espera a que la sala vuelva a sincronizarse.";
  } else if (missingPlayers > 0) {
    startGuidance = `Falta ${missingPlayers} ${plural(missingPlayers, "jugador", "jugadores")} para completar la sala.`;
  } else if (disconnectedPlayers > 0) {
    startGuidance = `${disconnectedPlayers} ${plural(disconnectedPlayers, "jugador no está conectado", "jugadores no están conectados")}.`;
  } else if (waitingPlayers > 0) {
    startGuidance = `${waitingPlayers} ${plural(waitingPlayers, "jugador aún no está listo", "jugadores aún no están listos")}.`;
  }

  return (
    <section aria-labelledby="players-title" className="space-y-4">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Asientos ocupados</p>
          <h2 id="players-title">La mesa</h2>
        </div>
        <span className="seat-count">
          {orderedPlayers.length}/{room.maxPlayers}
        </span>
      </div>

      <ul className="player-grid">
        {orderedPlayers.map((player) => (
          <li key={player.id}>
            <PlayerCard player={player} isCurrent={player.id === currentPlayerId} />
          </li>
        ))}
      </ul>

      {currentPlayer ? (
        <div className="lobby-actions">
          <Button
            disabled={!socketConnected}
            onClick={() => onReady(!currentPlayer.isReady)}
            variant="secondary"
          >
            {currentPlayer.isReady ? "Ya no estoy listo" : "Estoy listo"}
          </Button>
          {isHost ? (
            <div className="host-action">
              <Button disabled={!canStart} onClick={onStart} size="lg">
                Iniciar partida
              </Button>
              <p className="action-guidance">{startGuidance}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
