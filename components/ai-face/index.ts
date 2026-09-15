/**
 * The AI face, as the rest of the application sees it.
 *
 * Everything below is reached through this barrel so the internals —
 * controllers, renderer, artwork path — can change without a search and
 * replace across the app.
 *
 * Origin: `ai-family-robot-face.zip`. The artwork
 * (`public/assets/robot-guardian.png`), the SVG overlay geometry and the
 * eighteen state parameters are the supplied package's and are not
 * reinterpreted; see RobotFace.tsx and robotStates.ts for what was adapted
 * and why.
 */
export { AIFace } from "./AIFace";
export type { AIFaceProps } from "./AIFace";
export { AIFaceProvider, useAIFace, resolveDisplayState } from "./AIFaceProvider";
export type { AIFaceController, AIFaceUpdate, AIFaceContextValue } from "./AIFaceProvider";
export { RobotFace } from "./RobotFace";
export type { RobotFaceProps } from "./RobotFace";
export {
  AI_FACE_STATES,
  DEFAULT_RANDOM_SETTINGS,
  pickRandomState,
  randomDuration,
  resolveAutoState,
} from "./robotStates";
export type { AIFaceState, AIFaceMode, AIFaceStateConfig, RandomSettings } from "./robotStates";
