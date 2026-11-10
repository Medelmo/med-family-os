'use client';
// EL MOUDDENE FAMILIE brand intro - source: medfamily-brand-system/integrations/web-pwa (template v1.0.0)
// Do not edit in the app repository; change the template and re-sync.
//
// Full-screen cinematic intro for React / Next.js apps. Bundled with the app (no external script, so a strict
// nonce-based Content-Security-Policy is unaffected). The MP4 is served from the app's own origin:
//   public/brand/<slug>.mp4
// Plays once per browser session, muted, skippable (button, click, Esc/Enter/Space); any failure removes it.
import { useEffect, useRef, useState } from 'react';
import { shouldPlayWebIntro, skipLabel } from './family-intro-policy';

const KEY_PREFIX = 'family-intro:';
const WATCHDOG_MS = 6500;
const NAVY = '#081426';

export function FamilyIntro({ slug, src }: { slug: string; src?: string }) {
  const [active, setActive] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const skipRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let storageOk = true;
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY_PREFIX + slug) === '1';
    } catch {
      storageOk = false;
    }
    const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
    const play = shouldPlayWebIntro({
      seen,
      storageOk,
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
      saveData: nav.connection?.saveData === true,
      automated: nav.webdriver === true,
    });
    if (!play) return;
    // Start on the next frame (not synchronously inside the effect); mark the session only when it really starts,
    // so React StrictMode's double effect run in development cannot swallow the intro.
    const raf = window.requestAnimationFrame(() => {
      try {
        sessionStorage.setItem(KEY_PREFIX + slug, '1');
      } catch {
        return;
      }
      setActive(true);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [slug]);

  useEffect(() => {
    if (!active) return;
    const previous = document.activeElement as HTMLElement | null;
    skipRef.current?.focus();
    const done = () => setLeaving(true);
    const timer = window.setTimeout(done, WATCHDOG_MS);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        done();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [active]);

  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setActive(false), 250);
    return () => window.clearTimeout(t);
  }, [leaving]);

  if (!active) return null;
  const done = () => setLeaving(true);
  return (
    <div
      role="presentation"
      onClick={done}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        background: NAVY,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: leaving ? 0 : 1,
        transition: 'opacity 250ms ease',
      }}
    >
      <video
        src={src ?? `/brand/${slug}.mp4`}
        autoPlay
        muted
        playsInline
        preload="auto"
        aria-hidden="true"
        onEnded={done}
        onError={done}
        style={{ width: '100%', height: '100%', objectFit: 'contain', background: NAVY }}
      />
      <button
        ref={skipRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          done();
        }}
        style={{
          position: 'absolute',
          bottom: 'max(32px, env(safe-area-inset-bottom))',
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '10px 22px',
          borderRadius: 28,
          border: '1px solid #4A9DFF',
          background: 'rgba(8,20,38,0.6)',
          color: '#fff',
          font: '500 15px system-ui, sans-serif',
          cursor: 'pointer',
        }}
      >
        {skipLabel(navigator.language)}
      </button>
    </div>
  );
}
