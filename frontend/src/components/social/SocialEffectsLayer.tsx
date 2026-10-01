"use client";

import { MotionConfig, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { playGameSound } from "@/lib/audio";
import { DEFAULT_PLAYER_PREFERENCES, type PlayerPreferences } from "@/lib/player-preferences";
import type { GiftId, PublicPlayer, ReactionId } from "@/types/game";
import type { ServerEvent } from "@/types/protocol";

const GIFT_EMOJI: Record<GiftId, string> = {
  rose: "🌹",
  tomato: "🍅",
  applause: "👏",
  confetti: "🎉",
  heart: "❤️",
  fire: "🔥",
};

const REACTION_EMOJI: Record<ReactionId, string> = {
  laugh: "😂",
  cry: "😭",
  angry: "😡",
  cool: "😎",
  shocked: "🤯",
  heart: "❤️",
  applause: "👏",
};

type Point = { x: number; y: number };
type SocialEffect = {
  id: string;
  kind: "gift" | "reaction";
  emoji: string;
  from: Point;
  to: Point;
};

type SocialEffectsLayerProps = {
  players: readonly PublicPlayer[];
  events: readonly ServerEvent[];
  preferences?: PlayerPreferences;
};

function seatCenter(playerId: string): Point | null {
  const seat = [...document.querySelectorAll<HTMLElement>("[data-player-seat]")]
    .find((element) => element.dataset.playerSeat === playerId);
  if (!seat) return null;
  const bounds = seat.getBoundingClientRect();
  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
}

export function SocialEffectsLayer({
  players,
  events,
  preferences = DEFAULT_PLAYER_PREFERENCES,
}: SocialEffectsLayerProps) {
  const [effects, setEffects] = useState<SocialEffect[]>([]);
  const reducedMotion = useReducedMotion() ?? false;
  const seenEventIdsRef = useRef(new Set(events.map((event) => event.eventId)));
  const timersRef = useRef(new Map<string, number>());

  useEffect(() => {
    for (const event of events) {
      if (seenEventIdsRef.current.has(event.eventId)) continue;
      seenEventIdsRef.current.add(event.eventId);

      if (event.type === "GIFT_SENT") {
        const { fromPlayerId, toPlayerId, giftId } = event.payload;
        if (!players.some((player) => player.id === fromPlayerId) || !players.some((player) => player.id === toPlayerId)) continue;
        playGameSound("gift", preferences);
        const from = seatCenter(fromPlayerId);
        const to = seatCenter(toPlayerId);
        if (from && to) {
          const effect = { id: event.eventId, kind: "gift" as const, emoji: GIFT_EMOJI[giftId], from, to };
          setEffects((current) => [...current, effect].slice(-20));
          timersRef.current.set(event.eventId, window.setTimeout(() => {
            setEffects((current) => current.filter((item) => item.id !== event.eventId));
            timersRef.current.delete(event.eventId);
          }, reducedMotion ? 120 : 760));
        }
      } else if (event.type === "REACTION_SENT") {
        const { playerId, reactionId } = event.payload;
        if (!players.some((player) => player.id === playerId)) continue;
        playGameSound(reactionId, preferences);
        const point = seatCenter(playerId);
        if (point) {
          const effect = {
            id: event.eventId,
            kind: "reaction" as const,
            emoji: REACTION_EMOJI[reactionId],
            from: point,
            to: { x: point.x, y: point.y - 34 },
          };
          setEffects((current) => [...current, effect].slice(-20));
          timersRef.current.set(event.eventId, window.setTimeout(() => {
            setEffects((current) => current.filter((item) => item.id !== event.eventId));
            timersRef.current.delete(event.eventId);
          }, reducedMotion ? 120 : 1050));
        }
      }
    }
  }, [events, players, preferences, reducedMotion]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="social-effects-layer" aria-hidden="true" style={{ pointerEvents: "none" }}>
        {effects.map((effect) => (
          <motion.span
            key={effect.id}
            className={effect.kind === "gift" ? "social-gift-flight" : "social-reaction-float"}
            initial={{ left: effect.from.x, top: effect.from.y, opacity: effect.kind === "gift" ? 1 : 0, scale: effect.kind === "gift" ? 0.55 : 0.7 }}
            animate={effect.kind === "gift"
              ? { left: effect.to.x, top: effect.to.y, opacity: reducedMotion ? [1, 0] : [1, 1, 0], scale: reducedMotion ? 1 : [0.55, 1.15, 0.9] }
              : { left: effect.to.x, top: effect.to.y, opacity: [0, 1, 1, 0], scale: reducedMotion ? 1 : [0.7, 1.1, 1] }}
            transition={{ duration: reducedMotion ? 0.1 : effect.kind === "gift" ? 0.7 : 0.95, ease: "easeOut" }}
          >
            {effect.emoji}
          </motion.span>
        ))}
      </div>
    </MotionConfig>
  );
}
