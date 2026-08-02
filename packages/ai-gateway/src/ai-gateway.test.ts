import { describe, expect, it, vi } from 'vitest';
import { AiGateway } from './gateway.js';
import { CostGuard } from './cost-guard.js';
import { CostLimitExceededError } from './errors.js';
import { buildRepairMessages, parseStructuredAction } from './structured-action.js';
import { OpenAiCompatibleAdapter } from './providers/openai-compatible.js';
import { estimateChatRequestCostCents } from './pricing.js';
import { createPlayableProviderAdapter } from './playable-providers.js';
import { isAiTurnJobResult } from './queue-contracts.js';
import type { ModelProviderAdapter } from './types.js';

function provider(id: string, responses: Array<string | Error>): ModelProviderAdapter {
  return {
    id,
    kind: 'openai-compatible',
    capabilities: { jsonMode: true, streaming: false, transcription: false },
    complete: vi.fn(async () => {
      const value = responses.shift();
      if (value instanceof Error) throw value;
      return { content: value ?? '{}' };
    }),
  };
}

describe('structured actions', () => {
  it('accepts fenced JSON and rejects an unauthorized target', () => {
    expect(
      parseStructuredAction('```json\n{"type":"vote","targetSeatId":"s2"}\n```', 'vote', ['s2']),
    ).toEqual({ type: 'vote', targetSeatId: 's2' });
    expect(() =>
      parseStructuredAction('{"type":"vote","targetSeatId":"secret"}', 'vote', ['s2']),
    ).toThrow(/allowed seat/);
  });

  it('supports the witch heal form for a night action', () => {
    expect(parseStructuredAction('{"type":"night","useHeal":true}', 'night', ['s2'])).toEqual({
      type: 'night',
      useHeal: true,
    });
  });

  it.each([
    [
      'speak with a target',
      '{"type":"speak","message":"我选择二号。","targetSeatId":"s2"}',
      'speak' as const,
    ],
    [
      'speak with an active abstain flag',
      '{"type":"speak","message":"继续观察。","abstain":true}',
      'speak' as const,
    ],
    [
      'vote with both a target and abstention',
      '{"type":"vote","targetSeatId":"s2","abstain":true}',
      'vote' as const,
    ],
    ['vote with an active heal flag', '{"type":"vote","useHeal":true}', 'vote' as const],
    [
      'night with both a target and heal',
      '{"type":"night","targetSeatId":"s2","useHeal":true}',
      'night' as const,
    ],
    [
      'night with an inapplicable speech message',
      '{"type":"night","targetSeatId":"s2","message":"查验二号"}',
      'night' as const,
    ],
  ])('rejects contradictory or inapplicable controls: %s', (_label, raw, type) => {
    expect(() => parseStructuredAction(raw, type, ['s2'])).toThrow(/control fields/i);
  });

  it('accepts inactive false/null placeholders while preserving one active control', () => {
    expect(
      parseStructuredAction(
        '{"type":"speak","message":"继续观察。","targetSeatId":null,"abstain":false,"useHeal":false}',
        'speak',
      ),
    ).toEqual({ type: 'speak', message: '继续观察。' });
    expect(
      parseStructuredAction(
        '{"type":"vote","message":null,"targetSeatId":"s2","abstain":false,"useHeal":false}',
        'vote',
        ['s2'],
      ),
    ).toEqual({ type: 'vote', targetSeatId: 's2' });
    expect(
      parseStructuredAction(
        '{"type":"night","message":null,"targetSeatId":null,"abstain":false,"useHeal":true}',
        'night',
        ['s2'],
      ),
    ).toEqual({ type: 'night', useHeal: true });
  });

  it.each([
    '{"type":"vote","targetSeatId":"s2","targetId":"s3"}',
    '{"type":"night","targetSeatId":"s2","poisonTargetId":"s3"}',
  ])('rejects unknown fields instead of silently changing their meaning', (raw) => {
    expect(() =>
      parseStructuredAction(raw, raw.includes('"vote"') ? 'vote' : 'night', ['s2']),
    ).toThrow(/unknown fields/i);
  });

  it('rejects unknown action fields at the worker result boundary', () => {
    expect(
      isAiTurnJobResult(
        {
          action: { type: 'vote', targetSeatId: 's2', targetId: 's3' },
          attempts: 0,
          usedFallback: true,
          failureReasons: [],
        },
        'vote',
        ['s2'],
      ),
    ).toBe(false);
  });

  it.each([{ hidden: 'x' }, null, '记'.repeat(1_001)])(
    'rejects an invalid memory summary at the worker result boundary',
    (memorySummary) => {
      expect(
        isAiTurnJobResult(
          {
            action: { type: 'vote', targetSeatId: 's2', memorySummary },
            attempts: 0,
            usedFallback: true,
            failureReasons: [],
          },
          'vote',
          ['s2'],
        ),
      ).toBe(false);
    },
  );

  it('repairs against the original role-specific instruction without broadening night modes', () => {
    const messages = buildRepairMessages(
      [
        {
          role: 'user',
          content: JSON.stringify({
            instruction:
              '这是预言家查验：唯一格式为 {"type":"night","targetSeatId":"s2"}。预言家不得弃权。',
          }),
        },
      ],
      '{"type":"night","abstain":true}',
      'night',
      ['s2'],
      true,
      true,
    );
    const repair = messages.at(-1)?.content ?? '';
    expect(repair).toContain('最初用户消息中 instruction');
    expect(repair).toContain('["s2"]');
    expect(repair).not.toContain('abstain=true');
    expect(repair).not.toContain('useHeal=true');
    expect(repair).toContain('visibleAnalysis');
    expect(repair).toContain('不是隐藏思维链');
  });

  it('bounds a provider-authored decision summary and can require it', () => {
    const action = parseStructuredAction(
      JSON.stringify({
        type: 'vote',
        targetSeatId: 's2',
        decisionSummary: `  ${'判断'.repeat(400)}  `,
      }),
      'vote',
      ['s2'],
      true,
    );
    expect(action.decisionSummary).toHaveLength(600);
    expect(action.decisionSummary?.startsWith('判断')).toBe(true);
    expect(() =>
      parseStructuredAction('{"type":"vote","targetSeatId":"s2"}', 'vote', ['s2'], true),
    ).toThrow(/decisionSummary/);
  });

  it('bounds provider-authored visible analysis and can require it independently', () => {
    const action = parseStructuredAction(
      JSON.stringify({
        type: 'vote',
        targetSeatId: 's2',
        visibleAnalysis: `  ${'分析'.repeat(800)}  `,
      }),
      'vote',
      ['s2'],
      false,
      true,
    );
    expect(action.visibleAnalysis).toHaveLength(1_200);
    expect(action.visibleAnalysis?.startsWith('分析')).toBe(true);
    expect(() =>
      parseStructuredAction('{"type":"vote","targetSeatId":"s2"}', 'vote', ['s2'], false, true),
    ).toThrow(/visibleAnalysis/);
  });

  it('rejects missing or oversized summaries at the worker result boundary', () => {
    const base = {
      action: { type: 'vote' as const, targetSeatId: 's2' },
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
    };
    expect(isAiTurnJobResult(base, 'vote', ['s2'], true)).toBe(false);
    expect(
      isAiTurnJobResult(
        {
          ...base,
          action: { ...base.action, decisionSummary: '判'.repeat(601) },
        },
        'vote',
        ['s2'],
        true,
      ),
    ).toBe(false);
  });

  it('rejects missing or oversized visible analysis at the worker result boundary', () => {
    const base = {
      action: {
        type: 'vote' as const,
        targetSeatId: 's2',
        decisionSummary: '选择二号。',
      },
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
    };
    expect(isAiTurnJobResult(base, 'vote', ['s2'], true, true)).toBe(false);
    expect(
      isAiTurnJobResult(
        {
          ...base,
          action: { ...base.action, visibleAnalysis: '析'.repeat(1_201) },
        },
        'vote',
        ['s2'],
        true,
        true,
      ),
    ).toBe(false);
  });

  it('rejects provider provenance without a matching successful attempt', () => {
    const base = {
      action: {
        type: 'vote' as const,
        targetSeatId: 's2',
        decisionSummary: '选择二号。',
      },
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      usedFallback: false,
      failureReasons: [],
    };
    expect(isAiTurnJobResult({ ...base, attempts: 1 }, 'vote', ['s2'], true)).toBe(false);
    expect(
      isAiTurnJobResult({ ...base, attempts: 0, providerAttempts: [] }, 'vote', ['s2'], true),
    ).toBe(false);
    expect(
      isAiTurnJobResult(
        {
          ...base,
          attempts: 1,
          providerAttempts: [
            {
              providerId: 'deepseek',
              succeeded: true,
              durationMs: 10,
              costCents: 0,
            },
          ],
        },
        'vote',
        ['s2'],
        true,
      ),
    ).toBe(false);
    expect(
      isAiTurnJobResult(
        {
          ...base,
          attempts: 1,
          providerAttempts: [
            {
              providerId: 'kimi',
              succeeded: true,
              durationMs: 10,
              costCents: 0,
            },
          ],
        },
        'vote',
        ['s2'],
        true,
      ),
    ).toBe(true);
  });

  it.each([
    {
      type: 'speak' as const,
      allowed: ['s2'],
      action: { type: 'speak' as const, message: '我选择二号。', targetSeatId: 's2' },
    },
    {
      type: 'vote' as const,
      allowed: ['s2'],
      action: { type: 'vote' as const, targetSeatId: 's2', abstain: true },
    },
    {
      type: 'night' as const,
      allowed: ['s2'],
      action: { type: 'night' as const, targetSeatId: 's2', useHeal: true },
    },
  ])('rejects malformed $type action controls at the worker result boundary', (example) => {
    expect(
      isAiTurnJobResult(
        {
          action: example.action,
          attempts: 0,
          usedFallback: true,
          failureReasons: [],
        },
        example.type,
        example.allowed,
      ),
    ).toBe(false);
  });
});

