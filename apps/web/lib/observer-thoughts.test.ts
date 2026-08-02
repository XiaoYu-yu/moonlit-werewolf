import { describe, expect, it } from 'vitest';

import {
  MAX_RENDERED_OBSERVER_THOUGHTS,
  normalizeActiveAiDecision,
  normalizeAiLifecycleStatus,
  normalizeObserverPrivateStateForRoom,
  normalizeObserverThoughtHistory,
  observerThoughtsForActor,
  OBSERVER_FALLBACK_GUIDANCE,
} from './observer-thoughts';

function thought(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    turnId: `turn-${id}`,
    actorId: 'seat-2',
    seatNumber: 2,
    nickname: '二号玩家',
    providerId: 'kimi',
    modelId: 'kimi-k2.6',
    phase: 'discussion',
    round: 2,
    content: '我会先核对公开发言，再给出本轮选择。',
    source: 'provider',
    timestamp: 1_721_234_567_890,
    actionType: 'speak',
    ...overrides,
  };
}

function observerState(overrides: Record<string, unknown> = {}) {
  return {
    connected: true,
    isObserver: true,
    roomId: 'room-1',
    gameId: 'game-1',
    mode: 'ai_observer',
    round: 2,
    phase: 'discussion',
    phaseId: 'discussion-2',
    currentActorIds: ['seat-2'],
    aiThoughtHistory: [],
    roles: [],
    actions: [],
    chatHistory: [],
    ...overrides,
  };
}

