"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  pickRandomState,
  randomDuration,
  type AIFaceState,
  type RandomSettings,
} from "./robotStates";

/**
 * The animation controllers behind the face.
 *
 * Each is a hook with one job — blinking, micro-movement, lip sync, the
 * random walk — so the visual component stays a renderer and the timing
 * logic is testable and replaceable on its own.
 *
 * Every one of them obeys the same two rules, which the package's
 * prototype did not:
 *
 * - **Nothing runs while the page is hidden.** A face animating in a
 *   background tab is pure battery cost for something nobody can see.
 * - **Nothing runs under `prefers-reduced-motion`.** Reduced, not
 *   removed: the face still changes state, it simply stops moving of its
 *   own accord.
 */

/* ------------------------------------------------------------------ *
 * environment
 * ------------------------------------------------------------------ */

const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeMotion,
    () => window.matchMedia(MOTION_QUERY).matches,
    // The server cannot know, and full motion is the design's resting state.
    () => false
  );
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function useIsVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true
  );
}

/** Whether the controllers should be animating at all. */
export function useShouldAnimate(): boolean {
  const reduced = usePrefersReducedMotion();
  const visible = useIsVisible();
  return !reduced && visible;
}

/* ------------------------------------------------------------------ *
 * blink
 * ------------------------------------------------------------------ */

export interface BlinkOptions {
  /** `sleepy` blinks slowly and for longer; `surprised` barely blinks. */
  intervalScale?: number;
  durationScale?: number;
}

/**
 * Natural blinking.
 *
 * Randomised interval *and* randomised duration, because a fixed cadence
 * is the thing that makes an animated face read as a machine loop. Each
 * blink schedules the next one rather than running on an interval, so the
 * spacing never quantises to a timer.
 */
export function useBlink(active: boolean, options: BlinkOptions = {}): boolean {
  const { intervalScale = 1, durationScale = 1 } = options;
  const [blinking, setBlinking] = useState(false);

  useEffect(() => {
    if (!active) return;

    let openTimer = 0;
    let closeTimer = 0;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      const wait = (2_400 + Math.random() * 4_600) * intervalScale;

      closeTimer = window.setTimeout(() => {
        if (cancelled) return;
        setBlinking(true);

        openTimer = window.setTimeout(
          () => {
            if (cancelled) return;
            setBlinking(false);
            schedule();
          },
          (110 + Math.random() * 90) * durationScale
        );
      }, wait);
    };

    schedule();

    return () => {
      cancelled = true;
      window.clearTimeout(closeTimer);
      window.clearTimeout(openTimer);
      // Open the eyes on the way out. Reset here rather than in the
      // inactive branch of the body: stopping mid-blink is the only way
      // `blinking` can be left true with nothing scheduled to clear it,
      // and the tab going hidden during the ~150ms a blink lasts is
      // exactly that case. Without this, coming back to the tab found the
      // face with its eyes shut until the next blink finished.
      setBlinking(false);
    };
  }, [active, intervalScale, durationScale]);

  return blinking;
}

/* ------------------------------------------------------------------ *
 * micro-movement
 * ------------------------------------------------------------------ */

export interface Glance {
  x: number;
  y: number;
}

/**
 * Small eye movements, so the face is never completely frozen.
 *
 * `amplitude` is the state's own restlessness: `focused` holds a steady
 * gaze, `worried` and `confused` look around more. A glance that is
 * always the same size makes every state feel identical underneath.
 */
const EYES_CENTRED: Glance = { x: 0, y: 0 };

export function useGlance(active: boolean, amplitude = 1): Glance {
  const [glance, setGlance] = useState<Glance>(EYES_CENTRED);

  useEffect(() => {
    if (!active) return;

    let timer = 0;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      timer = window.setTimeout(
        () => {
          if (cancelled) return;
          setGlance({
            x: (Math.random() - 0.5) * 9 * amplitude,
            y: (Math.random() - 0.5) * 5 * amplitude,
          });
          schedule();
        },
        1_600 + Math.random() * 2_600
      );
    };

    schedule();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active, amplitude]);

  // Derived rather than reset through state: a stopped face looks straight
  // ahead, and the last offset it happened to hold is not worth a render.
  return active ? glance : EYES_CENTRED;
}