describe('AiGateway', () => {
  it('repairs an invalid response with a second request', async () => {
    const primary = provider('primary', [
      'not json',
      '{"type":"speak","message":"我认为 3 号需要解释。"}',
    ]);
    const gateway = new AiGateway({ providers: [primary] });
    const result = await gateway.executeTurn({
      primaryProviderId: 'primary',
      request: { model: 'model', messages: [{ role: 'user', content: '发言' }] },
      actionType: 'speak',
    });
    expect(result.action.message).toContain('3 号');
    expect(result.attempts).toBe(2);
  });

  it('repairs missing observer analysis and returns verified provider narrative fields', async () => {
    const visibleAnalysis =
      '二号的公开发言与此前票向存在冲突。目前证据仍不充分，但在其他人尚未形成更明显矛盾前，二号是本轮最需要施压解释的目标。';
    const primary: ModelProviderAdapter = {
      ...provider('kimi', [
        '{"type":"vote","targetSeatId":"s2","decisionSummary":"二号的公开发言与投票方向矛盾，因此选择二号。"}',
        JSON.stringify({
          type: 'vote',
          targetSeatId: 's2',
          decisionSummary: '二号的公开发言与投票方向矛盾，因此选择二号。',
          visibleAnalysis,
        }),
      ]),
      modelId: 'kimi-k2.6',
    };
    const gateway = new AiGateway({ providers: [primary] });
    const result = await gateway.executeTurn({
      primaryProviderId: 'kimi',
      request: { model: 'wrong-model', messages: [] },
      actionType: 'vote',
      allowedSeatIds: ['s2'],
      requireDecisionSummary: true,
      requireVisibleAnalysis: true,
    });
    expect(result).toMatchObject({
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      action: {
        type: 'vote',
        targetSeatId: 's2',
        decisionSummary: '二号的公开发言与投票方向矛盾，因此选择二号。',
        visibleAnalysis,
      },
      attempts: 2,
    });
  });

  it('returns cumulative provider cost across repair attempts', async () => {
    const complete = vi
      .fn<ModelProviderAdapter['complete']>()
      .mockResolvedValueOnce({ content: 'not json', costCents: 0.2 })
      .mockResolvedValueOnce({
        content: '{"type":"speak","message":"先听完这一轮发言。"}',
        costCents: 0.3,
      });
    const gateway = new AiGateway({
      providers: [
        {
          id: 'priced',
          kind: 'openai-compatible',
          capabilities: { jsonMode: true, streaming: false, transcription: false },
          complete,
        },
      ],
    });

    const result = await gateway.executeTurn({
      primaryProviderId: 'priced',
      request: { model: 'model', messages: [] },
      actionType: 'speak',
    });

    expect(result.costCents).toBeCloseTo(0.5);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(result.providerAttempts).toMatchObject([
      { providerId: 'priced', succeeded: false, costCents: 0.2 },
      { providerId: 'priced', succeeded: true, costCents: 0.3 },
    ]);
  });

  it('uses a fallback provider and finally a deterministic action', async () => {
    const broken = provider('broken', [new Error('timeout'), new Error('timeout')]);
    const fallback = provider('fallback', ['{"type":"vote","targetSeatId":"s4"}']);
    const gateway = new AiGateway({ providers: [broken, fallback] });
    const result = await gateway.executeTurn({
      primaryProviderId: 'broken',
      fallbackProviderIds: ['fallback'],
      request: { model: 'model', messages: [] },
      actionType: 'vote',
      allowedSeatIds: ['s4'],
    });
    expect(result).toMatchObject({
      action: { type: 'vote', targetSeatId: 's4' },
      providerId: 'fallback',
      usedFallback: true,
      attempts: 3,
      costCents: 0,
    });
  });

  it('returns the caller-provided legal fallback when the budget is exhausted', async () => {
    const primary = provider('primary', ['{"type":"vote","targetSeatId":"s2"}']);
    const gateway = new AiGateway({
      providers: [primary],
      costGuard: new CostGuard(0),
      maxAttemptsPerProvider: 2,
    });
    const result = await gateway.executeTurn({
      primaryProviderId: 'primary',
      request: { model: 'model', messages: [], estimatedCostCents: 1 },
      actionType: 'vote',
      allowedSeatIds: ['s2'],
      deterministicFallback: () => ({ type: 'vote', abstain: true }),
    });
    expect(result).toMatchObject({
      action: { type: 'vote', abstain: true },
      attempts: 2,
      usedFallback: true,
    });
    expect(primary.complete).not.toHaveBeenCalled();
    expect(result.failureReasons).toHaveLength(2);
  });

  it('conservatively charges every provider call that starts and then times out', async () => {
    const broken = provider('broken', [new Error('timeout'), new Error('timeout')]);
    const guard = new CostGuard(10);
    const gateway = new AiGateway({
      providers: [broken],
      costGuard: guard,
      maxAttemptsPerProvider: 2,
    });

    const result = await gateway.executeTurn({
      primaryProviderId: 'broken',
      request: { model: 'model', messages: [], estimatedCostCents: 2 },
      actionType: 'vote',
      deterministicFallback: () => ({ type: 'vote', abstain: true }),
    });

    expect(broken.complete).toHaveBeenCalledTimes(2);
    expect(result.costCents).toBe(4);
    expect(guard.snapshot()).toMatchObject({ spentCents: 4, remainingCents: 6 });
  });
});

