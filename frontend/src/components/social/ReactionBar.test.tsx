import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReactionBar } from "@/components/social/ReactionBar";

describe("ReactionBar", () => {
  it("offers the seven approved reactions with accessible Spanish names", () => {
    render(<ReactionBar onSendReaction={vi.fn()} />);

    for (const name of ["risa", "llanto", "enojo", "genial", "sorpresa", "corazón", "aplausos"]) {
      expect(screen.getByRole("button", { name: `Enviar reacción: ${name}` })).toBeEnabled();
    }
  });

  it("sends the selected reaction ID without changing local game state", () => {
    const onSendReaction = vi.fn(() => true);
    render(<ReactionBar onSendReaction={onSendReaction} />);

    fireEvent.click(screen.getByRole("button", { name: "Enviar reacción: risa" }));

    expect(onSendReaction).toHaveBeenCalledWith("laugh");
  });

  it("does not dispatch while disabled", () => {
    const onSendReaction = vi.fn();
    render(<ReactionBar onSendReaction={onSendReaction} disabled />);

    expect(screen.getByRole("button", { name: "Enviar reacción: corazón" })).toBeDisabled();
    expect(onSendReaction).not.toHaveBeenCalled();
  });
});
