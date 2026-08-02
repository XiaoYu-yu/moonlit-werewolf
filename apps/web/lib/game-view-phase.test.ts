import { describe, expect, it } from 'vitest';

import { daySurfaceForPhase } from './game-view-phase';

describe('daySurfaceForPhase', () => {
  it.each([
    ['voting', 'voting'],
    ['last_words', 'last-words'],
    ['dawn', 'dawn'],
    ['resolution', 'dawn'],
    ['hunter_shot', 'hunter-shot'],
    ['discussion', 'discussion'],
  ] as const)('maps %s to the actionable %s surface', (phase, expected) => {
    expect(daySurfaceForPhase(phase)).toBe(expected);
  });
});
