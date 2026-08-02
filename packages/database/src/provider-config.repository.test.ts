import { expectTypeOf, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  MemoryProviderConfigRepository,
  PrismaProviderConfigRepository,
  type ProviderConfigRepository,
  type UpsertProviderConfig,
} from './provider-config.repository.js';

const input: UpsertProviderConfig = {
  slug: 'deepseek',
  displayName: 'DeepSeek',
  kind: 'openai-compatible',
  baseUrl: 'https://api.deepseek.com',
  encryptedApiKey: 'v1.key-id.nonce.ciphertext.auth-tag',
  enabled: true,
  concurrencyLimit: 4,
  timeoutMs: 20_000,
  dailyBudgetCents: 1_000,
  capabilities: { chat: true },
};

describe('ProviderConfigRepository', () => {
  it('upserts encrypted configuration through the memory contract', async () => {
    const repository: ProviderConfigRepository = new MemoryProviderConfigRepository();
    const created = await repository.upsert(input);
    const updated = await repository.upsert({
      ...input,
      enabled: false,
      timeoutMs: 30_000,
    });

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toEqual(created.createdAt);
    expect(await repository.list()).toMatchObject([
      {
        slug: 'deepseek',
        encryptedApiKey: input.encryptedApiKey,
        enabled: false,
        timeoutMs: 30_000,
      },
    ]);
  });

  it('refuses to retain a plaintext provider credential', async () => {
    const repository = new MemoryProviderConfigRepository();
    await expect(
      repository.upsert({
        ...input,
        encryptedApiKey: 'sk-plaintext-is-not-a-valid-storage-value',
      }),
    ).rejects.toThrow('versioned encrypted credential');
    await expect(repository.list()).resolves.toEqual([]);
  });

  it('stores only real provider attempt samples in the memory usage repository', async () => {
    const repository = new MemoryProviderConfigRepository();
    const createdAt = new Date('2026-07-18T01:00:00.000Z');
    await repository.appendUsage({
      providerId: 'kimi',
      succeeded: false,
      durationMs: 812,
      costCents: 0.25,
      error: 'upstream timeout',
      createdAt,
    });

    await expect(repository.listUsage(new Date('2026-07-18T00:00:00.000Z'))).resolves.toEqual([
      {
        providerId: 'kimi',
        succeeded: false,
        durationMs: 812,
        costCents: 0.25,
        error: 'upstream timeout',
        createdAt,
      },
    ]);
    await expect(repository.listUsage(new Date('2026-07-18T02:00:00.000Z'))).resolves.toEqual([]);
  });

  it('maps the repository contract to the Prisma ProviderConfig delegate', async () => {
    const stored = {
      id: 'provider-1',
      slug: input.slug,
      displayName: input.displayName,
      kind: 'OPENAI_COMPATIBLE' as const,
      baseUrl: input.baseUrl,
      encryptedApiKey: input.encryptedApiKey,
      enabled: input.enabled,
      concurrencyLimit: input.concurrencyLimit,
      timeoutMs: input.timeoutMs,
      dailyBudgetCents: input.dailyBudgetCents,
      capabilities: input.capabilities,
      createdAt: new Date('2026-07-18T00:00:00.000Z'),
      updatedAt: new Date('2026-07-18T00:00:00.000Z'),
    };
    const upsert = vi.fn(async () => stored);
    const findMany = vi.fn(async () => [stored]);
    const createUsage = vi.fn(async () => ({ id: 'usage-1' }));
    const findUsage = vi.fn(async () => [
      {
        providerSlug: 'deepseek',
        status: 'SUCCEEDED',
        durationMs: 321,
        costCents: 0.5,
        inputTokens: 30,
        outputTokens: 10,
        errorCode: null,
        matchId: null,
        createdAt: new Date('2026-07-18T01:00:00.000Z'),
      },
    ]);
    const disconnect = vi.fn(async () => undefined);
    const fakePrisma = {
      providerConfig: { upsert, findMany },
      usageRecord: { create: createUsage, findMany: findUsage },
      $disconnect: disconnect,
    } as unknown as Pick<PrismaClient, 'providerConfig' | '$disconnect'>;
    const repository: ProviderConfigRepository = new PrismaProviderConfigRepository(fakePrisma);

    expectTypeOf(repository).toMatchTypeOf<ProviderConfigRepository>();
    await expect(repository.upsert(input)).resolves.toMatchObject({
      kind: 'openai-compatible',
      dailyBudgetCents: 1_000,
    });
    expect(upsert).toHaveBeenCalledWith({
      where: { slug: 'deepseek' },
      create: expect.objectContaining({
        slug: 'deepseek',
        kind: 'OPENAI_COMPATIBLE',
        encryptedApiKey: input.encryptedApiKey,
      }),
      update: expect.objectContaining({
        enabled: true,
        concurrencyLimit: 4,
        timeoutMs: 20_000,
        dailyBudgetCents: 1_000,
      }),
    });
    await expect(repository.list()).resolves.toHaveLength(1);
    await repository.appendUsage?.({
      providerId: 'deepseek',
      succeeded: true,
      durationMs: 321,
      costCents: 0.5,
      inputTokens: 30,
      outputTokens: 10,
    });
    expect(createUsage).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: 'CHAT',
        status: 'SUCCEEDED',
        providerSlug: 'deepseek',
        durationMs: 321,
        costCents: 0.5,
      }),
    });
    await expect(
      repository.listUsage?.(new Date('2026-07-18T00:00:00.000Z')),
    ).resolves.toMatchObject([
      {
        providerId: 'deepseek',
        succeeded: true,
        durationMs: 321,
        costCents: 0.5,
      },
    ]);
    await repository.disconnect?.();
    expect(disconnect).toHaveBeenCalledOnce();
  });
});
