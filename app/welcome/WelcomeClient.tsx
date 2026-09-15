"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AIFace, AIFaceProvider, useAIFace } from "../../components/ai-face";
import { useSpeech } from "../../components/assistant/useSpeech";
import styles from "./welcome.module.css";

export interface WelcomeClientProps {
  name: string;
  /** How many things need attention — what it says after the greeting. */
  attentionCount: number;
  /** Where to go when the moment is over. */
  next: string;
}

/** How long the line lingers after it has finished being spoken. */
const LINGER_MS = 1400;
/** Per character, for the typewriter. */
const TYPE_MS = 72;

/**
 * The welcome moment (ADR-026, screen 50).
 *
 * Deliberately a moment and not a page: it says one thing, then leaves. It
 * is reached only by signing in, so it is never something a person has to
 * click past to get to work — and it can be left at any time by pressing
 * anything at all, which is the difference between a greeting and a toll
 * gate.
 *
 * Three things run together, and each has to work without the other two:
 * the android wakes and blinks, the line types itself, and the voice says
 * it. A device with no German voice still gets the typed greeting and the
 * animation. A browser that blocks audio says so and offers one button. A
 * person who asked for reduced motion gets the line, whole, immediately.
 */
export function WelcomeClient(props: WelcomeClientProps) {
  return (
    <AIFaceProvider initial={{ mode: "auto", state: "happy" }}>
      <WelcomeStage {...props} />
    </AIFaceProvider>
  );
}

