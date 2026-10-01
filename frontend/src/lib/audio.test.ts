import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PLAYER_PREFERENCES } from "@/lib/player-preferences";

const audioContextInstances: MockAudioContext[] = [];

class MockAudioContext {
  state = "suspended";
  currentTime = 0;
  destination = {};
  oscillators: Array<{ start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }> = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });

  constructor() {
    audioContextInstances.push(this);
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    };
  }

  createOscillator() {
    const oscillator = {
      type: "sine",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

async function loadAudio() {
  vi.resetModules();
  return import("@/lib/audio");
}

describe("local game audio", () => {
  beforeEach(() => {
    audioContextInstances.length = 0;
    vi.stubGlobal("AudioContext", MockAudioContext);
  });

  it("does not create audio until the user explicitly unlocks it", async () => {
    const audio = await loadAudio();
    audio.playGameSound("dice_roll", DEFAULT_PLAYER_PREFERENCES);
    expect(audioContextInstances).toHaveLength(0);

    await audio.unlockGameAudio();
    expect(audioContextInstances).toHaveLength(1);
    expect(audioContextInstances[0]?.resume).toHaveBeenCalledOnce();
    audio.playGameSound("dice_roll", DEFAULT_PLAYER_PREFERENCES);
    expect(audioContextInstances[0]?.oscillators.length).toBeGreaterThan(0);
  });

  it("respects the game-effects and reaction-sounds switches independently", async () => {
    const audio = await loadAudio();
    await audio.unlockGameAudio();
    const context = audioContextInstances[0];
    expect(context).toBeDefined();

    audio.playGameSound("dice_roll", {
      ...DEFAULT_PLAYER_PREFERENCES,
      gameEffectsEnabled: false,
    });
    expect(context?.oscillators).toHaveLength(0);

    audio.playGameSound("laugh", {
      ...DEFAULT_PLAYER_PREFERENCES,
      reactionSoundsEnabled: false,
    });
    expect(context?.oscillators).toHaveLength(0);

    audio.playGameSound("laugh", {
      ...DEFAULT_PLAYER_PREFERENCES,
      gameEffectsEnabled: false,
    });
    expect(context?.oscillators.length).toBeGreaterThan(0);
  });
});
