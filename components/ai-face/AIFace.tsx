"use client";

import { useTranslations } from "next-intl";
import { useRandomState, useShouldAnimate } from "./controllers";
import { resolveDisplayState, useAIFace } from "./AIFaceProvider";
import { RobotFace } from "./RobotFace";

/**
 * The assistant, as the application places it.
 *
 * Reads the controller, runs the random walk when the mode calls for one,
 * and hands a single resolved state to the renderer. This is the only
 * component the rest of the application mounts — everything else in this
 * directory is reached through it or through `useAIFace()`.
 */
export interface AIFaceProps {
  /** Rendered width, in `sizes` format, for picking an artwork variant. */
  sizes?: string;
  /** Load eagerly at high priority — for a placement that is the hero. */
  priority?: boolean;
  className?: string;
}

export function AIFace({ sizes, priority, className }: AIFaceProps) {
  const { controller, randomSettings } = useAIFace();
  const animate = useShouldAnimate();
  const t = useTranslations("aiFace");

  // The walk only ticks in random mode; in the other two it costs a timer
  // that is never scheduled.
  const randomState = useRandomState(animate && controller.mode === "random", randomSettings);

  const state = resolveDisplayState(controller, randomState);

  return (
    <RobotFace
      state={state}
      speaking={controller.speaking}
      lipSyncLevel={controller.lipSyncLevel}
      /*
       * Not `AI_FACE_STATES[state].description`.
       *
       * That field is the package's own English copy and it stays on the
       * contract untouched, but it is developer-facing — putting it in an
       * `aria-label` would read English at a German household, which
       * CLAUDE.md §14 forbids and the parity test cannot see.
       */
      label={t(`state.${state}`)}
      sizes={sizes}
      priority={priority}
      className={className}
    />
  );
}
