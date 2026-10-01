import type { ReactionId } from "@/types/game";
import type { PlayerPreferences } from "@/lib/player-preferences";

export type GameSoundCue = "dice_roll" | "piece_move" | "capture" | "goal" | "gift";
export type ReactionSoundCue = ReactionId;
export type AudioCue = GameSoundCue | ReactionSoundCue;

type Tone = { frequency: number; duration: number; offset?: number; wave?: OscillatorType };

const REACTION_CUES = new Set<ReactionId>([
  "laugh", "cry", "angry", "cool", "shocked", "heart", "applause",
]);

const SOUND_PATTERNS: Record<AudioCue, readonly Tone[]> = {
  dice_roll: [{ frequency: 240, duration: 0.07, wave: "triangle" }, { frequency: 390, duration: 0.09, offset: 0.06, wave: "triangle" }],
  piece_move: [{ frequency: 520, duration: 0.055 }],
  capture: [{ frequency: 210, duration: 0.08, wave: "square" }, { frequency: 310, duration: 0.12, offset: 0.07, wave: "triangle" }],
  goal: [{ frequency: 440, duration: 0.1 }, { frequency: 660, duration: 0.14, offset: 0.08 }],
  gift: [{ frequency: 523, duration: 0.11 }, { frequency: 659, duration: 0.14, offset: 0.08 }],
  laugh: [{ frequency: 620, duration: 0.075, wave: "triangle" }, { frequency: 760, duration: 0.08, offset: 0.07, wave: "triangle" }],
  cry: [{ frequency: 500, duration: 0.12 }, { frequency: 390, duration: 0.15, offset: 0.09 }],
  angry: [{ frequency: 190, duration: 0.12, wave: "sawtooth" }],
  cool: [{ frequency: 350, duration: 0.09 }, { frequency: 470, duration: 0.12, offset: 0.07 }],
  shocked: [{ frequency: 360, duration: 0.07 }, { frequency: 740, duration: 0.12, offset: 0.06 }],
  heart: [{ frequency: 660, duration: 0.1 }, { frequency: 784, duration: 0.13, offset: 0.08 }],
  applause: [{ frequency: 430, duration: 0.045, wave: "square" }, { frequency: 520, duration: 0.05, offset: 0.055, wave: "square" }, { frequency: 470, duration: 0.045, offset: 0.11, wave: "square" }],
};

let context: AudioContext | null = null;
let unlocked = false;

export async function unlockGameAudio(): Promise<void> {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return;
  try {
    context ??= new AudioContext();
    await context.resume();
    unlocked = context.state === "running";
  } catch {
    unlocked = false;
  }
}

function playPattern(cue: AudioCue): void {
  if (!context || !unlocked || context.state !== "running") return;
  for (const tone of SOUND_PATTERNS[cue]) {
    try {
      const startAt = context.currentTime + (tone.offset ?? 0);
      const endAt = startAt + tone.duration;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = tone.wave ?? "sine";
      oscillator.frequency.setValueAtTime(tone.frequency, startAt);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.045, startAt + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startAt);
      oscillator.stop(endAt + 0.015);
    } catch {
      // Audio should never interrupt a move or social interaction.
    }
  }
}

export function playGameSound(cue: AudioCue, preferences: PlayerPreferences): void {
  if (REACTION_CUES.has(cue as ReactionId)) {
    if (preferences.reactionSoundsEnabled) playPattern(cue);
    return;
  }
  if (preferences.gameEffectsEnabled) playPattern(cue);
}
