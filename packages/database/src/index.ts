/**
 * Persistence-facing contracts are deliberately independent of Prisma Client.
 * The API can run with an in-memory adapter in development and switch to a
 * generated Prisma adapter without changing the domain services.
 */
export interface TransactionContext {
  readonly requestId: string;
}

export interface PersistedEvent<TPayload = unknown> {
  readonly matchId: string;
  readonly sequence: number;
  readonly type: string;
  readonly payload: TPayload;
  readonly audienceSeatId?: string;
  readonly idempotencyKey?: string;
  readonly createdAt: Date;
}

export interface EventStore {
  append<TPayload>(
    event: Omit<PersistedEvent<TPayload>, 'sequence' | 'createdAt'>,
    context?: TransactionContext,
  ): Promise<PersistedEvent<TPayload>>;
  read(matchId: string, afterSequence?: number): Promise<readonly PersistedEvent[]>;
}

export interface DistributedLock {
  runExclusive<T>(key: string, ttlMs: number, task: () => Promise<T>): Promise<T>;
}

export interface UsageCharge {
  readonly matchId?: string;
  readonly modelId?: string;
  readonly providerSlug: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly durationMs?: number;
  readonly costCents: number;
  readonly status: 'succeeded' | 'failed' | 'rejected_budget';
}

export interface UsageRepository {
  record(charge: UsageCharge): Promise<void>;
  spentCents(scope: { readonly matchId?: string; readonly day?: Date }): Promise<number>;
}

export {
  MemoryProviderConfigRepository,
  PrismaProviderConfigRepository,
  createPrismaProviderConfigRepository,
} from './provider-config.repository.js';
export type {
  ProviderConfigKind,
  ProviderConfigRecord,
  ProviderConfigRepository,
  ProviderUsageRecord,
  AppendProviderUsage,
  UpsertProviderConfig,
} from './provider-config.repository.js';
