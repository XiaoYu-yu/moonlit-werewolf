import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdminService } from '../admin/admin.service.js';
import { AiTurnQueueService } from './ai-turn-queue.service.js';

const originalRedisUrl = process.env.REDIS_URL;
const originalConnectTimeout = process.env.AI_QUEUE_CONNECT_TIMEOUT_MS;
const originalResultTimeout = process.env.AI_QUEUE_RESULT_TIMEOUT_MS;
const originalProviderTimeout = process.env.AI_PROVIDER_TIMEOUT_MS;
const originalMaxAttempts = process.env.AI_MAX_ATTEMPTS_PER_PROVIDER;
const originalFallbackProviders = process.env.AI_FALLBACK_PROVIDER_IDS;
const originalNodeEnvironment = process.env.NODE_ENV;

afterEach(() => {
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
  if (originalConnectTimeout === undefined) delete process.env.AI_QUEUE_CONNECT_TIMEOUT_MS;
  else process.env.AI_QUEUE_CONNECT_TIMEOUT_MS = originalConnectTimeout;
  if (originalResultTimeout === undefined) delete process.env.AI_QUEUE_RESULT_TIMEOUT_MS;
  else process.env.AI_QUEUE_RESULT_TIMEOUT_MS = originalResultTimeout;
  if (originalProviderTimeout === undefined) delete process.env.AI_PROVIDER_TIMEOUT_MS;
  else process.env.AI_PROVIDER_TIMEOUT_MS = originalProviderTimeout;
  if (originalMaxAttempts === undefined) delete process.env.AI_MAX_ATTEMPTS_PER_PROVIDER;
  else process.env.AI_MAX_ATTEMPTS_PER_PROVIDER = originalMaxAttempts;
  if (originalFallbackProviders === undefined) delete process.env.AI_FALLBACK_PROVIDER_IDS;
  else process.env.AI_FALLBACK_PROVIDER_IDS = originalFallbackProviders;
  if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnvironment;
  vi.restoreAllMocks();
});

describe('AiTurnQueueService', () => {
  it('uses the direct provider runtime when Redis is intentionally absent', async () => {
    delete process.env.REDIS_URL;
    const executeAiTurnDirect = vi.fn(async (data) => ({
      action: data.fallbackAction,
      attempts: 1,
      usedFallback: false,
      providerId: 'kimi',
      failureReasons: [],
      providerAttempts: [
        {
          providerId: 'kimi',
          succeeded: true,
          durationMs: 12,
          costCents: 0.1,
        },
      ],
      costCents: 0.1,
    }));
    const service = new AiTurnQueueService({
      executeAiTurnDirect,
    } as unknown as AdminService);

    const result = await service.execute({
      primaryProviderId: 'kimi',
      request: { model: 'kimi-k2.6', messages: [] },
      actionType: 'vote',
      allowedSeatIds: ['seat-2'],
      fallbackAction: { type: 'vote', targetSeatId: 'seat-2' },
      roomId: 'room-1',
      matchId: 'match-1',
      actorSeatId: 'seat-1',
    });

    expect(executeAiTurnDirect).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ providerId: 'kimi', usedFallback: false });
    await service.onModuleDestroy();
  });

  it('does not require Redis and returns the legal action supplied by game-core', async () => {
    delete process.env.REDIS_URL;
    const service = new AiTurnQueueService();
    const result = await service.execute({
      primaryProviderId: 'deepseek',
      request: { model: 'deepseek-chat', messages: [] },
      actionType: 'vote',
      allowedSeatIds: ['seat-2'],
      fallbackAction: { type: 'vote', targetSeatId: 'seat-2' },
      roomId: 'room-1',
      matchId: 'match-1',
      actorSeatId: 'seat-1',
    });
    expect(result).toMatchObject({
      action: { type: 'vote', targetSeatId: 'seat-2' },
      attempts: 0,
      usedFallback: true,
    });
    expect(result.failureReasons[0]).toContain('REDIS_URL');
    await service.onModuleDestroy();
  });

  it('falls back without blocking the game loop when Redis is unreachable', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1';
    process.env.AI_QUEUE_CONNECT_TIMEOUT_MS = '100';
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const service = new AiTurnQueueService();

    const result = await service.execute({
      primaryProviderId: 'deepseek',
      request: { model: 'deepseek-chat', messages: [] },
      actionType: 'night',
      allowedSeatIds: ['seat-2'],
      fallbackAction: { type: 'night', targetSeatId: 'seat-2' },
      roomId: 'room-1',
      matchId: 'match-1',
      actorSeatId: 'seat-1',
    });

    expect(result).toMatchObject({
      action: { type: 'night', targetSeatId: 'seat-2' },
      attempts: 0,
      usedFallback: true,
    });
    expect(result.failureReasons[0]).toContain('temporarily unavailable');
    await service.onModuleDestroy();
  });

  it('uses the shared queue timeout validation in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.AI_FALLBACK_PROVIDER_IDS = 'kimi,glm';
    process.env.AI_QUEUE_RESULT_TIMEOUT_MS = '30000';

    expect(() => new AiTurnQueueService()).toThrow(/AI_QUEUE_RESULT_TIMEOUT_MS.*125000/);
  });

  it('uses the shared safe timeout fallback in development without requiring Redis', async () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'development';
    process.env.AI_FALLBACK_PROVIDER_IDS = 'kimi';
    process.env.AI_QUEUE_RESULT_TIMEOUT_MS = '1000';

    const service = new AiTurnQueueService();
    const result = await service.execute({
      primaryProviderId: 'deepseek',
      request: { model: 'deepseek-chat', messages: [] },
      actionType: 'vote',
      allowedSeatIds: ['seat-2'],
      fallbackAction: { type: 'vote', targetSeatId: 'seat-2' },
      roomId: 'room-1',
      matchId: 'match-1',
      actorSeatId: 'seat-1',
    });

    expect(result.failureReasons[0]).toContain('REDIS_URL');
    await service.onModuleDestroy();
  });

  it('uses shared canonical connection timeout validation in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.AI_QUEUE_CONNECT_TIMEOUT_MS = '15e2';

    expect(() => new AiTurnQueueService()).toThrow(/AI_QUEUE_CONNECT_TIMEOUT_MS/);
  });

  it('uses the shared connection timeout fallback in development', async () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = 'development';
    process.env.AI_QUEUE_CONNECT_TIMEOUT_MS = '2147483648';

    const service = new AiTurnQueueService();
    const result = await service.execute({
      primaryProviderId: 'deepseek',
      request: { model: 'deepseek-chat', messages: [] },
      actionType: 'vote',
      allowedSeatIds: ['seat-2'],
      fallbackAction: { type: 'vote', targetSeatId: 'seat-2' },
      roomId: 'room-1',
      matchId: 'match-1',
      actorSeatId: 'seat-1',
    });

    expect(result.failureReasons[0]).toContain('REDIS_URL');
    await service.onModuleDestroy();
  });
});
