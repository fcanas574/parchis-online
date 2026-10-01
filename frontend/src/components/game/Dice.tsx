"use client";

import { MotionConfig, motion } from "framer-motion";
import { useEffect, useState } from "react";
import type { DiceSkinId, GameState, PlayerLastRoll, PublicPlayer } from "@/types/game";
import type { ConnectionState } from "@/stores/gameStore";
import type { ServerEvent } from "@/types/protocol";

const BONUS_REASON: Record<"capture" | "goal", string> = {
  capture: "captura",
  goal: "llegada a meta",
};

type DiceProps = {
  game: GameState;
  currentPlayerId: string;
  activePlayer: PublicPlayer | undefined;
  connectionState: ConnectionState;
  onRoll: () => boolean | void;
  rollEvent?: Extract<ServerEvent, { type: "DICE_ROLLED" }>;
  displayedRoll?: PlayerLastRoll | null;
  diceSkinId?: DiceSkinId;
  canRollOverride?: boolean;
  isTurnSeatOverride?: boolean;
};

export function Dice({
  game,
  currentPlayerId,
  activePlayer,
  connectionState,
  onRoll,
  rollEvent,
  displayedRoll = null,
  diceSkinId,
  canRollOverride,
  isTurnSeatOverride,
}: DiceProps) {
  const [revealedRollId, setRevealedRollId] = useState<string | null>(null);
  const currentRollEvent = rollEvent && rollEvent.payload.playerId === activePlayer?.id
    ? rollEvent
    : undefined;
  const rolling = currentRollEvent !== undefined && revealedRollId !== currentRollEvent.eventId;

  useEffect(() => {
    if (!currentRollEvent || revealedRollId === currentRollEvent.eventId) return;
    const timer = window.setTimeout(() => setRevealedRollId(currentRollEvent.eventId), 550);
    return () => window.clearTimeout(timer);
  }, [currentRollEvent, revealedRollId]);

  const canRollFromState =
    game.status === "playing" &&
    game.turnPhase === "waiting_for_roll" &&
    game.currentPlayerId === currentPlayerId &&
    activePlayer?.isConnected === true &&
    connectionState === "connected";
  const canRoll = canRollOverride ?? canRollFromState;
  const values = currentRollEvent?.payload.values ?? displayedRoll?.values ??
    (activePlayer?.id === game.currentPlayerId ? game.diceValues : null);
  const skin = diceSkinId ?? activePlayer?.diceSkinId ?? "classic";
  const isTurnSeat = isTurnSeatOverride ?? activePlayer?.id === game.currentPlayerId;
  const actionLabel = isTurnSeat && game.turnPhase === "waiting_for_roll"
    ? "Tirar dados"
    : currentRollEvent
      ? "Dados del turno"
      : `Dados de ${activePlayer?.displayName ?? "jugador"}`;
  const resultText = rolling
    ? `${activePlayer?.displayName ?? "Jugador"} está tirando los dados…`
    : values
      ? `${activePlayer?.displayName ?? "Jugador"} sacó ${values[0]} y ${values[1]}`
      : "Dados sin tirar";

  return (
    <div className="game-seat-dice">
      <MotionConfig reducedMotion="user">
        <button
          type="button"
          className="game-dice-trigger"
          aria-label={actionLabel}
          aria-description={values ? `Resultado ${values[0]} y ${values[1]}` : undefined}
          data-rolling={rolling}
          disabled={!canRoll}
          onClick={onRoll}
        >
          {(values ?? [null, null]).map((value, index) => (
            <motion.span
              key={`${currentRollEvent?.eventId ?? "sync"}-${index}`}
              className={`game-die-face game-die-face-${skin}`}
              data-skin={skin}
              aria-hidden="true"
              initial={false}
              animate={rolling ? { rotate: 360, scale: [1, 0.8, 1] } : { rotate: 0, scale: 1 }}
              transition={rolling ? { duration: 0.55, ease: "easeInOut" } : { duration: 0 }}
            >
              {rolling ? "·" : value ?? "?"}
            </motion.span>
          ))}
        </button>
      </MotionConfig>
      {currentRollEvent ? (
        <span className="sr-only" role="status" aria-live="polite">{resultText}</span>
      ) : null}
      {activePlayer?.id === game.currentPlayerId && game.pendingBonuses[0] ? (
        <span className="sr-only" role="status">
          Bonus de {game.pendingBonuses[0].steps} por {BONUS_REASON[game.pendingBonuses[0].reason]}.
        </span>
      ) : null}
    </div>
  );
}