/* ------------------------------------------------------------------ *
 * lip sync
 * ------------------------------------------------------------------ */

/**
 * The mouth opening, smoothed.
 *
 * Two things happen here, and both were in the brief:
 *
 * **It is not linear.** The target is eased toward with an asymmetric
 * filter — mouths open faster than they close — so a jumpy `lipSyncLevel`
 * from an audio analyser becomes movement rather than chatter. A raw
 * value applied straight to a transform looks like a mechanical shutter.
 *
 * **It works with no level at all.** `speaking` with no `lipSyncLevel`
 * generates procedural movement from two detuned sine waves, which reads
 * as speech because it never repeats on a short cycle. A single sine does
 * not: it reads as a metronome.
 *
 * Driven by `requestAnimationFrame` and written to a ref, so a speaking
 * face costs no React re-renders at all — the value is pushed straight to
 * a CSS custom property by the renderer.
 */
export function useLipSync(
  speaking: boolean,
  level: number | undefined,
  restingOpen: number,
  active: boolean
): { read: () => number; subscribe: (fn: (v: number) => void) => () => void } {
  const current = useRef(restingOpen);
  const listeners = useRef(new Set<(v: number) => void>());

  /*
   * Read inside the frame loop without making it a dependency.
   *
   * Written in an effect rather than during render: a ref assigned while
   * rendering is torn under concurrent rendering, where a render can be
   * thrown away after it has already mutated the ref. One frame of
   * staleness is the cost, and a frame is 16ms of mouth position.
   */
  const target = useRef({ speaking, level, restingOpen, active });

  useEffect(() => {
    target.current = { speaking, level, restingOpen, active };
  }, [speaking, level, restingOpen, active]);

  useEffect(() => {
    let frame = 0;
    const started = performance.now();

    const tick = (now: number) => {
      const { speaking: isSpeaking, level: raw, restingOpen: resting, active: animating } = target.current;

      let goal = resting;

      if (isSpeaking) {
        if (typeof raw === "number" && Number.isFinite(raw)) {
          goal = Math.min(1, Math.max(0, raw));
        } else if (animating) {
          // Two detuned waves: the beat between them keeps the rhythm
          // from repeating on a period anybody can hear.
          const t = (now - started) / 1000;
          const wave = Math.sin(t * 9.1) * 0.5 + Math.sin(t * 14.7) * 0.28;
          goal = Math.min(1, Math.max(0.05, 0.42 + wave * 0.34));
        } else {
          // Reduced motion, or hidden: hold a plausible open mouth.
          goal = Math.max(resting, 0.35);
        }
      }

      if (!animating) {
        current.current = goal;
      } else {
        // Opening is faster than closing, which is how a mouth behaves.
        const rate = goal > current.current ? 0.35 : 0.18;
        current.current += (goal - current.current) * rate;
      }

      for (const listener of listeners.current) listener(current.current);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  return {
    read: () => current.current,
    subscribe: (fn) => {
      listeners.current.add(fn);
      return () => {
        listeners.current.delete(fn);
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * random walk
 * ------------------------------------------------------------------ */

/**
 * Ambient state changes for `random` mode.
 *
 * Each state schedules the next one with its own duration drawn from the
 * configured band, rather than running on one interval — so the changes
 * do not land on a grid, which is what makes a random sequence still feel
 * like a loop.
 */
export function useRandomState(active: boolean, settings: RandomSettings): AIFaceState {
  const [state, setState] = useState<AIFaceState>(() =>
    pickRandomState(settings.allowedStates, undefined, undefined)
  );
  const previous = useRef<AIFaceState | undefined>(undefined);

  const allowedKey = settings.allowedStates.join(",");

  useEffect(() => {
    if (!active || !settings.enabled) return;

    let timer = 0;
    let cancelled = false;

    const schedule = () => {
      if (cancelled) return;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        setState((currentState) => {
          const next = pickRandomState(settings.allowedStates, currentState, previous.current);
          previous.current = currentState;
          return next;
        });
        schedule();
      }, randomDuration(settings));
    };

    schedule();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `allowedKey` stands in for the array's contents; the object identity
    // changes on every render of a caller that inlines its settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, settings.enabled, settings.minDurationMs, settings.maxDurationMs, allowedKey]);

  return state;
}
