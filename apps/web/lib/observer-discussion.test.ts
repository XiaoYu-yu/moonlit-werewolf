import type { PublicChatMessage } from '@werewolf/contracts';
import { describe, expect, it } from 'vitest';

import type { LiveGameEvent } from './live-api';
import { buildObserverDiscussion } from './observer-discussion';

function speech(id: string, overrides: Partial<PublicChatMessage> = {}): PublicChatMessage {
  return {
    id,
    type: 'chat.message',
    actorId: 'seat-1',
    seatNumber: 1,
    nickname: '一号玩家',
    message: '先听完整轮发言。',
    at: 100,
    round: 1,
    phase: 'discussion',
    ...overrides,
  };
}

describe('observer discussion timeline', () => {
  it('deduplicates snapshot and realtime copies and restores chronological order', () => {
    const history = [
      speech('later', { at: 300, actorId: 'seat-2', seatNumber: 2, nickname: '二号玩家' }),
      speech('first', { at: 100 }),
    ];
    const events: LiveGameEvent[] = [
      { ...speech('later', { at: 300, message: '实时事件中的权威版本。' }) },
      { ...speech('middle', { at: 200, actorId: 'seat-3', seatNumber: 3, nickname: '三号玩家' }) },
    ];

    const timeline = buildObserverDiscussion(history, events);
    const speeches = timeline.filter((item) => item.kind === 'speech');

    expect(speeches.map((item) => item.id)).toEqual(['first', 'middle', 'later']);
    expect(speeches.at(-1)?.message).toBe('实时事件中的权威版本。');
    expect(timeline.filter((item) => item.kind === 'round')).toHaveLength(1);
  });

  it('adds a stable round divider and preserves short and long speech without truncation', () => {
    const longSpeech = `我的判断如下：${'需要结合前置位发言、投票方向与夜间结果继续分析。'.repeat(45)}`;
    const timeline = buildObserverDiscussion(
      [
        speech('short', { message: '过。' }),
        speech('long', {
          actorId: 'seat-2',
          seatNumber: 2,
          nickname: '二号玩家',
          message: longSpeech,
          at: 200,
        }),
        speech('round-two', { round: 2, at: 300 }),
      ],
      [],
    );

    expect(timeline.find((item) => item.kind === 'speech' && item.id === 'short')).toMatchObject({
      message: '过。',
      ordinal: 1,
    });
    expect(timeline.find((item) => item.kind === 'speech' && item.id === 'long')).toMatchObject({
      message: longSpeech,
      ordinal: 2,
    });
    expect(timeline.filter((item) => item.kind === 'round').map((item) => item.round)).toEqual([
      1, 2,
    ]);
  });

  it('keeps repeated messages from one speaker at the same speaking ordinal', () => {
    const timeline = buildObserverDiscussion(
      [
        speech('part-one'),
        speech('part-two', { at: 200, message: '补充一点。' }),
        speech('next', {
          at: 300,
          actorId: 'seat-2',
          seatNumber: 2,
          nickname: '二号玩家',
        }),
      ],
      [],
    );
    const speeches = timeline.filter((item) => item.kind === 'speech');

    expect(speeches.map((item) => item.ordinal)).toEqual([1, 1, 2]);
  });

  it('ignores unrelated lifecycle events and malformed chat payloads', () => {
    const timeline = buildObserverDiscussion(
      [],
      [
        { type: 'phase.changed', message: '不应进入公开发言' },
        { type: 'ai.action', actorId: 'seat-1', message: '' },
      ],
      3,
    );

    expect(timeline).toEqual([]);
  });
});
