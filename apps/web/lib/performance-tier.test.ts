import { describe, expect, it } from 'vitest';

import type { UiPreferences } from './types';

import { resolveRuntimeTier } from './performance-tier';

const preferences: UiPreferences = {
  motionLevel: 'auto',
  soundEnabled: true,
  hapticsEnabled: true,
  masterVolume: 0.7,
};

describe('runtime motion tier', () => {
  it('always honors the operating-system reduced-motion preference', () => {
    expect(resolveRuntimeTier({ ...preferences, motionLevel: 'high' }, 'high', true)).toBe('low');
  });

  it('allows explicit tiers when reduced motion is not requested', () => {
    expect(resolveRuntimeTier({ ...preferences, motionLevel: 'high' }, 'medium', false)).toBe(
      'high',
    );
    expect(resolveRuntimeTier(preferences, 'medium', false)).toBe('medium');
  });
});
