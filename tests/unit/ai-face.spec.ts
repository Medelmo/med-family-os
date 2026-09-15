import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AI_FACE_STATES,
  DEFAULT_RANDOM_SETTINGS,
  pickRandomState,
  randomDuration,
  resolveAutoState,
  type AIFaceState,
  type RandomSettings,
} from "../../components/ai-face/robotStates";
import { resolveDisplayState } from "../../components/ai-face/AIFaceProvider";
import en from "../../messages/en.json";
import de from "../../messages/de.json";

/**
 * The face's decision-making, which is all pure.
 *
 * Mode arbitration, the priority ladder and the ambient walk are ordinary
 * functions precisely so they can be tested without a DOM, a timer or a
 * renderer. What is deliberately *not* tested here is whether an eye moves:
 * that is `requestAnimationFrame` writing a CSS variable, and asserting on
 * it in jsdom would test the mock rather than the face.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("auto mode's priority ladder", () => {
  it("puts speaking above the explicit state", () => {
    expect(resolveAutoState({ state: "happy", speaking: true })).toBe("speaking");
  });

  it("ranks speaking over listening over thinking", () => {
    expect(resolveAutoState({ state: "neutral", speaking: true, listening: true, thinking: true })).toBe("speaking");
    expect(resolveAutoState({ state: "neutral", listening: true, thinking: true })).toBe("listening");
    expect(resolveAutoState({ state: "neutral", thinking: true })).toBe("thinking");
  });

  it("keeps the explicit state when nothing operational is happening", () => {
    expect(resolveAutoState({ state: "celebrating" })).toBe("celebrating");
  });

  /*
   * The one that matters.
   *
   * An error or an alert is the application telling the household something
   * is wrong. If `speaking` could mask it, the face would go back to looking
   * conversational the moment anything spoke — and the alarm would be gone
   * with nothing having been resolved.
   */
  it("lets nothing mask an error or an alert", () => {
    for (const urgent of ["error", "alert"] as const) {
      expect(resolveAutoState({ state: urgent, speaking: true, listening: true, thinking: true })).toBe(urgent);
    }
  });
});

describe("mode arbitration", () => {
  const base = { state: "happy" as AIFaceState, speaking: true };

  it("fixed mode shows exactly what was asked for, even while speaking", () => {
    expect(resolveDisplayState({ mode: "fixed", ...base }, "curious")).toBe("happy");
  });

  it("random mode shows the walk's state, ignoring the controller's", () => {
    expect(resolveDisplayState({ mode: "random", ...base }, "curious")).toBe("curious");
  });

  it("auto mode applies the ladder", () => {
    expect(resolveDisplayState({ mode: "auto", ...base }, "curious")).toBe("speaking");
  });
});

describe("the ambient random walk", () => {
  /*
   * The package shipped `alert` and `error` in the random pool. On a screen
   * listing a household's deadlines, an ambient alarm is a false alarm about
   * something real — so they are out, and this is the test that says so.
   */
  it("never selects a state that would read as a status", () => {
    const forbidden: AIFaceState[] = ["alert", "error", "sad", "angry", "worried"];
    for (const state of forbidden) {
      expect(DEFAULT_RANDOM_SETTINGS.allowedStates).not.toContain(state);
    }
  });

  it("only ever returns a state from the pool", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(DEFAULT_RANDOM_SETTINGS.allowedStates).toContain(
        pickRandomState(DEFAULT_RANDOM_SETTINGS.allowedStates)
      );
    }
  });

  it("never picks the state already showing, so something always changes", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(pickRandomState(DEFAULT_RANDOM_SETTINGS.allowedStates, "happy")).not.toBe("happy");
    }
  });

  it("avoids bouncing straight back to the one before", () => {
    for (let i = 0; i < 200; i += 1) {
      const next = pickRandomState(DEFAULT_RANDOM_SETTINGS.allowedStates, "happy", "curious");
      expect(next).not.toBe("happy");
      expect(next).not.toBe("curious");
    }
  });

  // Degenerate pools must still return something renderable rather than
  // undefined, which would index AI_FACE_STATES to nothing and throw in the
  // renderer.
  it("survives a pool of one", () => {
    expect(pickRandomState(["sleepy"], "sleepy", "sleepy")).toBe("sleepy");
  });

  it("falls back to the default pool when given an empty one", () => {
    expect(DEFAULT_RANDOM_SETTINGS.allowedStates).toContain(pickRandomState([]));
  });
});

describe("random durations", () => {
  const settings = (over: Partial<RandomSettings>): RandomSettings => ({ ...DEFAULT_RANDOM_SETTINGS, ...over });

  it("stays inside the configured band", () => {
    for (let i = 0; i < 200; i += 1) {
      const ms = randomDuration(DEFAULT_RANDOM_SETTINGS);
      expect(ms).toBeGreaterThanOrEqual(DEFAULT_RANDOM_SETTINGS.minDurationMs);
      expect(ms).toBeLessThanOrEqual(DEFAULT_RANDOM_SETTINGS.maxDurationMs);
    }
  });

  /*
   * A zero or negative duration would schedule a `setTimeout(0)` loop that
   * changes the face every tick and pins a core. Configuration is allowed
   * to be wrong; the consequence is not allowed to be that.
   */
  it("refuses to spin when configured with a zero or inverted band", () => {
    expect(randomDuration(settings({ minDurationMs: 0, maxDurationMs: 0 }))).toBeGreaterThanOrEqual(1_000);
    const inverted = randomDuration(settings({ minDurationMs: 9_000, maxDurationMs: 2_000 }));
    expect(inverted).toBeGreaterThanOrEqual(1_000);
    expect(Number.isFinite(inverted)).toBe(true);
  });
});

describe("the state table", () => {
  it("has a translation for every state in both locales", () => {
    const states = Object.keys(AI_FACE_STATES);
    // The `aria-label` is looked up as `state.<name>`; a state added to the
    // table without a message throws at render time, on that state only —
    // which is the kind of bug that ships.
    expect(Object.keys(en.aiFace.state).sort()).toEqual(states.sort());
    expect(Object.keys(de.aiFace.state).sort()).toEqual(states.sort());
  });

  it("gives every state a scan speed that cannot divide by zero", () => {
    for (const [name, config] of Object.entries(AI_FACE_STATES)) {
      expect(config.scanSpeed, name).toBeGreaterThan(0);
    }
  });
});
