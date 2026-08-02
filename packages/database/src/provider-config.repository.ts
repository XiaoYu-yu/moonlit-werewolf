import { PrismaClient } from '@prisma/client';

export type ProviderConfigKind = 'openai-compatible' | 'dashscope' | 'volcengine-ark';

export interface ProviderConfigRecord {
  readonly id: string;
  readonly slug: string;
  readonly displayName: string;
  readonly kind: ProviderConfigKind;
  readonly baseUrl: string;
  readonly encryptedApiKey: string;
  readonly enabled: boolean;
  readonly concurrencyLimit: number;
  readonly timeoutMs: number;
  readonly dailyBudgetCents: number;
  readonly capabilities: Readonly<Record<string, boolean>>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type UpsertProviderConfig = Omit<ProviderConfigRecord, 'id' | 'createdAt' | 'updatedAt'>;

export interface ProviderUsageRecord {
  readonly providerId: string;
  readonly succeeded: boolean;
  readonly durationMs: number;
  readonly costCents: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly error?: string;
  readonly matchId?: string;
  readonly createdAt: Date;
}

export type AppendProviderUsage = Omit<ProviderUsageRecord, 'createdAt'> & {
  readonly createdAt?: Date;
};

export interface ProviderConfigRepository {
  list(): Promise<readonly ProviderConfigRecord[]>;
  upsert(input: UpsertProviderConfig): Promise<ProviderConfigRecord>;
  appendUsage?(input: AppendProviderUsage): Promise<void>;
  listUsage?(since: Date): Promise<readonly ProviderUsageRecord[]>;
  disconnect?(): Promise<void>;
}

function cloneRecord(record: ProviderConfigRecord): ProviderConfigRecord {
  return {
    ...record,
    capabilities: { ...record.capabilities },
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

function assertEncryptedCredential(value: string): void {
  if (!/^v\d+\./.test(value)) {
    throw new Error('Provider configuration requires a versioned encrypted credential');
  }
}

/**
 * Development/test adapter. The service passes only an AES-GCM ciphertext into
 * this repository, so the in-memory control plane never retains a plaintext key.
 */
export class MemoryProviderConfigRepository implements ProviderConfigRepository {
  readonly #records = new Map<string, ProviderConfigRecord>();
  readonly #usage: ProviderUsageRecord[] = [];
  #nextId = 1;

  async list(): Promise<readonly ProviderConfigRecord[]> {
    return [...this.#records.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map(cloneRecord);
  }

  async upsert(input: UpsertProviderConfig): Promise<ProviderConfigRecord> {
    assertEncryptedCredential(input.encryptedApiKey);
    const existing = this.#records.get(input.slug);
    const now = new Date();
    const record: ProviderConfigRecord = {
      ...input,
      capabilities: { ...input.capabilities },
      id: existing?.id ?? `memory-provider-${this.#nextId++}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.#records.set(input.slug, record);
    return cloneRecord(record);
  }

  async appendUsage(input: AppendProviderUsage): Promise<void> {
    this.#usage.push({
      ...input,
      createdAt: input.createdAt ? new Date(input.createdAt) : new Date(),
    });
  }

  async listUsage(since: Date): Promise<readonly ProviderUsageRecord[]> {
    return this.#usage
      .filter((item) => item.createdAt >= since)
      .map((item) => ({ ...item, createdAt: new Date(item.createdAt) }));
  }
}

const TO_PRISMA_KIND = {
  'openai-compatible': 'OPENAI_COMPATIBLE',
  dashscope: 'DASHSCOPE',
  'volcengine-ark': 'VOLCENGINE_ARK',
} as const;

const FROM_PRISMA_KIND = {
  OPENAI_COMPATIBLE: 'openai-compatible',
  DASHSCOPE: 'dashscope',
  VOLCENGINE_ARK: 'volcengine-ark',
} as const;

type PrismaProviderClient = Pick<PrismaClient, 'providerConfig' | 'usageRecord' | '$disconnect'>;
type PrismaProviderRow = Awaited<
  ReturnType<PrismaProviderClient['providerConfig']['findFirstOrThrow']>
>;

function fromPrisma(row: PrismaProviderRow): ProviderConfigRecord {
  const capabilities =
    row.capabilities && typeof row.capabilities === 'object' && !Array.isArray(row.capabilities)
      ? Object.fromEntries(
          Object.entries(row.capabilities).filter(
            (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
          ),
        )
      : {};

  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    kind: FROM_PRISMA_KIND[row.kind],
    baseUrl: row.baseUrl,
    encryptedApiKey: row.encryptedApiKey,
    enabled: row.enabled,
    concurrencyLimit: row.concurrencyLimit,
    timeoutMs: row.timeoutMs,
    dailyBudgetCents: row.dailyBudgetCents,
    capabilities,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaProviderConfigRepository implements ProviderConfigRepository {
  constructor(private readonly prisma: PrismaProviderClient) {}

  async list(): Promise<readonly ProviderConfigRecord[]> {
    const rows = await this.prisma.providerConfig.findMany({
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(fromPrisma);
  }

  async upsert(input: UpsertProviderConfig): Promise<ProviderConfigRecord> {
    assertEncryptedCredential(input.encryptedApiKey);
    const values = {
      displayName: input.displayName,
      kind: TO_PRISMA_KIND[input.kind],
      baseUrl: input.baseUrl,
      encryptedApiKey: input.encryptedApiKey,
      enabled: input.enabled,
      concurrencyLimit: input.concurrencyLimit,
      timeoutMs: input.timeoutMs,
      dailyBudgetCents: input.dailyBudgetCents,
      capabilities: { ...input.capabilities },
    };
    const row = await this.prisma.providerConfig.upsert({
      where: { slug: input.slug },
      create: {
        slug: input.slug,
        ...values,
      },
      update: values,
    });
    return fromPrisma(row);
  }

  async appendUsage(input: AppendProviderUsage): Promise<void> {
    await this.prisma.usageRecord.create({
      data: {
        kind: 'CHAT',
        status: input.succeeded ? 'SUCCEEDED' : 'FAILED',
        providerSlug: input.providerId,
        durationMs: Math.max(0, Math.round(input.durationMs)),
        costCents: Math.max(0, input.costCents),
        ...(input.inputTokens !== undefined
          ? { inputTokens: Math.max(0, Math.round(input.inputTokens)) }
          : {}),
        ...(input.outputTokens !== undefined
          ? { outputTokens: Math.max(0, Math.round(input.outputTokens)) }
          : {}),
        ...(input.error ? { errorCode: input.error.slice(0, 512) } : {}),
        ...(input.matchId ? { matchId: input.matchId } : {}),
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      },
    });
  }

  async listUsage(since: Date): Promise<readonly ProviderUsageRecord[]> {
    const rows = await this.prisma.usageRecord.findMany({
      where: {
        kind: 'CHAT',
        createdAt: { gte: since },
      },
      orderBy: { createdAt: 'asc' },
      select: {
        providerSlug: true,
        status: true,
        durationMs: true,
        costCents: true,
        inputTokens: true,
        outputTokens: true,
        errorCode: true,
        matchId: true,
        createdAt: true,
      },
    });
    return rows.map((row) => ({
      providerId: row.providerSlug,
      succeeded: row.status === 'SUCCEEDED',
      durationMs: row.durationMs ?? 0,
      costCents: Number(row.costCents),
      ...(row.inputTokens !== null ? { inputTokens: row.inputTokens } : {}),
      ...(row.outputTokens !== null ? { outputTokens: row.outputTokens } : {}),
      ...(row.errorCode ? { error: row.errorCode } : {}),
      ...(row.matchId ? { matchId: row.matchId } : {}),
      createdAt: row.createdAt,
    }));
  }

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
  }
}

export function createPrismaProviderConfigRepository(): ProviderConfigRepository {
  return new PrismaProviderConfigRepository(new PrismaClient());
}
