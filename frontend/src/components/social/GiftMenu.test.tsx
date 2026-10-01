import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GiftMenu } from "@/components/social/GiftMenu";
import { gameRoomFixture } from "@/test/game-fixtures";

const recipient = gameRoomFixture().players[1]!;

describe("GiftMenu", () => {
  it("offers the free gift catalog for the selected player", () => {
    const onSendGift = vi.fn(() => true);
    render(<GiftMenu recipient={recipient} onSendGift={onSendGift} />);

    fireEvent.click(screen.getByRole("button", { name: "Enviar regalo a Ana" }));
    expect(screen.getByRole("group", { name: "Regalos para Ana" })).toBeInTheDocument();
    for (const name of ["Rosa", "Tomate", "Aplausos", "Confeti", "Corazón", "Fuego"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  it("sends to the selected recipient and leaves the last-gift badge server-owned", () => {
    const onSendGift = vi.fn(() => true);
    render(
      <GiftMenu
        recipient={{ ...recipient, lastReceivedGiftId: "tomato" }}
        onSendGift={onSendGift}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Enviar regalo a Ana" });
    expect(trigger).toHaveTextContent("🍅");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Rosa" }));

    expect(onSendGift).toHaveBeenCalledWith("p2", "rose");
    expect(screen.getByRole("button", { name: "Enviar regalo a Ana" })).toHaveTextContent("🍅");
  });

  it("keeps the menu open and does not fake a received gift when the socket is unavailable", () => {
    const onSendGift = vi.fn(() => false);
    render(<GiftMenu recipient={recipient} onSendGift={onSendGift} />);

    fireEvent.click(screen.getByRole("button", { name: "Enviar regalo a Ana" }));
    fireEvent.click(screen.getByRole("button", { name: "Rosa" }));

    expect(onSendGift).toHaveBeenCalledWith("p2", "rose");
    expect(screen.getByRole("group", { name: "Regalos para Ana" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar regalo a Ana" })).toHaveTextContent("🎁");
  });

  it("disables gift choices if the room disconnects while the menu is open", () => {
    const onSendGift = vi.fn();
    const { rerender } = render(<GiftMenu recipient={recipient} onSendGift={onSendGift} />);
    fireEvent.click(screen.getByRole("button", { name: "Enviar regalo a Ana" }));
    rerender(<GiftMenu recipient={recipient} onSendGift={onSendGift} disabled />);

    expect(screen.getByRole("button", { name: "Rosa" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Rosa" }));
    expect(onSendGift).not.toHaveBeenCalled();
  });
});
