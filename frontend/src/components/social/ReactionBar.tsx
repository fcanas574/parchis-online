"use client";

import type { ReactionId } from "@/types/game";

const REACTIONS: readonly { id: ReactionId; emoji: string; label: string }[] = [
  { id: "laugh", emoji: "😂", label: "risa" },
  { id: "cry", emoji: "😭", label: "llanto" },
  { id: "angry", emoji: "😡", label: "enojo" },
  { id: "cool", emoji: "😎", label: "genial" },
  { id: "shocked", emoji: "🤯", label: "sorpresa" },
  { id: "heart", emoji: "❤️", label: "corazón" },
  { id: "applause", emoji: "👏", label: "aplausos" },
];

type ReactionBarProps = {
  onSendReaction: (reactionId: ReactionId) => boolean | void;
  disabled?: boolean;
};

export function ReactionBar({ onSendReaction, disabled = false }: ReactionBarProps) {
  return (
    <div className="social-reaction-bar" role="group" aria-label="Reacciones rápidas">
      {REACTIONS.map((reaction) => (
        <button
          className="social-reaction-button"
          key={reaction.id}
          type="button"
          aria-label={`Enviar reacción: ${reaction.label}`}
          disabled={disabled}
          onClick={() => onSendReaction(reaction.id)}
        >
          <span aria-hidden="true">{reaction.emoji}</span>
        </button>
      ))}
    </div>
  );
}
