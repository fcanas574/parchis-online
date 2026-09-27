"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { DiceIndex, Piece as PieceState, PlayerColor, PublicPlayer } from "@/types/game";

const PIECE_COLORS: Record<PlayerColor, string> = {
  green: "var(--color-piece-green)",
  red: "var(--color-piece-red)",
  blue: "var(--color-piece-blue)",
  yellow: "var(--color-piece-yellow)",
  purple: "var(--color-piece-purple)",
  orange: "var(--color-piece-orange)",
};

type PieceProps = {
  piece: PieceState;
  goalArrival?: boolean;
  player: PublicPlayer;
  pieceNumber: number;
  legalMove: boolean;
  selectable: boolean;
  diceIndices: readonly DiceIndex[];
  optionCount: number;
  selectionExpanded: boolean;
  trackCellLabel?: number;
  viewRotationDegrees?: number;
  style: CSSProperties;
  onSelect: (pieceId: string) => void;
};

export function Piece({
  piece,
  goalArrival = false,
  player,
  pieceNumber,
  legalMove,
  selectable,
  diceIndices,
  optionCount,
  selectionExpanded,
  trackCellLabel,
  viewRotationDegrees = 0,
  style,
  onSelect,
}: PieceProps) {
  const [showGoalAccent, setShowGoalAccent] = useState(false);
  const wasAtGoalRef = useRef(goalArrival);
  useEffect(() => {
    if (goalArrival && !wasAtGoalRef.current) {
      setShowGoalAccent(true);
      const timer = window.setTimeout(() => setShowGoalAccent(false), 850);
      wasAtGoalRef.current = true;
      return () => window.clearTimeout(timer);
    }
    wasAtGoalRef.current = goalArrival;
    return undefined;
  }, [goalArrival]);
  const moveLabel =
    optionCount > 1
      ? `seleccionar para elegir entre ${optionCount} movimientos`
      : diceIndices.length === 0
        ? "mover la ficha"
        : `mover con ${diceIndices.map((index) => `dado ${index + 1}`).join(" y ")}`;
  const locationLabel =
    piece.state === "yard"
      ? "en casa"
      : piece.state === "track"
        ? `en el recorrido, casilla ${trackCellLabel ?? "desconocida"}`
        : piece.state === "finish_path"
          ? `en el pasillo final, casilla ${(piece.finishProgress ?? 0) + 1}`
          : "en la meta";
  const accessibleName = `${player.displayName}, ficha ${pieceNumber}, ${locationLabel}${legalMove ? selectable ? `. ${moveLabel}` : ". movimiento posible; espera tu turno" : ""}`;

  return (
    <motion.button
      type="button"
      id={`parchis-piece-${piece.id}`}
      className={`parchis-piece${showGoalAccent ? " parchis-piece-goal-arrival" : ""}`}
      layout
      aria-label={accessibleName}
      aria-expanded={optionCount > 1 ? selectionExpanded : undefined}
      aria-controls={optionCount > 1 ? `move-options-for-${piece.id}` : undefined}
      title={accessibleName}
      disabled={!selectable}
      onClick={() => {
        if (selectable) onSelect(piece.id);
      }}
      whileHover={selectable ? { scale: 1.08 } : undefined}
      whileTap={selectable ? { scale: 0.94 } : undefined}
      transition={{ layout: { duration: 0.08, ease: "easeOut" } }}
      style={{
        ...style,
        display: "grid",
        placeItems: "center",
        width: "44px",
        height: "44px",
        padding: 0,
        border: 0,
        borderRadius: 0,
        color: "var(--color-room-night)",
        background: "transparent",
        cursor: selectable ? "pointer" : "default",
        zIndex: selectable ? 3 : 2,
        pointerEvents: selectable ? "auto" : "none",
        touchAction: "manipulation",
      }}
    >
      <span
        className="parchis-piece-token"
        aria-hidden="true"
        style={{
          display: "grid",
          width: piece.state === "finished" ? "clamp(12px, 1.8vw, 20px)" : "clamp(18px, 3.2vw, 32px)",
          height: piece.state === "finished" ? "clamp(12px, 1.8vw, 20px)" : "clamp(18px, 3.2vw, 32px)",
          placeItems: "center",
          border: "2px solid var(--color-room-night)",
          borderRadius: "50%",
          color: "var(--color-room-night)",
          backgroundColor: PIECE_COLORS[player.color],
          boxShadow: legalMove
            ? "0 0 0 2px var(--color-parchment), 0 0 14px color-mix(in srgb, var(--color-focus) 68%, transparent), 0 4px 7px rgba(0,0,0,.42), inset 0 2px 0 rgba(255,255,255,.38)"
            : "0 3px 6px rgba(0,0,0,.38), inset 0 2px 0 rgba(255,255,255,.34)",
          fontSize: piece.state === "finished" ? "clamp(0.42rem, 1vw, 0.62rem)" : "clamp(0.62rem, 1.8vw, 0.85rem)",
          fontWeight: 900,
          lineHeight: 1,
          pointerEvents: "none",
          transform: `rotate(${-viewRotationDegrees}deg)`,
        }}
      >
        {pieceNumber}
      </span>
    </motion.button>
  );
}
