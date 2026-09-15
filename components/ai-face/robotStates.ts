/**
 * The state contract for the Cyber Guardian face.
 *
 * Taken from `ai-family-robot-face/src/lib/robotStates.ts` and kept
 * deliberately intact: the numeric parameters are calibrated against the
 * supplied artwork, and the package's own integration notes ask for the
 * state names and conceptual parameters to stay stable so a Rive state
 * machine can replace the SVG runtime later without touching the
 * application-facing contract.
 *
 * What is added here rather than changed: the random-mode configuration,
 * which the package left as a fixed list and interval.
 */

export type AIFaceMode = "fixed" | "random" | "auto";

export type AIFaceState =
  | "neutral"
  | "happy"
  | "excited"
  | "loving"
  | "sad"
  | "angry"
  | "worried"
  | "surprised"
  | "confused"
  | "thinking"
  | "sleepy"
  | "focused"
  | "listening"
  | "speaking"
  | "celebrating"
  | "alert"
  | "error"
  | "curious";

export interface AIFaceStateConfig {
  label: string;
  emoji: string;
  description: string;
  eyeGlow: number;
  lid: number;
  browTilt: number;
  mouthCurve: number;
  mouthOpen: number;
  mouthWidth: number;
  headTilt: number;
  headLift: number;
  scanSpeed: number;
  pulse: number;
}

/* prettier-ignore */
export const AI_FACE_STATES: Record<AIFaceState, AIFaceStateConfig> = {
  neutral:      { label: 'Neutral',      emoji: '◉', description: 'Calm default state',              eyeGlow: 1,   lid: 0,    browTilt: 0,    mouthCurve: 0,    mouthOpen: 0.08, mouthWidth: 1,    headTilt: 0,    headLift: 0,    scanSpeed: 7,   pulse: 1 },
  happy:        { label: 'Happy',        emoji: '😊', description: 'Warm, friendly and relaxed',      eyeGlow: 1.1, lid: 0,    browTilt: 0.08, mouthCurve: 0.8,  mouthOpen: 0.16, mouthWidth: 1.08, headTilt: -1,   headLift: -1,   scanSpeed: 6.5, pulse: 1.2 },
  excited:      { label: 'Excited',      emoji: '✨', description: 'High-energy positive reaction',   eyeGlow: 1.35,lid: -0.05,browTilt: -0.12,mouthCurve: 0.65, mouthOpen: 0.42, mouthWidth: 1.18, headTilt: 1.4,  headLift: -2.5, scanSpeed: 4.2, pulse: 1.7 },
  loving:       { label: 'Loving',       emoji: '💙', description: 'Affectionate, reassuring mode',   eyeGlow: 1.22,lid: 0.06, browTilt: 0.16, mouthCurve: 0.58, mouthOpen: 0.12, mouthWidth: 1.04, headTilt: -1.8, headLift: 0,    scanSpeed: 8,   pulse: 1.25 },
  sad:          { label: 'Sad',          emoji: '😔', description: 'Gentle concern and empathy',      eyeGlow: 0.75,lid: 0.38, browTilt: -0.22,mouthCurve: -0.62,mouthOpen: 0.05, mouthWidth: 0.96, headTilt: -2.2, headLift: 3,    scanSpeed: 10,  pulse: 0.75 },
  angry:        { label: 'Angry',        emoji: '😠', description: 'Strong negative reaction',        eyeGlow: 1.5, lid: -0.18,browTilt: 0.7,  mouthCurve: -0.35,mouthOpen: 0.14, mouthWidth: 1.02, headTilt: 0.8,  headLift: 0,    scanSpeed: 3.2, pulse: 1.9 },
  worried:      { label: 'Worried',      emoji: '😟', description: 'Uncertain or concerned',          eyeGlow: 0.92,lid: 0.24, browTilt: -0.46,mouthCurve: -0.28,mouthOpen: 0.07, mouthWidth: 0.96, headTilt: 1.7,  headLift: 1.8,  scanSpeed: 8.5, pulse: 0.9 },
  surprised:    { label: 'Surprised',    emoji: '😮', description: 'Sudden discovery or shock',       eyeGlow: 1.65,lid: -0.12,browTilt: -0.55,mouthCurve: 0,    mouthOpen: 0.9,  mouthWidth: 0.82, headTilt: 0,    headLift: -3,   scanSpeed: 3.8, pulse: 1.8 },
  confused:     { label: 'Confused',     emoji: '🤔', description: 'Processing something unclear',    eyeGlow: 1.02,lid: 0.05, browTilt: -0.18,mouthCurve: 0.08, mouthOpen: 0.12, mouthWidth: 0.86, headTilt: 4.5,  headLift: 2,    scanSpeed: 6,   pulse: 1.05 },
  thinking:     { label: 'Thinking',     emoji: '🧠', description: 'Reasoning / planning',            eyeGlow: 1.0, lid: 0.12, browTilt: -0.1, mouthCurve: -0.02,mouthOpen: 0.05, mouthWidth: 0.92, headTilt: -3.5, headLift: 2.5,  scanSpeed: 4.8, pulse: 1.35 },
  sleepy:       { label: 'Sleepy',       emoji: '😴', description: 'Low-energy resting mode',         eyeGlow: 0.48,lid: 0.72, browTilt: 0.02, mouthCurve: 0.05, mouthOpen: 0.04, mouthWidth: 0.92, headTilt: -1.2, headLift: 4.5,  scanSpeed: 14,  pulse: 0.45 },
  focused:      { label: 'Focused',      emoji: '🎯', description: 'Concentrating on a task',         eyeGlow: 1.22,lid: -0.04,browTilt: 0.24, mouthCurve: 0,    mouthOpen: 0.06, mouthWidth: 0.94, headTilt: 0,    headLift: 0,    scanSpeed: 3.8, pulse: 1.5 },
  listening:    { label: 'Listening',    emoji: '👂', description: 'Waiting for the user',            eyeGlow: 1.2, lid: 0.08, browTilt: -0.06,mouthCurve: 0.04, mouthOpen: 0.03, mouthWidth: 0.96, headTilt: 0,    headLift: -1,   scanSpeed: 5.5, pulse: 1.25 },
  speaking:     { label: 'Speaking',     emoji: '🗣️', description: 'Lip-sync / speech mode',          eyeGlow: 1.18,lid: 0.02, browTilt: 0.05, mouthCurve: 0.18, mouthOpen: 0.52, mouthWidth: 1.08, headTilt: 0,    headLift: -0.4, scanSpeed: 5,   pulse: 1.25 },
  celebrating:  { label: 'Celebrating',  emoji: '🎉', description: 'Success or completed goal',       eyeGlow: 1.5, lid: -0.08,browTilt: -0.1, mouthCurve: 0.85, mouthOpen: 0.66, mouthWidth: 1.22, headTilt: -1.5, headLift: -3.5, scanSpeed: 3.8, pulse: 2.1 },
  alert:        { label: 'Alert',        emoji: '⚠️', description: 'Needs attention right now',       eyeGlow: 1.75,lid: -0.15,browTilt: 0.52, mouthCurve: -0.1, mouthOpen: 0.16, mouthWidth: 1.06, headTilt: 0,    headLift: -2,   scanSpeed: 2.2, pulse: 2.3 },
  error:        { label: 'Error',        emoji: '🛑', description: 'Something failed',                eyeGlow: 1.9, lid: 0.06, browTilt: 0.55, mouthCurve: -0.58,mouthOpen: 0.18, mouthWidth: 1.04, headTilt: 0.9,  headLift: 1.5,  scanSpeed: 2.8, pulse: 2.6 },
  curious:      { label: 'Curious',      emoji: '🔎', description: 'Investigating or exploring',      eyeGlow: 1.28,lid: -0.02,browTilt: -0.26,mouthCurve: 0.12, mouthOpen: 0.1,  mouthWidth: 0.97, headTilt: -2.8, headLift: -0.5, scanSpeed: 4.5, pulse: 1.45 },
};

