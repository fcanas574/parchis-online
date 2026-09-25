import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { PublicPlayer } from "@/types/game";

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase("es"))
    .join("") || "?";

export function PlayerCard({ player, isCurrent }: { player: PublicPlayer; isCurrent: boolean }) {
  return (
    <Card className="player-card">
      <div
        aria-hidden="true"
        className="player-avatar"
        style={{ backgroundColor: `var(--color-piece-${player.color})` }}
      >
        {initials(player.displayName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="player-name-row">
          <h3 className="player-name">{player.displayName}</h3>
          {isCurrent ? <span className="you-label">Tú</span> : null}
        </div>
        <div className="player-badges">
          {player.isHost ? <Badge tone="warning">Anfitrión</Badge> : null}
          <Badge tone={player.isReady ? "success" : "neutral"}>
            {player.isReady ? "Listo" : "Esperando"}
          </Badge>
          <Badge tone={player.isConnected ? "info" : "danger"}>
            {player.isConnected ? "Conectado" : "Desconectado"}
          </Badge>
        </div>
      </div>
    </Card>
  );
}
