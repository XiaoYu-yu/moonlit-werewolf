import { describe, expect, it } from 'vitest';

import {
  countRevealedRoles,
  publicGameEventDescription,
  resultPresentation,
} from './game-result-view';

describe('resultPresentation', () => {
  it('keeps a live result neutral until the winner is authoritative', () => {
    expect(resultPresentation(undefined)).toEqual({
      description: '正在等待服务器确认胜利阵营',
      ready: false,
      title: '结果同步中',
    });
  });

  it('uses an explicit winner instead of treating every non-wolf value as good', () => {
    expect(resultPresentation('good').title).toBe('好人阵营胜利');
    expect(resultPresentation('werewolves').title).toBe('狼人阵营胜利');
  });
});

describe('countRevealedRoles', () => {
  it('does not count an unrevealed role as a good player', () => {
    expect(
      countRevealedRoles([{ role: '狼人' }, { role: '村民' }, { role: '预言家' }, {}]),
    ).toEqual({ good: 2, wolf: 1 });
  });
});

describe('publicGameEventDescription', () => {
  it('maps internal event kinds to public Chinese descriptions', () => {
    expect(publicGameEventDescription('vote.resolved')).toBe('放逐投票结算完成');
    expect(publicGameEventDescription('internal.future_event')).toBe('公开事件已记录');
  });
});
