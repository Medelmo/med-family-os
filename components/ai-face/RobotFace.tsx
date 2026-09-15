"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { AI_FACE_STATES, type AIFaceState } from "./robotStates";
import { useBlink, useGlance, useLipSync, useShouldAnimate } from "./controllers";
import styles from "./RobotFace.module.css";

/**
 * The Cyber Guardian face — the visual renderer, and nothing else.
 *
 * The artwork and the SVG overlay geometry come from
 * `ai-family-robot-face/src/components/RobotFace.tsx` and are reproduced
 * here unchanged: every `cx`, `cy` and path in the overlay is calibrated
 * against `robot-guardian.png`, so moving an eye by ten units puts the
 * glow on a cheekbone. The package's own notes are explicit that the
 * character must not be redrawn, and it is not.
 *
 * What changed is everything around it, and only to fit this application:
 * global CSS became a CSS Module (ADR-011 — no global class names), and
 * the timing logic moved into `controllers.ts` so this file renders and
 * does not schedule.
 *
 * It takes a resolved state. Mode arbitration, priority and the random
 * walk all happen in `AIFaceProvider`, so this component can be dropped
 * anywhere — including a test — with a single prop.
 */

export interface RobotFaceProps {
  state: AIFaceState;
  speaking?: boolean;
  /** 0 = closed, 1 = fully open. Omit for procedural mouth movement. */
  lipSyncLevel?: number;
  /** Announced to assistive technology. The visual is decorative. */
  label: string;
  /**
   * The rendered width, for `srcset` selection — a media-condition list in
   * the `sizes` format. The default suits a small in-page placement; the
   * welcome hero passes its own.
   */
  sizes?: string;
  /** The welcome screen's face is the thing being waited for; Today's is not. */
  priority?: boolean;
  className?: string;
}

/** Restlessness per state — see `useGlance`. */
const GLANCE_AMPLITUDE: Partial<Record<AIFaceState, number>> = {
  focused: 0.25,
  listening: 0.4,
  sleepy: 0.3,
  angry: 0.5,
  confused: 1.8,
  worried: 1.7,
  curious: 1.6,
  thinking: 1.4,
  surprised: 0.6,
};

/** Blink timing per state. Sleepy blinks rarely and slowly. */
const BLINK_TIMING: Partial<Record<AIFaceState, { interval: number; duration: number }>> = {
  sleepy: { interval: 0.55, duration: 3.2 },
  surprised: { interval: 2.4, duration: 0.6 },
  alert: { interval: 1.8, duration: 0.7 },
  error: { interval: 1.6, duration: 0.8 },
  focused: { interval: 1.5, duration: 0.9 },
  excited: { interval: 0.7, duration: 0.8 },
};

