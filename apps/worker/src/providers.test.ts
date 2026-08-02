import { afterEach, describe, expect, it, vi } from 'vitest';
import { providersFromEnvironment } from './providers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function successfulFetch() {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"type":"vote","abstain":true}' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
}

describe('process-local budget guard', () => {
  it('registers only DeepSeek and Kimi and uses a provider-local model for fallback', async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        const text = String(url);
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url: text, body });
        if (text.includes('deepseek')) {
          return new Response('unavailable', { status: 503 });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"type":"vote","abstain":true}' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
    const providers = providersFromEnvironment({
      maxAttemptsPerProvider: 1,
      environment: {
        DEEPSEEK_API_KEY: 'test-deepseek',
        KIMI_API_KEY: 'test-kimi',
        MIMO_API_KEY: 'must-not-register',
        MIMO_BASE_URL: 'https://mimo.invalid/v1',
        GLM_API_KEY: 'must-not-register',
        DASHSCOPE_API_KEY: 'must-not-register',
        VOLCENGINE_ARK_API_KEY: 'must-not-register',
      },
    });

    const result = await providers.gateway.executeTurn({
      primaryProviderId: 'deepseek',
      fallbackProviderIds: ['mimo', 'glm', 'qwen', 'doubao', 'kimi'],
      request: { model: 'wrong-shared-model', messages: [] },
      actionType: 'vote',
    });

    expect(result.providerId).toBe('kimi');
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      url: 'https://api.deepseek.com/chat/completions',
      body: {
        model: 'deepseek-v4-flash',
        thinking: { type: 'disabled' },
      },
    });
    expect(requests[1]).toMatchObject({
      url: 'https://api.moonshot.cn/v1/chat/completions',
      body: {
        model: 'kimi-k2.6',
        temperature: 0.6,
        thinking: { type: 'disabled' },
      },
    });
    expect(requests.some((request) => /mimo|bigmodel|dashscope|volcengine/.test(request.url))).toBe(
      false,
    );
  });

  it('does not inherit the daily budget when the optional process ceiling is unset', async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal('fetch', fetchMock);
    const providers = providersFromEnvironment({
      environment: {
        DEEPSEEK_API_KEY: 'test-only',
        AI_DAILY_BUDGET_CENTS: '0',
      },
    });

    const result = await providers.gateway.executeTurn({
      primaryProviderId: 'deepseek',
      request: { model: 'test', messages: [], estimatedCostCents: 1 },
      actionType: 'vote',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(result.usedFallback).toBe(false);
  });

  it('enforces an explicitly configured valid process ceiling', async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal('fetch', fetchMock);
    const providers = providersFromEnvironment({
      environment: {
        DEEPSEEK_API_KEY: 'test-only',
        AI_PROCESS_BUDGET_CENTS: '0',
      },
    });

    const result = await providers.gateway.executeTurn({
      primaryProviderId: 'deepseek',
      request: { model: 'test', messages: [], estimatedCostCents: 1 },
      actionType: 'vote',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.usedFallback).toBe(true);
  });

  it('ignores an invalid optional process ceiling instead of creating a permanent zero guard', async () => {
    const fetchMock = successfulFetch();
    vi.stubGlobal('fetch', fetchMock);
    const providers = providersFromEnvironment({
      environment: {
        DEEPSEEK_API_KEY: 'test-only',
        AI_DAILY_BUDGET_CENTS: '0',
        AI_PROCESS_BUDGET_CENTS: 'not-a-number',
      },
    });

    await providers.gateway.executeTurn({
      primaryProviderId: 'deepseek',
      request: { model: 'test', messages: [], estimatedCostCents: 1 },
      actionType: 'vote',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
