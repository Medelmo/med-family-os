"use client";

import { useEffect } from "react";
import { AIFace, AIFaceProvider, useAIFace, type AIFaceState } from "../../../components/ai-face";
import styles from "./todayFace.module.css";

export interface TodayFaceProps {
  /** Of the day's items, the ones already past their date. */
  overdueCount: number;
  /** Nothing due, nothing waiting, no deadline reached. */
  quiet: boolean;
}

/**
 * The assistant on the home screen.
 *
 * The state is derived from what this page already knows, and from nothing
 * else. The brief asks not to invent application events, and Today has no
 * assistant runtime — no listening, no speaking, no streaming. What it has
 * is the day's own rows, so that is what the face reflects:
 *
 * - something overdue  -> `alert`
 * - something waiting  -> `focused`
 * - a quiet day        -> `happy`
 *
 * Deliberately **not** random mode. The package's own integration notes
 * are explicit that random mode is ambient character and must never carry
 * status, and a face picking `sleepy` at random next to three overdue
 * deadlines is telling the household something untrue. Random mode is
 * supported by the component and reachable through the API; this screen is
 * not the place for it.
 *
 * And deliberately no caption. An earlier version put a sentence beside
 * the face restating the day — which a Playwright run caught sitting
 * directly above the page's own empty state saying the same thing twice.
 * It was redundant by construction: the face carries no information that
 * is not already on the page in words, because every item it reacts to is
 * listed below it with its date. That makes it an ambient cue with an
 * accessible name rather than a sole carrier of meaning, which is what
 * WCAG 1.4.1 actually asks.
 */
export function TodayFace(props: TodayFaceProps) {
  return (
    <AIFaceProvider initial={{ mode: "auto", state: "neutral" }}>
      <TodayFaceInner {...props} />
    </AIFaceProvider>
  );
}

function TodayFaceInner({ overdueCount, quiet }: TodayFaceProps) {
  const { setAiFace } = useAIFace();

  const state: AIFaceState = overdueCount > 0 ? "alert" : quiet ? "happy" : "focused";

  useEffect(() => {
    setAiFace({ state });
  }, [setAiFace, state]);

  return (
    <div className={styles.wrap}>
      {/*
        A sizing wrapper rather than a class on the face itself: RobotFace's
        own root sets `width: 100%`, and a second width rule on the same
        element would be decided by CSS Module ordering rather than by
        intent.
      */}
      <div className={styles.face}>
        {/* Mirrors the breakpoints in todayFace.module.css. */}
        <AIFace sizes="(max-width: 400px) 96px, (max-width: 720px) 108px, 132px" />
      </div>
    </div>
  );
}
