"use client";

import type { CSSProperties } from "react";
import { Dice } from "@/components/game/Dice";
import { GiftMenu } from "@/components/social/GiftMenu";
import type { ConnectionState } from "@/stores/gameStore";
import type {
  GameState,
  GiftId,
  PlayerLastRoll,
  PublicPlayer,
} from "@/types/game";
import type { ServerEvent } from "@/types/protocol";

type PlayerSeatProps = {
  player: PublicPlayer;
  currentPlayerId: string;
  game: GameState;
  connectionState: ConnectionState;
  lastRoll: PlayerLastRoll | null;
  isActive: boolean;
  canRoll: boolean;
  diceSkinId: PublicPlayer["diceSkinId"];
  rollEvent?: Extract<ServerEvent, { type: "DICE_ROLLED" }>;
  placement?: number;
  onRoll: () => boolean | void;
  onOpenGiftMenu: (playerId: string) => void;
  onSendGift: (playerId: string, giftId: GiftId) => boolean | void;
  canSendGift: boolean;
  giftMenuOpen: boolean;
  onCloseGiftMenu: () => void;
};

export function PlayerSeat({
  player,
  currentPlayerId,
  game,
  connectionState,
  lastRoll,
  isActive,
  canRoll,
  diceSkinId,
  rollEvent,
  placement,
  onRoll,
  onOpenGiftMenu,
  onSendGift,
  canSendGift,
  giftMenuOpen,
  onCloseGiftMenu,
}: PlayerSeatProps) {
  return (
    <li
      className={`game-seat${isActive ? " game-seat-active" : ""}`}
      data-player-seat={player.id}
      style={{ "--player-color": `var(--color-piece-${player.color})` } as CSSProperties}
      aria-current={isActive ? "step" : undefined}
    >
      <span className="game-seat-avatar" aria-hidden="true">
        {player.displayName.slice(0, 1).toUpperCase()}
      </span>
      <span className="game-seat-copy">
        <span className="game-player-name">
          {player.displayName}{player.id === currentPlayerId ? " · Tú" : ""}
        </span>
        <span className="game-seat-status">
          {placement
            ? `${placement}.º`
            : player.isBot
              ? "Bot"
              : player.isConnected
                ? "En juego"
                : "Automático"}
        </span>
      </span>
      <Dice
        game={game}
        currentPlayerId={currentPlayerId}
        activePlayer={player}
        connectionState={connectionState}
        onRoll={onRoll}
        rollEvent={rollEvent}
        displayedRoll={lastRoll}
        diceSkinId={diceSkinId}
        canRollOverride={canRoll}
        isTurnSeatOverride={isActive}
      />
      {player.id !== currentPlayerId ? (
        <GiftMenu
          recipient={player}
          onSendGift={onSendGift}
          disabled={!canSendGift}
          isOpen={giftMenuOpen}
          onOpenChange={(open) => open ? onOpenGiftMenu(player.id) : onCloseGiftMenu()}
        />
      ) : null}
    </li>
  );
}