describe('cost estimation', () => {
  it('never treats unknown provider pricing as a zero-cost request', () => {
    expect(
      estimateChatRequestCostCents(
        { model: 'model', messages: [], estimatedCostCents: 0 },
        undefined,
        1,
      ),
    ).toBe(1);
  });

  it('uses the provider-price upper bound when it exceeds an explicit estimate', () => {
    expect(
      estimateChatRequestCostCents(
        {
          model: 'model',
          messages: [],
          maxOutputTokens: 1_000,
          estimatedCostCents: 1,
        },
        { outputCentsPerMillion: 2_000_000 },
        1,
      ),
    ).toBe(2_000);
  });
});

describe('CostGuard', () => {
  it('enforces a hard cost ceiling', () => {
    const guard = new CostGuard(10);
    guard.record(7);
    expect(() => guard.assertCanSpend(4)).toThrow(CostLimitExceededError);
    expect(guard.snapshot().remainingCents).toBe(3);
  });

  it('reserves budget across concurrent calls', () => {
    const guard = new CostGuard(10);
    const reservation = guard.reserve(8);
    expect(() => guard.reserve(3)).toThrow(CostLimitExceededError);
    guard.release(reservation);
    expect(guard.reserve(3).amountCents).toBe(3);
  });
});

describe('OpenAiCompatibleAdapter', () => {
  it('maps the common chat completion response without network access', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"type":"speak","message":"你好"}' } }],
            usage: { prompt_tokens: 100, completion_tokens: 20 },
          }),
          { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-1' } },
        ),
    );
    const adapter = new OpenAiCompatibleAdapter({
      id: 'local',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      fetch: fetchMock as typeof fetch,
      inputPriceCentsPerMillion: 100,
      outputPriceCentsPerMillion: 200,
    });
    const result = await adapter.complete({ model: 'test', messages: [], responseFormat: 'json' });
    expect(result).toMatchObject({ inputTokens: 100, outputTokens: 20, requestId: 'req-1' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.costCents).toBeCloseTo(0.014);
  });

  it('does not report a misleading zero when token prices are unconfigured', async () => {
    const adapter = new OpenAiCompatibleAdapter({
      id: 'local',
      apiKey: 'test-key',
      baseUrl: 'https://example.invalid/v1',
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: '{"type":"speak","message":"你好"}' } }],
              usage: { prompt_tokens: 100, completion_tokens: 20 },
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
      ) as typeof fetch,
    });

    const result = await adapter.complete({ model: 'test', messages: [] });
    expect(result.costCents).toBeUndefined();
  });

  it('surfaces a provider error message without including request credentials', async () => {
    const adapter = new OpenAiCompatibleAdapter({
      id: 'local',
      apiKey: 'test-secret-must-not-appear',
      baseUrl: 'https://example.invalid/v1',
      fetch: vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: { message: '账户余额不足', type: 'insufficient_balance' },
            }),
            { status: 402, headers: { 'content-type': 'application/json' } },
          ),
      ) as typeof fetch,
    });

    await expect(adapter.complete({ model: 'test', messages: [] })).rejects.toThrow(
      '402: 账户余额不足',
    );
    await expect(adapter.complete({ model: 'test', messages: [] })).rejects.not.toThrow(
      /test-secret-must-not-appear/,
    );
  });

  it('uses short structured-output mode for both playable reasoning providers', async () => {
    const requestBodies: Array<Record<string, unknown>> = [];
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      requestBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"type":"vote","abstain":true}' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const kimi = createPlayableProviderAdapter({
      id: 'kimi',
      apiKey: 'test-kimi-key',
      baseUrl: 'https://api.moonshot.cn/v1',
      modelId: 'kimi-k2.6',
    }) as OpenAiCompatibleAdapter;
    const deepseek = createPlayableProviderAdapter({
      id: 'deepseek',
      apiKey: 'test-deepseek-key',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'deepseek-v4-flash',
    }) as OpenAiCompatibleAdapter;
    vi.stubGlobal('fetch', fetchMock);

    await kimi.complete({
      model: 'wrong-primary-model',
      messages: [],
      temperature: 0.55,
      responseFormat: 'json',
    });
    await deepseek.complete({
      model: 'wrong-fallback-model',
      messages: [],
      temperature: 0.55,
      responseFormat: 'json',
    });

    expect(requestBodies[0]).toMatchObject({
      model: 'kimi-k2.6',
      temperature: 0.6,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    });
    expect(requestBodies[1]).toMatchObject({
      model: 'deepseek-v4-flash',
      temperature: 0.55,
      thinking: { type: 'disabled' },
      response_format: { type: 'json_object' },
    });
    vi.unstubAllGlobals();
  });
});
