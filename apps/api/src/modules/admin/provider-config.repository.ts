import type {
  AppendProviderUsage,
  ProviderConfigRecord,
  ProviderConfigRepository,
  ProviderUsageRecord,
  UpsertProviderConfig,
} from '@werewolf/database';

export const PROVIDER_CONFIG_REPOSITORY = Symbol('PROVIDER_CONFIG_REPOSITORY');

function cloneRecord(record: ProviderConfigRecord): ProviderConfigRecord {
  return {
    ...record,
    capabilities: { ...record.capabilities },
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}

/**
 * The development/test repository receives only ciphertext from AdminService.
 * Keeping it local also lets API unit tests run before workspace packages emit
 * their dist files.
 */
export class EncryptedMemoryProviderConfigRepository implements ProviderConfigRepository {
  readonly #records = new Map<string, ProviderConfigRecord>();
  readonly #usage: ProviderUsageRecord[] = [];
  #nextId = 1;

  async list(): Promise<readonly ProviderConfigRecord[]> {
    return [...this.#records.values()]
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())
      .map(cloneRecord);
  }

  async upsert(input: UpsertProviderConfig): Promise<ProviderConfigRecord> {
    if (!/^v\d+\./.test(input.encryptedApiKey)) {
      throw new Error('Provider configuration requires an encrypted credential');
    }
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

export async function createProviderConfigRepositoryForEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<ProviderConfigRepository> {
  if (environment.DATABASE_URL?.trim()) {
    // This control-plane adapter is intentionally not loaded by the worker.
    const { createPrismaProviderConfigRepository } = await import('@werewolf/database');
    return createPrismaProviderConfigRepository();
  }
  if (environment.NODE_ENV === 'production') {
    throw new Error('DATABASE_URL is required for provider persistence in production');
  }
  return new EncryptedMemoryProviderConfigRepository();
}
