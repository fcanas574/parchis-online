"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { GameState, PlayerPlacement, PublicRoomState } from "@/types/game";

export type VictoryActions = {
  sendReturnToLobby: () => boolean | void;
  sendPlayAgain: () => boolean | void;
};

export function VictoryModal({
  room,
  game,
  placements,
  actions,
  actionsEnabled,
}: {
  room: PublicRoomState;
  game: GameState;
  placements: readonly PlayerPlacement[];
  actions: VictoryActions;
  actionsEnabled: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const playersById = new Map(room.players.map((player) => [player.id, player]));
  const winnerId = game.winnerId ?? game.result?.winnerId ?? null;
  const winnerName = winnerId ? playersById.get(winnerId)?.displayName : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      // jsdom has no showModal; the open attribute keeps component behavior testable.
      dialog.setAttribute("open", "");
    }

    return () => {
      if (dialog.open && typeof dialog.close === "function") {
        dialog.close();
      } else {
        dialog.removeAttribute("open");
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="game-victory-dialog"
      aria-labelledby="game-victory-title"
      aria-describedby="game-victory-description"
      onCancel={(event) => event.preventDefault()}
    >
      <div className="game-victory-content">
        <span className="game-victory-mark" aria-hidden="true">✦</span>
        <p className="eyebrow">Fin de la partida</p>
        <h2 id="game-victory-title">
          {winnerName ? `¡${winnerName} ganó!` : "¡Partida terminada!"}
        </h2>
        <p id="game-victory-description">
          Así quedó la mesa. Si alguien vuelve a jugar, la sala conservará sus asientos y colores.
        </p>

        <ol className="game-standings" aria-label="Clasificación final">
          {placements.map((placement) => {
            const player = playersById.get(placement.playerId);
            return (
              <li key={placement.playerId}>
                <span className="game-standing-rank">
                  {placement.rank === 1 ? "🥇" : placement.rank === 2 ? "🥈" : placement.rank === 3 ? "🥉" : `${placement.rank}.º`}
                </span>
                <span>{player?.displayName ?? "Jugador"}</span>
                {placement.playerId === winnerId ? (
                  <span className="game-standing-winner">Ganador</span>
                ) : null}
              </li>
            );
          })}
        </ol>

        <div className="game-victory-actions">
          <Button
            autoFocus
            disabled={!actionsEnabled}
            onClick={actions.sendPlayAgain}
            size="lg"
          >
            Jugar de nuevo
          </Button>
          {room.mode === "friends" ? (
            <Button
              disabled={!actionsEnabled}
              onClick={actions.sendReturnToLobby}
              variant="secondary"
            >
              Volver al lobby
            </Button>
          ) : null}
        </div>
        {!actionsEnabled ? (
          <p className="game-action-guidance">Reconectando con la sala; estas acciones están pausadas.</p>
        ) : null}
        <Link className="game-victory-home-link" href="/">
          {room.mode === "practice" ? "Salir" : "Salir de la sala"}
        </Link>
      </div>
    </dialog>
  );
}
