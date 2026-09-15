"use client";

import styles from "./Android.module.css";

export type AndroidState = "idle" | "speaking";

export interface AndroidProps {
  state: AndroidState;
  /** Announced to screen readers; the visual is decorative on its own. */
  label: string;
  className?: string;
}

/**
 * The household assistant (ADR-026).
 *
 * Drawn here rather than sourced. Every part that has to move on its own
 * — each eyelid, each band of the vocal grille, the chest core, the live
 * traces — is its own element, because the alternative is one image and a
 * face that can only fade.
 *
 * **What it is not.** It has no opinion, no intelligence behind it and no
 * access to anything: it is a greeting and a status light. CLAUDE.md §11
 * keeps AI advisory and human-confirmed, and a face that looked like it
 * was thinking about a household's medical records while having no part
 * in them would be a lie told in pixels. When Phase 8 gives it something
 * real to say, it will say it through the same mouth.
 *
 * Scales with its container: everything is a viewBox unit, so one
 * component serves the full-screen welcome and any smaller placement
 * later without a second set of numbers.
 */
export function Android({ state, label, className }: AndroidProps) {
  return (
    <svg
      viewBox="0 0 460 520"
      role="img"
      aria-label={label}
      className={[styles.android, state === "speaking" ? styles.speaking : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <defs>
        <filter id="mfos-soften" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <clipPath id="mfos-headclip">
          <path d="M230 44 C306 44 356 92 360 170 C363 226 356 262 347 294 C338 327 320 360 296 384 C277 403 254 414 230 414 C206 414 183 403 164 384 C140 360 122 327 113 294 C104 262 97 226 100 170 C104 92 154 44 230 44 Z" />
        </clipPath>
        <linearGradient id="mfos-sheen" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.10" />
          <stop offset="55%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      <g className={styles.bust}>
        {/* shoulders and chest armour */}
        <path
          className={styles.plate}
          d="M96 520 C100 470 128 446 172 438 L230 430 L288 438 C332 446 360 470 364 520 Z"
        />
        <path className={styles.seam} d="M172 438 C200 462 260 462 288 438" />
        <path
          className={styles.plateLit}
          d="M196 520 C198 482 210 468 230 464 C250 468 262 482 264 520 Z"
        />
        {/* the chest core — the same mark that sits in the top bar */}
        <circle className={styles.core} cx="230" cy="486" r="7" />
        <circle className={styles.coreGlow} cx="230" cy="486" r="14" />
        <path className={styles.traceLive} d="M150 470 L150 500 M310 470 L310 500" />

        {/* neck column */}
        <path className={styles.plate} d="M198 392 L262 392 L268 442 L192 442 Z" />
        <path className={styles.seam} d="M204 404 H256 M202 418 H258 M200 430 H260" />

        {/* head shell */}
        <path
          className={styles.plate}
          d="M230 44 C306 44 356 92 360 170 C363 226 356 262 347 294 C338 327 320 360 296 384 C277 403 254 414 230 414 C206 414 183 403 164 384 C140 360 122 327 113 294 C104 262 97 226 100 170 C104 92 154 44 230 44 Z"
        />

        <g clipPath="url(#mfos-headclip)">
          {/* cranial circuitry */}
          <rect className={styles.plateLit} x="150" y="44" width="160" height="96" rx="6" />
          <path className={styles.seam} d="M150 78 H310 M150 108 H310 M186 44 V140 M230 44 V140 M274 44 V140" />
          <rect className={styles.coreBar} x="216" y="56" width="28" height="70" rx="4" />
          <path className={styles.traceLive} d="M160 62 H180 M160 92 H176 M284 62 H300 M290 92 H304" />
          <circle className={styles.node} cx="168" cy="122" r="3" />
          <circle className={styles.node2} cx="292" cy="122" r="3" />

          {/* temple panels */}
          <path className={styles.plateLit} d="M100 150 L138 158 L138 250 L104 240 Z" />
          <path className={styles.plateLit} d="M360 150 L322 158 L322 250 L356 240 Z" />
          <path className={styles.trace} d="M112 172 H130 M112 192 H126 M112 212 H130" />
          <path className={styles.trace} d="M348 172 H330 M348 192 H334 M348 212 H330" />

          {/* cheek traces */}
          <path
            className={styles.traceDim}
            d="M148 268 C170 292 176 320 172 350 M312 268 C290 292 284 320 288 350"
          />
          <path className={styles.traceDim} d="M158 300 H196 M302 300 H264" />

          {/* jaw segments */}
          <path className={styles.seam} d="M176 366 C200 392 260 392 284 366" />
          <path className={styles.seam} d="M196 386 V400 M230 394 V408 M264 386 V400" />

          <path
            d="M230 44 C306 44 356 92 360 170 L100 170 C104 92 154 44 230 44 Z"
            fill="url(#mfos-sheen)"
          />
        </g>

        {/* brow ridge */}
        <path className={styles.seam} d="M138 196 C168 182 196 182 214 192 M322 196 C292 182 264 182 246 192" />

        {/* eyes — each lid blinks on its own element */}
        <g className={styles.lid}>
          <path className={styles.plateLit} d="M146 222 C160 204 196 202 212 218 C198 240 162 242 146 222 Z" />
          <ellipse className={styles.irisGlow} cx="179" cy="221" rx="22" ry="18" />
          <ellipse className={styles.iris} cx="179" cy="221" rx="16" ry="13" />
          <ellipse className={styles.irisHot} cx="179" cy="219" rx="6" ry="5" />
        </g>
        <g className={`${styles.lid} ${styles.lidRight}`}>
          <path className={styles.plateLit} d="M314 222 C300 204 264 202 248 218 C262 240 298 242 314 222 Z" />
          <ellipse className={styles.irisGlow} cx="281" cy="221" rx="22" ry="18" />
          <ellipse className={styles.iris} cx="281" cy="221" rx="16" ry="13" />
          <ellipse className={styles.irisHot} cx="281" cy="219" rx="6" ry="5" />
        </g>

        {/* nose ridge */}
        <path className={styles.seam} d="M230 232 V282 M216 292 C222 298 238 298 244 292" />

        {/* the vocal grille — bands driven by the speech, not by a guess */}
        <rect className={styles.plateLit} x="184" y="312" width="92" height="38" rx="5" />
        <g>
          <rect className={styles.vox} x="194" y="318" width="6" height="26" rx="3" style={{ animationDelay: "0ms" }} />
          <rect className={styles.vox} x="206" y="318" width="6" height="26" rx="3" style={{ animationDelay: "60ms" }} />
          <rect className={styles.vox} x="218" y="318" width="6" height="26" rx="3" style={{ animationDelay: "140ms" }} />
          <rect className={styles.vox} x="230" y="318" width="6" height="26" rx="3" style={{ animationDelay: "30ms" }} />
          <rect className={styles.vox} x="242" y="318" width="6" height="26" rx="3" style={{ animationDelay: "170ms" }} />
          <rect className={styles.vox} x="254" y="318" width="6" height="26" rx="3" style={{ animationDelay: "95ms" }} />
          <rect className={styles.vox} x="266" y="318" width="6" height="26" rx="3" style={{ animationDelay: "210ms" }} />
        </g>

        {/* audio units */}
        <path className={styles.plateLit} d="M92 214 L112 208 L116 272 L96 278 Z" />
        <path className={styles.plateLit} d="M368 214 L348 208 L344 272 L364 278 Z" />
        <circle className={styles.node} cx="104" cy="242" r="3.5" />
        <circle className={styles.node} cx="356" cy="242" r="3.5" />
      </g>
    </svg>
  );
}