export function RobotFace({
  state,
  speaking = false,
  lipSyncLevel,
  label,
  sizes = "140px",
  priority = false,
  className,
}: RobotFaceProps) {
  const config = AI_FACE_STATES[state];
  const animate = useShouldAnimate();

  const timing = BLINK_TIMING[state];
  const blinking = useBlink(animate, {
    intervalScale: timing?.interval ?? 1,
    durationScale: timing?.duration ?? 1,
  });

  const glance = useGlance(animate, GLANCE_AMPLITUDE[state] ?? 1);
  const mouth = useLipSync(speaking, lipSyncLevel, config.mouthOpen, animate);

  /*
   * The mouth is written straight to a CSS custom property.
   *
   * Sixty frames a second of React state would re-render this subtree
   * sixty times a second for one number. Writing the variable on the root
   * element keeps a speaking face at zero re-renders, which is what makes
   * it cheap enough to sit on the home screen.
   */
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    return mouth.subscribe((value) => {
      element.style.setProperty("--mouth-open", value.toFixed(3));
    });
  }, [mouth]);

  const vars = {
    "--eye-glow": config.eyeGlow,
    "--lid": config.lid,
    "--brow": config.browTilt,
    "--mouth-curve": config.mouthCurve,
    "--mouth-open": config.mouthOpen,
    "--mouth-width": config.mouthWidth,
    "--head-tilt": `${config.headTilt}deg`,
    "--head-lift": `${config.headLift}px`,
    "--scan-speed": `${config.scanSpeed}s`,
    "--pulse": config.pulse,
    "--glance-x": `${glance.x}px`,
    "--glance-y": `${glance.y}px`,
  } as CSSProperties;

  const classes = [
    styles.face,
    styles[`state_${state}` as keyof typeof styles],
    blinking ? styles.blinking : "",
    speaking ? styles.speaking : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={rootRef} className={classes} style={vars} role="img" aria-label={label}>
      {/*
        The artwork.

        `alt=""` because the wrapper carries the accessible name —
        announcing the file and then the state would say it twice.

        Three widths rather than one. The supplied PNG is 1254px square and
        2.5 MB, which is right for the welcome hero and absurd for a 108px
        avatar on a screen the household opens every morning; the 384px
        variant is 0.37 MB. Plain `srcset` rather than `next/image`: the
        optimiser needs `sharp`, which would mean a new dependency and a
        native binary in the container for a handful of static files whose
        sizes are known at build time. The variants are downscales of the
        supplied artwork — same image, fewer pixels — so this is not a
        second rendition of the character.
      */}
      {/*
        Suppressed for this element only, with the reason above: `next/image`
        would need `sharp` in the container to optimise three static files
        whose variants are already generated. The rule stays on everywhere
        else, so the next `<img>` added without thinking still gets caught.
      */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/robot-guardian.png"
        srcSet="/assets/robot-guardian-384.png 384w, /assets/robot-guardian-768.png 768w, /assets/robot-guardian.png 1254w"
        sizes={sizes}
        alt=""
        className={styles.art}
        draggable={false}
        decoding="async"
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
      />

      <div className={styles.scanlines} aria-hidden="true" />

      <div className={styles.particles} aria-hidden="true">
        {Array.from({ length: 22 }).map((_, i) => (
          <i key={i} style={{ "--i": i } as CSSProperties} />
        ))}
      </div>

      <svg className={styles.overlay} viewBox="0 0 1536 1536" role="presentation" aria-hidden="true">
        <defs>
          <filter id="mfosCyanGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="10" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="mfosSoftGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className={`${styles.eye} ${styles.eyeLeft}`}>
          <ellipse className={styles.eyeMask} cx="590" cy="606" rx="112" ry="68" />
          <ellipse className={styles.irisRing} cx="590" cy="606" rx="44" ry="32" filter="url(#mfosSoftGlow)" />
          <ellipse className={styles.irisCore} cx="590" cy="606" rx="22" ry="18" filter="url(#mfosCyanGlow)" />
          <circle className={styles.eyeSpec} cx="579" cy="596" r="7" />
          <path className={`${styles.lid} ${styles.lidTop}`} d="M478 606 Q590 520 702 606 Q590 550 478 606Z" />
          <path className={`${styles.lid} ${styles.lidBottom}`} d="M478 606 Q590 694 702 606 Q590 663 478 606Z" />
        </g>

        <g className={`${styles.eye} ${styles.eyeRight}`}>
          <ellipse className={styles.eyeMask} cx="946" cy="606" rx="112" ry="68" />
          <ellipse className={styles.irisRing} cx="946" cy="606" rx="44" ry="32" filter="url(#mfosSoftGlow)" />
          <ellipse className={styles.irisCore} cx="946" cy="606" rx="22" ry="18" filter="url(#mfosCyanGlow)" />
          <circle className={styles.eyeSpec} cx="935" cy="596" r="7" />
          <path className={`${styles.lid} ${styles.lidTop}`} d="M834 606 Q946 520 1058 606 Q946 550 834 606Z" />
          <path className={`${styles.lid} ${styles.lidBottom}`} d="M834 606 Q946 694 1058 606 Q946 663 834 606Z" />
        </g>

        <g className={styles.brows}>
          <path className={styles.browLeft} d="M486 518 Q590 470 684 520" />
          <path className={styles.browRight} d="M852 520 Q946 470 1050 518" />
        </g>

        <g className={styles.mouth}>
          <rect className={styles.mouthMask} x="540" y="742" width="456" height="132" rx="60" />
          <path className={styles.mouthLine} d="M568 805 Q768 805 968 805" />
          <path className={styles.mouthOpening} d="M572 802 Q768 802 964 802 Q944 850 768 860 Q592 850 572 802Z" />
          <path className={styles.mouthTeeth} d="M608 808 Q768 800 928 808 L910 826 Q768 836 626 826Z" />
          <circle className={`${styles.mouthEnergy} ${styles.mouthEnergyLeft}`} cx="580" cy="815" r="8" />
          <circle className={`${styles.mouthEnergy} ${styles.mouthEnergyRight}`} cx="956" cy="815" r="8" />
        </g>

        <g className={styles.chinEnergy} filter="url(#mfosSoftGlow)">
          <path d="M744 888 L792 888 L784 905 L752 905Z" />
        </g>
      </svg>
    </div>
  );
}
