import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PlayerSeat } from "@/components/game/PlayerSeat";
import { gameRoomFixture, gameStateFixture } from "@/test/game-fixtures";
import type { PublicPlayer } from "@/types/game";

const defaultPlayer = gameRoomFixture().players[1]!;
const lastRoll = { values: [2, 5] as [number, number], turnNumber: 3 };

function renderSeat(player: PublicPlayer = defaultPlayer) {
  const onRoll = vi.fn();
  const onOpenGiftMenu = vi.fn();
  const onSendGift = vi.fn(() => true);
  const game = gameStateFixture({ currentPlayerId: player.id });
  const view = render(
    <ol>
      <PlayerSeat
        player={player}
        currentPlayerId="p1"
        game={game}
        connectionState="connected"
        lastRoll={lastRoll}
        isActive={false}
        canRoll={false}
        diceSkinId="jade"
        onRoll={onRoll}
        onOpenGiftMenu={onOpenGiftMenu}
        onSendGift={onSendGift}
        canSendGift
        giftMenuOpen={false}
        onCloseGiftMenu={vi.fn()}
      />
    </ol>,
  );
  return { ...view, onRoll, onOpenGiftMenu, onSendGift };
}

describe("PlayerSeat", () => {
  it("shows the player's identity, persisted last roll, and selected dice skin", () => {
    const { container } = renderSeat();
    const seat = screen.getByText("Ana").closest("li");
    expect(seat).toHaveTextContent("En juego");
    expect(seat?.querySelectorAll(".game-die-face")).toHaveLength(2);
    expect([...seat!.querySelectorAll(".game-die-face")].map((die) => die.textContent)).toEqual(["2", "5"]);
    expect(seat?.querySelectorAll('[data-skin="jade"]')).toHaveLength(2);
    expect(within(seat!).getByRole("button", { name: "Dados de Ana" })).toBeDisabled();
    expect(container.querySelector("li[data-player-seat='p2']")).toBeInTheDocument();
  });

  it("opens the recipient's gift menu through the parent callback", () => {
    function GiftHarness() {
      const [openFor, setOpenFor] = useState<string | null>(null);
      return (
        <ol>
          <PlayerSeat
            player={defaultPlayer}
            currentPlayerId="p1"
            game={gameStateFixture({ currentPlayerId: "p1" })}
            connectionState="connected"
            lastRoll={null}
            isActive={false}
            canRoll={false}
            diceSkinId="classic"
            onRoll={vi.fn()}
            onOpenGiftMenu={(playerId) => setOpenFor(playerId)}
            onSendGift={vi.fn(() => true)}
            canSendGift
            giftMenuOpen={openFor === defaultPlayer.id}
            onCloseGiftMenu={() => setOpenFor(null)}
          />
        </ol>
      );
    }
    render(<GiftHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar regalo a Ana" }));

    expect(screen.getByRole("group", { name: "Regalos para Ana" })).not.toHaveAttribute("hidden");
    expect(screen.getByRole("button", { name: "Rosa" })).toBeInTheDocument();
  });
});
