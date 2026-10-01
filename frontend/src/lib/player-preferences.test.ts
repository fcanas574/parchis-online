import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installBrowserStorageMock } from "@/test/storage";
import {
  DEFAULT_PLAYER_PREFERENCES,
  PLAYER_PREFERENCES_STORAGE_KEY,
  readPlayerPreferences,
  writePlayerPreferences,
} from "@/lib/player-preferences";

describe("player preferences", () => {
  beforeEach(installBrowserStorageMock);
  afterEach(() => vi.unstubAllGlobals());

  it("uses classic skins and enables both sound categories by default", () => {
    expect(readPlayerPreferences()).toEqual({
      diceSkinId: "classic",
      pieceSkinId: "classic",
      gameEffectsEnabled: true,
      reactionSoundsEnabled: true,
    });
  });

  it("falls back safely for corrupt JSON and retired catalog IDs", () => {
    window.localStorage.setItem(PLAYER_PREFERENCES_STORAGE_KEY, "{");
    expect(readPlayerPreferences()).toEqual(DEFAULT_PLAYER_PREFERENCES);

    window.localStorage.setItem(
      PLAYER_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ version: 1, preferences: {
        diceSkinId: "premium-gold",
        pieceSkinId: "classic",
        gameEffectsEnabled: false,
        reactionSoundsEnabled: "yes",
      },
      }),
    );
    expect(readPlayerPreferences()).toEqual({
      ...DEFAULT_PLAYER_PREFERENCES,
      pieceSkinId: "classic",
      gameEffectsEnabled: false,
    });
  });

  it("persists preferences on this device only", () => {
    const preferences = {
      diceSkinId: "jade" as const,
      pieceSkinId: "porcelain" as const,
      gameEffectsEnabled: false,
      reactionSoundsEnabled: true,
    };
    writePlayerPreferences(preferences);

    expect(JSON.parse(window.localStorage.getItem(PLAYER_PREFERENCES_STORAGE_KEY) ?? "null")).toEqual({
      version: 1,
      preferences,
    });
    expect(readPlayerPreferences()).toEqual(preferences);
  });

  it("uses defaults during server rendering or when browser storage is blocked", () => {
    vi.stubGlobal("window", undefined);
    expect(readPlayerPreferences()).toEqual(DEFAULT_PLAYER_PREFERENCES);
    expect(() => writePlayerPreferences(DEFAULT_PLAYER_PREFERENCES)).not.toThrow();
    vi.unstubAllGlobals();

    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => { throw new DOMException("Storage is disabled", "SecurityError"); },
        setItem: () => { throw new DOMException("Storage is disabled", "SecurityError"); },
      },
    });
    expect(readPlayerPreferences()).toEqual(DEFAULT_PLAYER_PREFERENCES);
    expect(() => writePlayerPreferences(DEFAULT_PLAYER_PREFERENCES)).not.toThrow();
  });
});
