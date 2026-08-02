import type { LiveRoomState } from './live-api';

export type DaySurface = 'discussion' | 'voting' | 'last-words' | 'dawn' | 'hunter-shot';

export function daySurfaceForPhase(phase: LiveRoomState['phase'] | undefined): DaySurface {
  if (phase === 'voting') return 'voting';
  if (phase === 'last_words') return 'last-words';
  if (phase === 'dawn' || phase === 'resolution') return 'dawn';
  if (phase === 'hunter_shot') return 'hunter-shot';
  return 'discussion';
}
