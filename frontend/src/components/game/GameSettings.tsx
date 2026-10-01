"use client";

import type { DiceSkinId, PieceSkinId } from "@/types/game";
import type { PlayerPreferences } from "@/lib/player-preferences";
import { useState } from "react";

const diceSkins: ReadonlyArray<{ id: DiceSkinId; name: string }> = [
  { id: "classic", name: "Clásico" },
  { id: "brass", name: "Latón" },
  { id: "jade", name: "Jade" },
  { id: "midnight", name: "Medianoche" },
];

const pieceSkins: ReadonlyArray<{ id: PieceSkinId; name: string }> = [
  { id: "classic", name: "Clásica" },
  { id: "porcelain", name: "Porcelana" },
  { id: "walnut", name: "Nogal" },
  { id: "glow", name: "Brillo" },
];

type GameSettingsProps = {
  preferences: PlayerPreferences;
  onChange: (preferences: PlayerPreferences) => void;
  cosmeticsDisabled?: boolean;
};

export function GameSettings({
  preferences,
  onChange,
  cosmeticsDisabled = false,
}: GameSettingsProps) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <details className="game-settings" open={isOpen} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary role="button" aria-label="Ajustes" aria-expanded={isOpen} title="Ajustes">
        <span aria-hidden="true">⚙</span>
        <span className="sr-only">Ajustes</span>
      </summary>
      <section className="game-settings-panel" aria-label="Ajustes de partida">
        <fieldset className="game-settings-sounds">
          <legend>Sonido</legend>
          <label className="game-settings-switch">
            <span>Efectos de juego</span>
            <input
              type="checkbox"
              role="switch"
              checked={preferences.gameEffectsEnabled}
              onChange={(event) => onChange({ ...preferences, gameEffectsEnabled: event.currentTarget.checked })}
            />
          </label>
          <label className="game-settings-switch">
            <span>Sonidos de reacciones</span>
            <input
              type="checkbox"
              role="switch"
              checked={preferences.reactionSoundsEnabled}
              onChange={(event) => onChange({ ...preferences, reactionSoundsEnabled: event.currentTarget.checked })}
            />
          </label>
        </fieldset>
        <fieldset className="game-settings-skins" disabled={cosmeticsDisabled}>
          <legend>Dados</legend>
          <div className="game-settings-skin-options">
            {diceSkins.map((skin) => (
              <button
                key={skin.id}
                type="button"
                className={`game-settings-skin game-settings-die game-die-face-${skin.id}`}
                aria-label={`Dado: ${skin.name}`}
                aria-pressed={preferences.diceSkinId === skin.id}
                onClick={() => onChange({ ...preferences, diceSkinId: skin.id })}
              >
                <span aria-hidden="true">⚄</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="game-settings-skins" disabled={cosmeticsDisabled}>
          <legend>Fichas</legend>
          <div className="game-settings-skin-options">
            {pieceSkins.map((skin) => (
              <button
                key={skin.id}
                type="button"
                className={`game-settings-skin game-settings-piece parchis-piece-skin-${skin.id}`}
                aria-label={`Ficha: ${skin.name}`}
                aria-pressed={preferences.pieceSkinId === skin.id}
                onClick={() => onChange({ ...preferences, pieceSkinId: skin.id })}
              >
                <span aria-hidden="true" />
              </button>
            ))}
          </div>
        </fieldset>
      </section>
    </details>
  );
}
