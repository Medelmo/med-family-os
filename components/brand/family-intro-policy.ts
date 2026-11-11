// EL MOUDDENE FAMILIE brand intro - source: medfamily-brand-system/integrations/web-pwa (template v1.0.0)
// Do not edit in the app repository; change the template and re-sync.

/** Pure decision logic for the web intro (no DOM access, unit-testable). */
export interface WebIntroInputs {
  /** The intro already played in this browser session (sessionStorage flag). */
  seen: boolean;
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean;
  /** Data Saver (navigator.connection.saveData) */
  saveData: boolean;
  /** Automated browser (navigator.webdriver): e2e tests must not be blocked by an overlay. */
  automated: boolean;
  /** Storage is usable (private mode / blocked storage => skip rather than replay on every page). */
  storageOk: boolean;
}

export function shouldPlayWebIntro(i: WebIntroInputs): boolean {
  return i.storageOk && !i.seen && !i.reducedMotion && !i.saveData && !i.automated;
}

export function skipLabel(language: string): string {
  const l = (language || 'en').toLowerCase();
  if (l.startsWith('de')) return 'Überspringen';
  if (l.startsWith('ar')) return 'تخطي';
  return 'Skip';
}