function WelcomeStage({ name, attentionCount, next }: WelcomeClientProps) {
  const t = useTranslations("welcome");
  const locale = useLocale();
  const router = useRouter();
  const speech = useSpeech(locale);
  const { setAiFace } = useAIFace();

  const greeting = t("greeting", { name });
  const summary =
    attentionCount > 0 ? t("summaryAttention", { count: attentionCount }) : t("summaryClear");

  const [typed, setTyped] = useState("");
  const [leaving, setLeaving] = useState(false);
  const reduced = usePrefersReducedMotion();

  // Derived, not stored. Reduced motion means the line is simply already
  // complete — there is no state to set for it, and setting some would be
  // a render that exists only to correct the previous one.
  const shown = reduced ? greeting : typed;
  const lineComplete = reduced || typed.length >= greeting.length;

  const leave = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    speech.cancel();
    // A beat for the fade, then the app proper. `replace` rather than
    // `push`: the back button should return to wherever they came from,
    // not to a greeting that has already happened.
    window.setTimeout(() => router.replace(next), reduced ? 0 : 420);
  }, [leaving, next, reduced, router, speech]);

  /* ---- the face follows the speech ----
     Auto mode: `speaking` outranks the explicit `happy` while the voice
     plays and hands it straight back when it stops, which is the priority
     ladder doing its job rather than this component sequencing states. */
  useEffect(() => {
    setAiFace({ speaking: speech.status === "speaking" });
  }, [setAiFace, speech.status]);

  /* ---- the line types itself ----
     No "has this run already" ref. An earlier version guarded with one and
     it broke the whole screen: React runs an effect, tears it down and runs
     it again to surface exactly this kind of bug, so the ref was set on the
     first run, the cleanup cleared the interval, and the second run returned
     early — leaving the greeting permanently blank *and* the page hanging,
     because auto-continue waits for a line that would never finish.
     An effect that sets something up and tears it down cleanly needs no
     guard; it just has to be honest about its dependencies. */
  useEffect(() => {
    if (reduced) return;

    // No reset: `typed` starts empty, and `greeting` is fixed for the life
    // of this component — the name comes from the session and a language
    // change remounts the page. Clearing it here would be a synchronous
    // render that only ever undoes nothing.
    let index = 0;
    const timer = window.setInterval(() => {
      index += 1;
      setTyped(greeting.slice(0, index));
      if (index >= greeting.length) window.clearInterval(timer);
    }, TYPE_MS);

    return () => window.clearInterval(timer);
  }, [greeting, reduced]);

  /* ---- and is said aloud alongside it ----
     Separate from the typing so neither depends on the other: a device with
     no voice still types, and a reduced-motion reader still hears it. Safe
     to run more than once because `speak` cancels anything in flight.

     Gated on `supported`, which is false until hydration by design — and
     that gate is load-bearing. Without it this effect fired on the very
     first client render, when capability detection had not run yet, and the
     greeting reported "this device has no voice for your language" on a
     machine that had one. The symptom looked like a missing voice; the
     cause was asking before the answer existed. */
  useEffect(() => {
    if (!speech.supported) return;
    speech.speak(greeting);
    // Intentionally not re-run when `speech` re-renders: `speak` changes
    // identity when the voice preference does, and re-greeting on a toggle
    // is the toggle's own job, not this effect's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [greeting, speech.supported]);

  /* ---- leaving on its own ---- */
  useEffect(() => {
    if (leaving) return;
    // Waits for the *voice* where there is one, and for the typing where
    // there is not — so the moment is never cut off mid-sentence, and
    // never sits there in silence after a device turned out to have no
    // voice to say it with.
    const waitingOnVoice = speech.status === "speaking";
    if (waitingOnVoice) return;

    if (!lineComplete) return;

    const timer = window.setTimeout(leave, LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [leave, leaving, lineComplete, speech.status]);

  /* ---- leaving on a key or a tap ---- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Tab and Shift are somebody navigating to the buttons, not somebody
      // asking to skip.
      if (event.key === "Tab" || event.key === "Shift") return;
      leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  const blocked = speech.status === "blocked";
  const unavailable = speech.status === "unavailable";

  return (
    <div className={`${styles.stage} ${leaving ? styles.leaving : ""}`} onPointerDown={leave}>
      <div className={styles.rings} aria-hidden="true">
        <span className={styles.ring} />
        <span className={styles.ringSlow} />
      </div>

      {/*
        The one placement that is the hero: eager and high priority, because
        the whole screen is waiting on it. `sizes` mirrors `.faceWrap`'s own
        width so the browser picks the right artwork variant.
      */}
      <div className={styles.faceWrap}>
        <AIFace sizes="(max-width: 520px) 66vw, 340px" priority />
      </div>

      {/*
        The greeting is announced once, whole, by the live region — a
        screen reader must not be read a typewriter one character at a
        time. The visible text is therefore aria-hidden and the same words
        are provided to assistive technology in one piece.
      */}
      <p className={styles.greeting} aria-hidden="true">
        {shown}
        <span className={styles.caret} />
      </p>
      <p className={styles.srOnly} role="status">
        {greeting}. {summary}
      </p>

      <p className={styles.summary} aria-hidden="true">
        {summary}
      </p>

      <div className={styles.controls} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className={styles.skip} onClick={leave}>
          {t("continue")}
        </button>

        {speech.supported && (
          <button
            type="button"
            className={styles.ghost}
            aria-pressed={speech.enabled}
            onClick={() => {
              const next = !speech.enabled;
              speech.setEnabled(next);
              if (next) speech.speak(greeting);
            }}
          >
            <span className={styles.dot} aria-hidden="true" />
            {speech.enabled ? t("voiceOn") : t("voiceOff")}
          </button>
        )}

        {blocked && (
          <button type="button" className={styles.ghost} onClick={() => speech.speak(greeting)}>
            {t("playGreeting")}
          </button>
        )}
      </div>

      {(blocked || unavailable) && (
        <p className={styles.note}>{blocked ? t("blockedNote") : t("unavailableNote")}</p>
      )}
    </div>
  );
}

/**
 * Whether this person has asked for less motion.
 *
 * Read in JavaScript as well as in CSS because the sequence's *timing*
 * changes, not only its appearance: the greeting arrives whole instead of
 * being typed, so there is nothing to wait for before continuing.
 *
 * `useSyncExternalStore` rather than state-plus-effect — a media query is
 * precisely an external, subscribable value with a different answer on the
 * server, and the effect version renders once with the wrong answer before
 * correcting itself.
 */
const MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeMotion(onChange: () => void): () => void {
  const query = window.matchMedia(MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getMotionSnapshot(): boolean {
  return window.matchMedia(MOTION_QUERY).matches;
}

/** The server cannot know, and full motion is the design's resting state. */
function getMotionServerSnapshot(): boolean {
  return false;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, getMotionSnapshot, getMotionServerSnapshot);
}
