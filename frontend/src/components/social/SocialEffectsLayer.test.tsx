import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocialEffectsLayer } from "@/components/social/SocialEffectsLayer";
import { gameRoomFixture } from "@/test/game-fixtures";
import type { ServerEvent } from "@/types/protocol";

const { playGameSoundMock } = vi.hoisted(() => ({ playGameSoundMock: vi.fn() }));
vi.mock("@/lib/audio", () => ({ playGameSound: playGameSoundMock }));

const envelope = { version: 1 as const, roomCode: "AB7K2", stateVersion: 4, serverTime: "2026-10-01T12:00:00Z" };
const giftEvent: ServerEvent = {
  ...envelope,
  type: "GIFT_SENT",
  eventId: "gift-1",
  payload: { fromPlayerId: "p1", toPlayerId: "p2", giftId: "rose" },
};
const reactionEvent: ServerEvent = {
  ...envelope,
  type: "REACTION_SENT",
  eventId: "reaction-1",
  payload: { playerId: "p2", reactionId: "laugh" },
};

function renderLayer(events: readonly ServerEvent[]) {
  return render(
    <>
      <div data-player-seat="p1">Felipe</div>
      <div data-player-seat="p2">Ana</div>
      <SocialEffectsLayer players={gameRoomFixture().players} events={events} />
    </>,
  );
}

describe("SocialEffectsLayer", () => {
  beforeEach(() => playGameSoundMock.mockReset());

  it("animates a new gift from sender to recipient without intercepting interaction", () => {
    const { rerender } = renderLayer([]);
    rerender(
      <>
        <div data-player-seat="p1">Felipe</div>
        <div data-player-seat="p2">Ana</div>
        <SocialEffectsLayer players={gameRoomFixture().players} events={[giftEvent]} />
      </>,
    );

    const flight = document.querySelector(".social-gift-flight");
    expect(flight).toBeInTheDocument();
    expect(flight).toHaveTextContent("🌹");
    expect(document.querySelector(".social-effects-layer")).toHaveAttribute("aria-hidden", "true");
    expect(document.querySelector(".social-effects-layer")).toHaveStyle({ pointerEvents: "none" });
    expect(playGameSoundMock).toHaveBeenCalledWith("gift", expect.any(Object));
  });

  it("shows a new reaction at its player's seat", () => {
    const { rerender } = renderLayer([]);
    rerender(
      <>
        <div data-player-seat="p1">Felipe</div>
        <div data-player-seat="p2">Ana</div>
        <SocialEffectsLayer players={gameRoomFixture().players} events={[reactionEvent]} />
      </>,
    );

    expect(screen.getByText("😂")).toHaveClass("social-reaction-float");
    expect(playGameSoundMock).toHaveBeenCalledWith("laugh", expect.any(Object));
  });

  it("does not replay effects already present when the layer mounts", () => {
    renderLayer([giftEvent, reactionEvent]);

    expect(document.querySelector(".social-gift-flight")).not.toBeInTheDocument();
    expect(document.querySelector(".social-reaction-float")).not.toBeInTheDocument();
    expect(playGameSoundMock).not.toHaveBeenCalled();
  });
});
