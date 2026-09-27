"use client";

import type { GameState, PublicRoomState } from "@/types/game";

export function TurnIndicator({
  room,
  game,
  currentPlayerId,
}: {
  room: PublicRoomState;
  game: GameState;
  currentPlayerId: string;
}) {
  const activePlayer = room.players.find(
    (player) => player.id === game.currentPlayerId,
  );

  const announcement = !activePlayer
    ? "Esperando turno."
    : activePlayer.id === currentPlayerId
      ? "Tu turno."
      : `Turno de ${activePlayer.displayName}.`;

  return (
    <p
      className="sr-only game-turn-announcement"
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {announcement}
    </p>
  );
}
