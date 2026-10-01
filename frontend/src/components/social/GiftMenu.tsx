"use client";

import { useEffect, useRef, useState } from "react";
import type { GiftId, PublicPlayer } from "@/types/game";

const GIFTS: readonly { id: GiftId; emoji: string; label: string }[] = [
  { id: "rose", emoji: "🌹", label: "Rosa" },
  { id: "tomato", emoji: "🍅", label: "Tomate" },
  { id: "applause", emoji: "👏", label: "Aplausos" },
  { id: "confetti", emoji: "🎉", label: "Confeti" },
  { id: "heart", emoji: "❤️", label: "Corazón" },
  { id: "fire", emoji: "🔥", label: "Fuego" },
];

const GIFT_BY_ID = Object.fromEntries(GIFTS.map((gift) => [gift.id, gift])) as Record<GiftId, typeof GIFTS[number]>;

type GiftMenuProps = {
  recipient: PublicPlayer;
  onSendGift: (playerId: string, giftId: GiftId) => boolean | void;
  disabled?: boolean;
  isOpen?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
};

export function GiftMenu({
  recipient,
  onSendGift,
  disabled = false,
  isOpen: controlledIsOpen,
  onOpenChange,
}: GiftMenuProps) {
  const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false);
  const [sendError, setSendError] = useState(false);
  const isControlled = controlledIsOpen !== undefined;
  const isOpen = controlledIsOpen ?? uncontrolledIsOpen;
  const changeOpen = (nextOpen: boolean) => {
    if (!isControlled) setUncontrolledIsOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstGiftRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const lastGift = recipient.lastReceivedGiftId ? GIFT_BY_ID[recipient.lastReceivedGiftId] : null;

  useEffect(() => {
    if (isOpen) {
      firstGiftRef.current?.focus();
    } else if (wasOpenRef.current) {
      triggerRef.current?.focus();
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") changeOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isOpen]);

  const sendGift = (giftId: GiftId) => {
    if (disabled) return;
    try {
      if (onSendGift(recipient.id, giftId) === false) {
        setSendError(true);
        return;
      }
      setSendError(false);
      changeOpen(false);
    } catch {
      setSendError(true);
    }
  };

  return (
    <div className="social-gift-control">
      <button
        ref={triggerRef}
        type="button"
        className="social-gift-trigger"
        aria-label={`Enviar regalo a ${recipient.displayName}`}
        aria-expanded={isOpen}
        aria-controls={`gift-menu-${recipient.id}`}
        disabled={disabled}
        onClick={() => {
          setSendError(false);
          changeOpen(!isOpen);
        }}
      >
        <span aria-hidden="true">{lastGift?.emoji ?? "🎁"}</span>
      </button>
      <div
        id={`gift-menu-${recipient.id}`}
        className="social-gift-popover"
        role="group"
        aria-label={`Regalos para ${recipient.displayName}`}
        hidden={!isOpen}
      >
        {GIFTS.map((gift, index) => (
          <button
            key={gift.id}
            ref={index === 0 ? firstGiftRef : undefined}
            type="button"
            className="social-gift-choice"
            aria-label={gift.label}
            disabled={disabled}
            onClick={() => sendGift(gift.id)}
          >
            <span aria-hidden="true">{gift.emoji}</span>
            <span className="sr-only">{gift.label}</span>
          </button>
        ))}
        {sendError ? <span className="social-gift-error" role="alert">No se envió; revisa tu conexión.</span> : null}
      </div>
    </div>
  );
}
