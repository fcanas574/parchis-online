import type { DiceSkinId, PieceSkinId } from "@/types/game";

export type PlayerPreferences = {
  diceSkinId: DiceSkinId;
  pieceSkinId: PieceSkinId;
  gameEffectsEnabled: boolean;
  reactionSoundsEnabled: boolean;
};

export const PLAYER_PREFERENCES_STORAGE_KEY = "parchis:player-preferences:v1";

export const DEFAULT_PLAYER_PREFERENCES: Readonly<PlayerPreferences> = Object.freeze({
  diceSkinId: "classic",
  pieceSkinId: "classic",
  gameEffectsEnabled: true,
  reactionSoundsEnabled: true,
});

const DICE_SKINS = new Set<DiceSkinId>(["classic", "brass", "jade", "midnight"]);
const PIECE_SKINS = new Set<PieceSkinId>(["classic", "porcelain", "walnut", "glow"]);

function normalizePreferences(value: unknown): PlayerPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_PLAYER_PREFERENCES };
  }
  const candidate = value as Record<string, unknown>;
  return {
    diceSkinId: DICE_SKINS.has(candidate.diceSkinId as DiceSkinId)
      ? candidate.diceSkinId as DiceSkinId
      : DEFAULT_PLAYER_PREFERENCES.diceSkinId,
    pieceSkinId: PIECE_SKINS.has(candidate.pieceSkinId as PieceSkinId)
      ? candidate.pieceSkinId as PieceSkinId
      : DEFAULT_PLAYER_PREFERENCES.pieceSkinId,
    gameEffectsEnabled: typeof candidate.gameEffectsEnabled === "boolean"
      ? candidate.gameEffectsEnabled
      : DEFAULT_PLAYER_PREFERENCES.gameEffectsEnabled,
    reactionSoundsEnabled: typeof candidate.reactionSoundsEnabled === "boolean"
      ? candidate.reactionSoundsEnabled
      : DEFAULT_PLAYER_PREFERENCES.reactionSoundsEnabled,
  };
}

export function readPlayerPreferences(): PlayerPreferences {
  if (typeof window === "undefined") return { ...DEFAULT_PLAYER_PREFERENCES };
  try {
    const serialized = window.localStorage.getItem(PLAYER_PREFERENCES_STORAGE_KEY);
    if (!serialized) return { ...DEFAULT_PLAYER_PREFERENCES };
    const stored: unknown = JSON.parse(serialized);
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) {
      return { ...DEFAULT_PLAYER_PREFERENCES };
    }
    const versioned = stored as Record<string, unknown>;
    if (versioned.version !== 1) return { ...DEFAULT_PLAYER_PREFERENCES };
    return normalizePreferences(versioned.preferences);
  } catch {
    return { ...DEFAULT_PLAYER_PREFERENCES };
  }
}

export function writePlayerPreferences(preferences: PlayerPreferences): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PLAYER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, preferences: normalizePreferences(preferences) }),
    );
  } catch {
    // Storage is optional: keep the game usable if it is blocked or full.
  }
}
