import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ProviderConfigRecord,
  type ProviderConfigRepository,
  type UpsertProviderConfig,
} from '@werewolf/database';
import { AdminController } from './admin.controller.js';
import type { CreateProviderDto } from './admin.dto.js';
import { AdminService } from './admin.service.js';
import { EncryptedMemoryProviderConfigRepository } from './provider-config.repository.js';
import { ProviderSecretCipher } from './provider-secret-cipher.js';

const dto: CreateProviderDto = {
  slug: 'deepseek',
  name: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-plaintext-must-never-leak',
  enabled: true,
  concurrencyLimit: 6,
  timeoutMs: 18_000,
  dailyBudgetCents: 2_500,
};

class InspectableRepository implements ProviderConfigRepository {
  readonly memory = new EncryptedMemoryProviderConfigRepository();
  lastStored?: ProviderConfigRecord;

  list() {
    return this.memory.list();
  }

  async upsert(input: UpsertProviderConfig) {
    this.lastStored = await this.memory.upsert(input);
    return this.lastStored;
  }
}

const originalDeepSeekKey = process.env.DEEPSEEK_API_KEY;
const originalKimiKey = process.env.KIMI_API_KEY;
const originalKimiModel = process.env.KIMI_MODEL;

afterEach(() => {
  if (originalDeepSeekKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = originalDeepSeekKey;
  if (originalKimiKey === undefined) delete process.env.KIMI_API_KEY;
  else process.env.KIMI_API_KEY = originalKimiKey;
  if (originalKimiModel === undefined) delete process.env.KIMI_MODEL;
  else process.env.KIMI_MODEL = originalKimiModel;
  vi.unstubAllGlobals();
});

describe('Admin provider control plane', () => {
  it('persists encrypted credentials and returns only a masked key from the API', async () => {
    const repository = new InspectableRepository();
    const service = new AdminService(repository, new ProviderSecretCipher(Buffer.alloc(32, 7)));
    const controller = new AdminController(service);
    const response = await controller.createProvider(dto);
    const serialized = JSON.stringify(response);

    expect(repository.lastStored?.encryptedApiKey).toMatch(/^v1\./);
    expect(repository.lastStored?.encryptedApiKey).not.toContain(dto.apiKey);
    expect(serialized).not.toContain(dto.apiKey);
    expect(serialized).not.toContain('encryptedApiKey');
    expect(serialized).not.toMatch(/"apiKey"/);
    expect(response).toMatchObject({
      slug: 'deepseek',
      name: 'DeepSeek',
      enabled: true,
      concurrencyLimit: 6,
      timeoutMs: 18_000,
      dailyBudgetCents: 2_500,
      maskedApiKey: 'sk-****************eak',
    });
  });

  it('reads and updates the persisted provider configuration by slug', async () => {
    const repository = new EncryptedMemoryProviderConfigRepository();
    const service = new AdminService(repository, new ProviderSecretCipher(Buffer.alloc(32, 8)));
    const first = await service.createProvider(dto);
    const updated = await service.createProvider({
      ...dto,
      apiKey: 'sk-replacement-provider-key',
      enabled: false,
      concurrencyLimit: 2,
      timeoutMs: 40_000,
      dailyBudgetCents: 900,
    });
    const listed = await service.listProviders();

    expect(updated.id).toBe(first.id);
    expect(listed).toHaveLength(2);
    expect(listed.find((provider) => provider.slug === 'deepseek')).toMatchObject({
      enabled: false,
      concurrencyLimit: 2,
      timeoutMs: 40_000,
      dailyBudgetCents: 900,
      maskedApiKey: 'sk-****************key',
    });
    expect(listed.find((provider) => provider.slug === 'kimi')).toMatchObject({
      configured: false,
      enabled: false,
      status: 'missing-credential',
      usage: { calls: 0, succeeded: 0, failed: 0, costCents: 0, averageLatencyMs: 0 },
    });
    expect(JSON.stringify(listed)).not.toContain('sk-replacement-provider-key');
  });

  it('calls a real environment-backed Kimi adapter without Redis and reports truthful usage', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    process.env.KIMI_API_KEY = 'test-only-kimi-secret';
    process.env.KIMI_MODEL = 'kimi-k2.6';
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"type":"vote","targetSeatId":"seat-2","decisionSummary":"二号的公开行为前后矛盾，因此选择二号。","visibleAnalysis":"二号的公开行为和此前表达存在冲突，当前虽然仍需更多发言验证，但将票投给二号能迫使其进一步解释，并为下一轮留下清晰票型。"}',
                },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 5 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = new AdminService(
      new EncryptedMemoryProviderConfigRepository(),
      new ProviderSecretCipher(Buffer.alloc(32, 9)),
    );

    const result = await service.executeAiTurnDirect({
      primaryProviderId: 'kimi',
      request: {
        model: 'wrong-seat-model',
        messages: [{ role: 'user', content: '只返回 JSON' }],
        estimatedCostCents: 0.25,
      },
      actionType: 'vote',
      allowedSeatIds: ['seat-2'],
      requireDecisionSummary: true,
      requireVisibleAnalysis: true,
      fallbackAction: { type: 'vote', abstain: true },
      roomId: 'room-1',
      matchId: 'match-1',
      actorSeatId: 'seat-1',
    });
    const dashboard = await service.usageSummary();
    const providers = await service.listProviders();
    const requestBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as Record<string, unknown>;

    expect(result).toMatchObject({
      action: { type: 'vote', targetSeatId: 'seat-2' },
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      usedFallback: false,
    });
    expect(requestBody).toMatchObject({
      model: 'kimi-k2.6',
      temperature: 0.6,
      thinking: { type: 'disabled' },
    });
    expect(dashboard).toMatchObject({
      calls: 1,
      succeeded: 1,
      failed: 0,
      costCents: 0.25,
      providers: 2,
    });
    expect(providers.find((provider) => provider.slug === 'kimi')).toMatchObject({
      source: 'environment',
      configured: true,
      enabled: true,
      status: 'ready',
      usage: { calls: 1, succeeded: 1, failed: 0, costCents: 0.25 },
    });
    expect(JSON.stringify(providers)).not.toContain('test-only-kimi-secret');
  });

  it('records provider failures while always returning the supplied legal fallback', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-only-deepseek-secret';
    delete process.env.KIMI_API_KEY;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('upstream unavailable', { status: 503 })),
    );
    const service = new AdminService(
      new EncryptedMemoryProviderConfigRepository(),
      new ProviderSecretCipher(Buffer.alloc(32, 10)),
    );

    const result = await service.executeAiTurnDirect({
      primaryProviderId: 'deepseek',
      request: {
        model: 'deepseek-v4-flash',
        messages: [],
        estimatedCostCents: 1,
      },
      actionType: 'night',
      allowedSeatIds: ['seat-2'],
      fallbackAction: { type: 'night', targetSeatId: 'seat-2' },
      roomId: 'room-1',
      matchId: 'match-1',
      actorSeatId: 'seat-1',
    });
    const usage = await service.usageSummary();

    expect(result).toMatchObject({
      action: { type: 'night', targetSeatId: 'seat-2' },
      usedFallback: true,
    });
    expect(usage).toMatchObject({ calls: 2, succeeded: 0, failed: 2, costCents: 2 });
    expect(usage.providerUsage[0]?.lastError).toMatch(/non-JSON response/);
    expect(JSON.stringify(usage)).not.toContain('test-only-deepseek-secret');
  });

  it('enforces the configured provider daily budget in the direct runtime', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.KIMI_API_KEY;
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"type":"vote","abstain":true}' } }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = new AdminService(
      new EncryptedMemoryProviderConfigRepository(),
      new ProviderSecretCipher(Buffer.alloc(32, 11)),
    );
    await service.createProvider({
      ...dto,
      enabled: true,
      dailyBudgetCents: 1,
    });
    const turn = {
      primaryProviderId: 'deepseek',
      request: {
        model: 'deepseek-v4-flash',
        messages: [],
        estimatedCostCents: 1,
      },
      actionType: 'vote' as const,
      fallbackAction: { type: 'vote' as const, abstain: true },
      roomId: 'room-1',
      matchId: 'match-1',
      actorSeatId: 'seat-1',
    };

    const first = await service.executeAiTurnDirect(turn);
    const second = await service.executeAiTurnDirect(turn);
    const usage = await service.usageSummary();

    expect(first.usedFallback).toBe(false);
    expect(second).toMatchObject({
      action: { type: 'vote', abstain: true },
      usedFallback: true,
      providerAttempts: [],
    });
    expect(second.failureReasons).toEqual([
      expect.stringContaining('daily budget is exhausted'),
      expect.stringContaining('daily budget is exhausted'),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(usage).toMatchObject({ calls: 1, succeeded: 1, failed: 0, costCents: 1 });
  });

  it('rejects excess direct concurrency before another provider HTTP call starts', async () => {
    delete process.env.DEEPSEEK_API_KEY;
    delete process.env.KIMI_API_KEY;
    let releaseRequest: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          releaseRequest = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const service = new AdminService(
      new EncryptedMemoryProviderConfigRepository(),
      new ProviderSecretCipher(Buffer.alloc(32, 12)),
    );
    await service.createProvider({
      ...dto,
      enabled: true,
      concurrencyLimit: 1,
      dailyBudgetCents: 0,
    });
    const turn = {
      primaryProviderId: 'deepseek',
      request: { model: 'deepseek-v4-flash', messages: [] },
      actionType: 'vote' as const,
      fallbackAction: { type: 'vote' as const, abstain: true },
      roomId: 'room-1',
      matchId: 'match-1',
      actorSeatId: 'seat-1',
    };

    const firstPromise = service.executeAiTurnDirect(turn);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const second = await service.executeAiTurnDirect(turn);
    releaseRequest?.(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"type":"vote","abstain":true}' } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const first = await firstPromise;

    expect(first.usedFallback).toBe(false);
    expect(second).toMatchObject({ usedFallback: true, providerAttempts: [] });
    expect(second.failureReasons).toEqual([
      expect.stringContaining('concurrency limit is reached'),
      expect.stringContaining('concurrency limit is reached'),
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    await expect(service.usageSummary()).resolves.toMatchObject({
      calls: 1,
      succeeded: 1,
      failed: 0,
    });
  });
});
