import { describe, expect, it } from 'vitest';

import { shouldPlayWebIntro, skipLabel } from '../../../components/brand/family-intro-policy';

const base = { seen: false, reducedMotion: false, saveData: false, automated: false, storageOk: true };

describe('web brand intro policy', () => {
  it('plays on the first visit of a session', () => expect(shouldPlayWebIntro(base)).toBe(true));
  it('does not replay in the same session', () => expect(shouldPlayWebIntro({ ...base, seen: true })).toBe(false));
  it('respects reduced motion', () => expect(shouldPlayWebIntro({ ...base, reducedMotion: true })).toBe(false));
  it('respects data saver', () => expect(shouldPlayWebIntro({ ...base, saveData: true })).toBe(false));
  it('never blocks automated browsers', () => expect(shouldPlayWebIntro({ ...base, automated: true })).toBe(false));
  it('skips when storage is unavailable', () => expect(shouldPlayWebIntro({ ...base, storageOk: false })).toBe(false));
  it('localises the skip label', () => {
    expect(skipLabel('de-DE')).toBe('Überspringen');
    expect(skipLabel('ar')).toBe('تخطي');
    expect(skipLabel('en-US')).toBe('Skip');
  });
});