describe('observer thought runtime adapters', () => {
  it('accepts observer-private state only when observer mode, room and game all correlate', () => {
    const correlation = {
      roomId: 'room-1',
      gameId: 'game-1',
      roomMode: 'ai_observer' as const,
    };

    expect(normalizeObserverPrivateStateForRoom(observerState(), correlation)).toMatchObject({
      isObserver: true,
      mode: 'ai_observer',
      roomId: 'room-1',
      gameId: 'game-1',
    });
    expect(
      normalizeObserverPrivateStateForRoom(observerState({ isObserver: false }), correlation),
    ).toBeUndefined();
    expect(
      normalizeObserverPrivateStateForRoom(observerState({ mode: 'standard' }), correlation),
    ).toBeUndefined();
    expect(
      normalizeObserverPrivateStateForRoom(observerState({ roomId: 'room-2' }), correlation),
    ).toBeUndefined();
    expect(
      normalizeObserverPrivateStateForRoom(observerState({ gameId: 'game-2' }), correlation),
    ).toBeUndefined();
    expect(
      normalizeObserverPrivateStateForRoom(observerState(), {
        ...correlation,
        roomMode: 'standard',
      }),
    ).toBeUndefined();
  });

  it('describes fallback as a general model failure instead of assuming only a missing key', () => {
    expect(OBSERVER_FALLBACK_GUIDANCE).toContain('额度耗尽');
    expect(OBSERVER_FALLBACK_GUIDANCE).toContain('请求超时');
    expect(OBSERVER_FALLBACK_GUIDANCE).toContain('供应商错误');
    expect(OBSERVER_FALLBACK_GUIDANCE).toContain('返回格式与行动不合法');
    expect(OBSERVER_FALLBACK_GUIDANCE).not.toContain('请先配置');
  });

  it('accepts lifecycle metadata but deliberately omits any status summary text', () => {
    const status = normalizeAiLifecycleStatus({
      roomId: 'room-1',
      actorId: 'seat-2',
      seatNumber: 2,
      phase: 'discussion',
      round: 2,
      status: 'thinking',
      source: 'provider',
      actionType: 'finish_speech',
      summary: '不应从实时状态渲染这段文字',
    });

    expect(status).toEqual({
      roomId: 'room-1',
      actorId: 'seat-2',
      seatNumber: 2,
      phase: 'discussion',
      round: 2,
      status: 'thinking',
      source: 'provider',
      actionType: 'finish_speech',
    });
    expect(status).not.toHaveProperty('summary');
  });

  it('normalizes the snapshot-authoritative active decision without summary text', () => {
    const activeDecision = normalizeActiveAiDecision({
      turnId: 'turn-7',
      actorId: 'seat-3',
      seatNumber: 3,
      nickname: '三号玩家',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      phase: 'voting',
      round: 2,
      actionType: 'vote',
      status: 'summary_ready',
      source: 'provider',
      startedAt: 1_721_234_560_000,
      updatedAt: 1_721_234_567_000,
      summaryReadyAt: 1_721_234_567_000,
      applyAt: 1_721_234_570_000,
      summary: 'activeDecision 也不能承载可见正文',
    });

    expect(activeDecision).toMatchObject({
      turnId: 'turn-7',
      actorId: 'seat-3',
      actionType: 'vote',
      status: 'summary_ready',
      source: 'provider',
    });
    expect(activeDecision).not.toHaveProperty('summary');
  });

  it('rejects malformed lifecycle payloads instead of inventing a thinker', () => {
    expect(
      normalizeAiLifecycleStatus({
        roomId: 'room-1',
        actorId: 'seat-2',
        seatNumber: 2,
        phase: 'not-a-phase',
        round: 2,
        status: 'thinking',
        source: 'provider',
      }),
    ).toBeUndefined();
  });

  it('deduplicates, sanitizes and bounds observer-private summaries', () => {
    const inputs = Array.from({ length: MAX_RENDERED_OBSERVER_THOUGHTS + 4 }, (_, index) =>
      thought(`thought-${index}`, { timestamp: 1_721_234_567_890 + index }),
    );
    inputs.push(thought('thought-33', { content: `更新后的摘要${'。'.repeat(650)}` }));
    inputs.push(thought('broken', { content: '', source: 'provider' }));

    const normalized = normalizeObserverThoughtHistory(inputs);

    expect(normalized).toHaveLength(MAX_RENDERED_OBSERVER_THOUGHTS);
    expect(normalized[0]?.id).toBe('thought-4');
    expect(normalized.at(-1)?.id).toBe('thought-83');
    expect(normalized.find((item) => item.id === 'thought-33')?.content).toHaveLength(600);
  });

  it('preserves truthful provider and fallback provenance', () => {
    const normalized = normalizeObserverThoughtHistory([
      thought('provider'),
      thought('fallback', {
        providerId: 'deepseek',
        modelId: 'deepseek-v4-flash',
        source: 'fallback',
        content: '模型不可用，本次使用确定性合法动作。',
      }),
    ]);

    expect(normalized.map((item) => item.source)).toEqual(['provider', 'fallback']);
  });

  it('preserves bounded provider-authored visible analysis separately from the short conclusion', () => {
    const normalized = normalizeObserverThoughtHistory([
      thought('analysis', {
        content: '最终选择观察二号。',
        visibleAnalysis: `公开局势分析：${'结合前置位发言与投票方向。'.repeat(180)}`,
      }),
    ]);

    expect(normalized[0]?.content).toBe('最终选择观察二号。');
    expect(normalized[0]?.visibleAnalysis?.startsWith('公开局势分析：')).toBe(true);
    expect(normalized[0]?.visibleAnalysis).toHaveLength(1_200);
  });

  it('accepts only speak, vote and night summaries so role acknowledgements stay out', () => {
    const normalized = normalizeObserverThoughtHistory([
      thought('role-ack', { actionType: 'acknowledge_role' }),
      thought('speech', { actionType: 'speak' }),
      thought('vote', { actionType: 'vote' }),
      thought('night', { actionType: 'night' }),
    ]);

    expect(normalized.map((item) => item.id)).toEqual(['speech', 'vote', 'night']);
  });

  it('selects one AI history in chronological order without mixing other seats', () => {
    const normalized = normalizeObserverThoughtHistory([
      thought('late', { timestamp: 300 }),
      thought('other-seat', { actorId: 'seat-4', seatNumber: 4, timestamp: 100 }),
      thought('early', { timestamp: 200 }),
    ]);

    expect(observerThoughtsForActor(normalized, 'seat-2').map((item) => item.id)).toEqual([
      'early',
      'late',
    ]);
  });
});