export interface RandomSettings {
  enabled: boolean;
  minDurationMs: number;
  maxDurationMs: number;
  allowedStates: AIFaceState[];
}

/**
 * Ambient behaviour only.
 *
 * `error` and `alert` are absent on purpose, and this is the one place the
 * package's own list was changed. It shipped with both in the random pool,
 * and the package's integration notes explain exactly why that is wrong:
 * *"Never use random mode to communicate errors, deadlines, or other
 * important information because it can select an emotionally misleading
 * state."* On a screen listing a household's deadlines, a face that looks
 * alarmed for ambient reasons is a false alarm about something real.
 *
 * `sad`, `angry` and `worried` are out for the same reason at lower
 * intensity: they read as a reaction to the content next to them.
 */
export const DEFAULT_RANDOM_SETTINGS: RandomSettings = {
  enabled: true,
  minDurationMs: 6_000,
  maxDurationMs: 16_000,
  allowedStates: ["neutral", "happy", "curious", "focused", "thinking", "sleepy", "loving"],
};

/**
 * Picks the next ambient state.
 *
 * Avoids the current state so something always visibly changes, and — with
 * three or more candidates — the one before it too, so the face does not
 * fall into an obvious A–B–A–B oscillation.
 */
export function pickRandomState(
  allowed: readonly AIFaceState[],
  current?: AIFaceState,
  previous?: AIFaceState
): AIFaceState {
  const pool = allowed.length > 0 ? allowed : DEFAULT_RANDOM_SETTINGS.allowedStates;

  let candidates = pool.filter((s) => s !== current);
  if (candidates.length > 1) {
    const withoutPrevious = candidates.filter((s) => s !== previous);
    if (withoutPrevious.length > 0) candidates = withoutPrevious;
  }
  if (candidates.length === 0) candidates = [...pool];

  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** A duration in the configured band. */
export function randomDuration(settings: RandomSettings): number {
  const min = Math.max(1_000, Math.min(settings.minDurationMs, settings.maxDurationMs));
  const max = Math.max(min, settings.maxDurationMs);
  return min + Math.random() * (max - min);
}

/**
 * Auto mode's priority ladder.
 *
 * `error / critical alert -> speaking -> listening -> thinking ->
 * explicit emotional state -> neutral`.
 *
 * The explicit state is the *floor*, not the ceiling: an application that
 * has set `celebrating` keeps it right up until something more urgent is
 * true, and only the four operational states above can take it. That is
 * what stops auto mode quietly overriding a deliberate choice.
 */
export function resolveAutoState(input: {
  state: AIFaceState;
  speaking?: boolean;
  listening?: boolean;
  thinking?: boolean;
}): AIFaceState {
  if (input.state === "error" || input.state === "alert") return input.state;
  if (input.speaking) return "speaking";
  if (input.listening) return "listening";
  if (input.thinking) return "thinking";
  return input.state;
}
