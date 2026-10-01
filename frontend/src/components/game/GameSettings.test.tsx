import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYER_PREFERENCES } from "@/lib/player-preferences";
import { GameSettings } from "@/components/game/GameSettings";

describe("GameSettings", () => {
  it("offers four free styles for dice and pieces, without store or payment language", () => {
    render(<GameSettings preferences={DEFAULT_PLAYER_PREFERENCES} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));

    const dice = within(screen.getByRole("group", { name: "Dados" }));
    const pieces = within(screen.getByRole("group", { name: "Fichas" }));
    expect(dice.getAllByRole("button")).toHaveLength(4);
    expect(pieces.getAllByRole("button")).toHaveLength(4);
    expect(dice.getByRole("button", { name: "Dado: Clásico" })).toHaveAttribute("aria-pressed", "true");
    expect(pieces.getByRole("button", { name: "Ficha: Clásica" })).toHaveAttribute("aria-pressed", "true");
    expect(document.body).not.toHaveTextContent(/precio|comprar|monedas|desbloquear/i);
  });

  it("keeps game effects and reaction sounds as independent switches", () => {
    const onChange = vi.fn();
    render(<GameSettings preferences={DEFAULT_PLAYER_PREFERENCES} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));

    fireEvent.click(screen.getByRole("switch", { name: "Efectos de juego" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PLAYER_PREFERENCES,
      gameEffectsEnabled: false,
    });

    fireEvent.click(screen.getByRole("switch", { name: "Sonidos de reacciones" }));
    expect(onChange).toHaveBeenLastCalledWith({
      ...DEFAULT_PLAYER_PREFERENCES,
      reactionSoundsEnabled: false,
    });
  });

  it("changes a selected skin without affecting the other preference", () => {
    const onChange = vi.fn();
    render(<GameSettings preferences={DEFAULT_PLAYER_PREFERENCES} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Ajustes" }));
    fireEvent.click(screen.getByRole("button", { name: "Dado: Jade" }));

    expect(onChange).toHaveBeenCalledWith({
      ...DEFAULT_PLAYER_PREFERENCES,
      diceSkinId: "jade",
    });
  });
});
