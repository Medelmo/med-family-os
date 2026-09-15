"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useHydrated } from "../ui/useHydrated";
import {
  getVoicePreference,
  getVoicePreferenceServer,
  setVoicePreference,
  subscribeVoicePreference,
} from "./voicePreference";

export type SpeechStatus =
  /** Nothing has been attempted yet. */
  | "idle"
  /** The voice is playing right now. */
  | "speaking"
  /** Said, and finished. */
  | "done"
  /** The browser refused to start without a gesture — one press will fix it. */
  | "blocked"
  /** No speech engine, or no voice for this language, on this device. */
  | "unavailable";

export interface Speech {
  status: SpeechStatus;
  /** Whether the household has this switched on at all. */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  speak: (text: string) => void;
  cancel: () => void;
  supported: boolean;
}

/**
 * The assistant's voice (ADR-026).
 *
 * Uses the browser's own speech engine rather than shipping audio files,
 * for three reasons that all matter to a self-hosted household app: there
 * is no third party to call, it works with the house's internet down, and
 * the greeting can say a person's actual name — which a recorded file
 * cannot, and which is the entire point of "Willkommen Mohamed".
 *
 * ## The two things that go wrong
 *
 * **Browsers refuse to speak before the page has been interacted with.**
 * Not a bug to work around — it is what stops every tab on the internet
 * talking at you. So the status distinguishes `blocked` from `unavailable`
 * and the UI offers a single control, rather than the greeting silently
 * doing nothing. In practice the sign-in submit is itself the gesture, so
 * arriving here from the login form usually speaks on its own.
 *
 * **Voices load asynchronously**, and on a cold start `getVoices()` is
 * routinely empty. It is therefore read at the moment of speaking and
 * again on `voiceschanged`, never cached at module load.
 */
/** How long to wait for a browser to publish its voice list before giving up. */
const VOICE_WAIT_MS = 1500;

export function useSpeech(locale: string): Speech {
  /*
   * Capability detection has to wait for hydration.
   *
   * `typeof window !== "undefined"` looks like the obvious test and tore
   * the page: the server rendered "no speech engine" and the browser's
   * very first render said "yes there is", so the voice control existed on
   * one side of hydration and not the other. React reported it as a
   * hydration failure, which is exactly what it was.
   *
   * `useHydrated` is the project's existing answer to this shape — the
   * same one that fixed every form being inert before hydration — and it
   * makes the first client render agree with the server by construction.
   */
  const hydrated = useHydrated();
  const supported =
    hydrated &&
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof window.SpeechSynthesisUtterance === "function";

  // Read through useSyncExternalStore rather than useState-plus-effect:
  // the value lives outside React, differs on the server, and can change
  // from another tab. See voicePreference.ts.
  const enabled = useSyncExternalStore(
    subscribeVoicePreference,
    getVoicePreference,
    getVoicePreferenceServer
  );

  const [status, setStatus] = useState<SpeechStatus>("idle");
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (!supported) return;
    // Nudges the engine into loading its voice list, so the first greeting
    // is not the one that has to wait for it.
    const warm = () => window.speechSynthesis.getVoices();
    warm();
    window.speechSynthesis.addEventListener?.("voiceschanged", warm);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", warm);
  }, [supported]);

  // A speaking utterance outlives the component unless it is cancelled —
  // navigating away mid-greeting would otherwise leave a voice talking to
  // an empty room.
  useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel();
    };
  }, [supported]);

  const setEnabled = useCallback(
    (on: boolean) => {
      setVoicePreference(on);
      if (!on && supported) {
        window.speechSynthesis.cancel();
        setStatus("idle");
      }
    },
    [supported]
  );

  const cancel = useCallback(() => {
    if (supported) window.speechSynthesis.cancel();
    setStatus("idle");
  }, [supported]);

  /**
   * Says a line, waiting for the engine's voice list if it is not ready.
   *
   * The wait is the whole point. `getVoices()` is empty on a cold page
   * load in every browser — the list arrives asynchronously and announces
   * itself with `voiceschanged` — and the first version of this treated
   * that empty list as "this device has no voice for your language". The
   * result was the greeting silently refusing to speak on exactly the load
   * that matters, on hardware that could say it perfectly well. Caught by
   * checking a browser that *did* have voices and still got the fallback.
   *
   * So an empty list is now a "not yet", with one retry when the engine
   * reports in and a bounded wait after which it really is a "no".
   */
  const speak = useCallback(
    (text: string) => {
      if (!supported) {
        setStatus("unavailable");
        return;
      }
      if (!enabled) {
        setStatus("idle");
        return;
      }

      const attempt = (): boolean => {
        const voice = pickVoice(locale);
        if (!voice) return false;

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.voice = voice;
        utterance.lang = voice.lang;
        // A shade under natural pace and a shade below natural pitch:
        // enough to read as an instrument, not so much as to become a
        // costume.
        utterance.rate = 0.96;
        utterance.pitch = 0.9;

        utterance.onstart = () => setStatus("speaking");
        utterance.onend = () => setStatus("done");
        utterance.onerror = (event) => {
          // "interrupted" and "canceled" are this component's own doing —
          // a re-render or an unmount — and are not failures to report.
          const reason = (event as SpeechSynthesisErrorEvent).error;
          if (reason === "interrupted" || reason === "canceled") return;
          setStatus(reason === "not-allowed" ? "blocked" : "unavailable");
        };

        utteranceRef.current = utterance;

        try {
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        } catch {
          setStatus("blocked");
          return true;
        }

        // Chrome accepts the call and then silently does nothing when the
        // page has had no gesture yet: `speak()` does not throw and
        // `onerror` never fires. The only reliable tell is that nothing
        // started, so this checks shortly after and reports `blocked` —
        // which is what turns an unexplained silence into a button worth
        // pressing.
        window.setTimeout(() => {
          if (utteranceRef.current !== utterance) return;
          if (!window.speechSynthesis.speaking && !window.speechSynthesis.pending) {
            setStatus((current) => (current === "speaking" || current === "done" ? current : "blocked"));
          }
        }, 320);

        return true;
      };

      if (attempt()) return;

      // No voices yet. Wait for the engine rather than giving up on it.
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        window.speechSynthesis.removeEventListener?.("voiceschanged", onVoices);
        window.clearTimeout(timeout);
      };

      const onVoices = () => {
        if (settled) return;
        if (attempt()) done();
      };

      const timeout = window.setTimeout(() => {
        if (settled) return;
        // One last look — some engines populate the list without ever
        // firing the event.
        if (!attempt()) setStatus("unavailable");
        done();
      }, VOICE_WAIT_MS);

      window.speechSynthesis.addEventListener?.("voiceschanged", onVoices);
    },
    [enabled, locale, supported]
  );

  return { status, enabled, setEnabled, speak, cancel, supported };
}

/**
 * The best available voice for a locale.
 *
 * Prefers a local voice over a network one: a cloud voice adds latency the
 * mouth animation would have to wait for, and stops working the moment the
 * house's connection does — which for a self-hosted application is a
 * dependency worth refusing.
 */
function pickVoice(locale: string): SpeechSynthesisVoice | null {
  const all = window.speechSynthesis.getVoices() ?? [];
  if (all.length === 0) return null;

  const wanted = locale.slice(0, 2).toLowerCase();
  const matching = all.filter((voice) => voice.lang.slice(0, 2).toLowerCase() === wanted);
  if (matching.length === 0) return null;

  return matching.find((voice) => voice.localService) ?? matching[0];
}
