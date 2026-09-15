"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import {
  DEFAULT_RANDOM_SETTINGS,
  resolveAutoState,
  type AIFaceMode,
  type AIFaceState,
  type RandomSettings,
} from "./robotStates";

/**
 * The single source of truth for the assistant's face.
 *
 * One controller, held in one place, reached through `useAIFace()`. The
 * brief's requirement — *"Do not scatter animation logic throughout
 * unrelated home-screen components"* — is enforced structurally: nothing
 * outside this directory owns face state, and the only way to change it is
 * `setAiFace`.
 *
 * Deliberately not a store library. The state is five fields read by one
 * subtree; adding Zustand or Redux for that would be a dependency bought
 * to avoid twenty lines of context.
 */

export interface AIFaceController {
  mode: AIFaceMode;
  state: AIFaceState;
  speaking?: boolean;
  /** 0 = closed, 1 = fully open. Omit for procedural mouth movement. */
  lipSyncLevel?: number;
  /** Auto-mode inputs, above the explicit state on the priority ladder. */
  listening?: boolean;
  thinking?: boolean;
}

/** Every field optional: a caller changes only what it means to change. */
export type AIFaceUpdate = Partial<AIFaceController>;

export interface AIFaceContextValue {
  controller: AIFaceController;
  randomSettings: RandomSettings;
  setAiFace: (update: AIFaceUpdate) => void;
  /**
   * Sets a state, then returns to what was showing before.
   *
   * For the moments that are events rather than conditions — a save
   * succeeded, a warning appeared. Without it every caller writes the same
   * timeout, and the ones that forget leave the face celebrating forever.
   */
  flashAiFace: (state: AIFaceState, durationMs?: number) => void;
  setRandomSettings: (settings: Partial<RandomSettings>) => void;
}

const DEFAULT_CONTROLLER: AIFaceController = {
  // Calm and slightly friendly, as the brief asks for the default.
  mode: "auto",
  state: "neutral",
};

const AIFaceContext = createContext<AIFaceContextValue | null>(null);

export interface AIFaceProviderProps {
  children: ReactNode;
  initial?: AIFaceUpdate;
  randomSettings?: Partial<RandomSettings>;
}

export function AIFaceProvider({ children, initial, randomSettings: randomOverrides }: AIFaceProviderProps) {
  const [controller, setController] = useState<AIFaceController>({ ...DEFAULT_CONTROLLER, ...initial });
  const [randomSettings, setRandomSettingsState] = useState<RandomSettings>({
    ...DEFAULT_RANDOM_SETTINGS,
    ...randomOverrides,
  });

  const flashTimer = useRef(0);
  const beforeFlash = useRef<AIFaceState | null>(null);

  const setAiFace = useCallback((update: AIFaceUpdate) => {
    // An explicit change cancels a flash in progress, so the flash cannot
    // later restore a state the application has since moved on from.
    window.clearTimeout(flashTimer.current);
    beforeFlash.current = null;
    setController((current) => ({ ...current, ...update }));
  }, []);

  const flashAiFace = useCallback((state: AIFaceState, durationMs = 2600) => {
    window.clearTimeout(flashTimer.current);

    setController((current) => {
      // Only remember the pre-flash state once, so two flashes in quick
      // succession still return to where the application actually was.
      if (beforeFlash.current === null) beforeFlash.current = current.state;
      return { ...current, state };
    });

    flashTimer.current = window.setTimeout(() => {
      const restore = beforeFlash.current;
      beforeFlash.current = null;
      if (restore) setController((current) => ({ ...current, state: restore }));
    }, durationMs);
  }, []);

  const setRandomSettings = useCallback((settings: Partial<RandomSettings>) => {
    setRandomSettingsState((current) => ({ ...current, ...settings }));
  }, []);

  const value = useMemo<AIFaceContextValue>(
    () => ({ controller, randomSettings, setAiFace, flashAiFace, setRandomSettings }),
    [controller, randomSettings, setAiFace, flashAiFace, setRandomSettings]
  );

  return <AIFaceContext.Provider value={value}>{children}</AIFaceContext.Provider>;
}

/**
 * The public API.
 *
 * Throws outside a provider rather than returning a no-op: a component
 * calling `setAiFace` into a void would look like it worked and quietly
 * do nothing, which is a worse afternoon than an error naming the missing
 * provider.
 */
export function useAIFace(): AIFaceContextValue {
  const value = useContext(AIFaceContext);
  if (!value) {
    throw new Error("useAIFace must be used inside an <AIFaceProvider>.");
  }
  return value;
}

/**
 * The state the face should actually show, after mode arbitration.
 *
 * Kept here rather than in the renderer so every consumer — the face, a
 * test, a future second placement — agrees on what "the current state"
 * means. `randomState` is supplied by the renderer, which is the only
 * thing that should be running a timer.
 */
export function resolveDisplayState(
  controller: AIFaceController,
  randomState: AIFaceState
): AIFaceState {
  switch (controller.mode) {
    case "fixed":
      // Exactly what was asked for, until the application says otherwise —
      // not even speaking overrides it.
      return controller.state;

    case "random":
      return randomState;

    case "auto":
      return resolveAutoState(controller);
  }
}
