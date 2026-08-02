import type { RuntimePerformanceTier, UiPreferences } from './types';

export function resolveRuntimeTier(
  preferences: UiPreferences,
  detected: RuntimePerformanceTier,
  prefersReducedMotion: boolean,
): RuntimePerformanceTier {
  if (prefersReducedMotion) return 'low';
  return preferences.motionLevel === 'auto' ? detected : preferences.motionLevel;
}
