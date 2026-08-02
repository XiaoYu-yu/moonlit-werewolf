import {
  AiGateway,
  CostGuard,
  PLAYABLE_PROVIDER_DEFINITIONS,
  PLAYABLE_PROVIDER_IDS,
  ProviderCallRejectedError,
  createPlayableProviderAdapter,
  estimateChatRequestCostCents,
  fallbackAiTurnResult,
  isPlayableProviderId,
  playableProviderDefaults,
  type AiTurnJobData,
  type AiTurnJobResult,
  type ChatCompletionRequest,
  type ChatCompletionResult,
  type ModelProviderAdapter,
  type PlayableProviderId,
  type ProviderPricing,
} from '@werewolf/ai-gateway';
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  type AppendProviderUsage,
  type ProviderConfigRecord,
  type ProviderConfigRepository,
  type ProviderUsageRecord,
  type UpsertProviderConfig,
} from '@werewolf/database';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  readAiMaxAttemptsPerProvider,
  readAiProviderTimeoutMs,
} from '../../common/runtime-config.js';
import type { CreateInviteDto, CreateProviderDto, UpdateProviderDto } from './admin.dto.js';
import type {
  AggregateUsageSummary,
  InviteRecord,
  ProviderRecord,
  ProviderUsageSummary,
} from './admin.types.js';
import {
  ProviderSecretCipher,
  createProviderSecretCipherFromEnv,
} from './provider-secret-cipher.js';
import {
  EncryptedMemoryProviderConfigRepository,
  PROVIDER_CONFIG_REPOSITORY,
} from './provider-config.repository.js';

const DEFAULT_PROVIDER_CONCURRENCY = 4;
const PROVIDER_ERROR_LIMIT = 300;

interface ResolvedProvider {
  readonly id: PlayableProviderId;
  readonly record?: ProviderConfigRecord;
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly configured: boolean;
  readonly desiredEnabled: boolean;
  readonly enabled: boolean;
  readonly source: 'environment' | 'stored' | 'default';
  readonly concurrencyLimit: number;
  readonly timeoutMs: number;
  readonly dailyBudgetCents: number;
  readonly configurationError?: string;
}

interface DirectProviderBudget {
  readonly dayKey: string;
  spentCents: number;
}

function positiveNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function processCostGuard(): CostGuard | undefined {
  const raw = process.env.AI_PROCESS_BUDGET_CENTS;
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? new CostGuard(value) : undefined;
}

function beijingDayStart(now = new Date()): Date {
  const shifted = new Date(now.getTime() + 8 * 60 * 60 * 1_000);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) -
      8 * 60 * 60 * 1_000,
  );
}

function emptyUsage(providerId: PlayableProviderId): ProviderUsageSummary {
  return {
    providerId,
    calls: 0,
    succeeded: 0,
    failed: 0,
    costCents: 0,
    averageLatencyMs: 0,
  };
}

@Injectable()
export class AdminService implements OnModuleDestroy {
  readonly #invites = new Map<string, InviteRecord>();
  readonly #usageFallback: ProviderUsageRecord[] = [];
  readonly #directCostGuard = processCostGuard();
  readonly #directProviderInFlight = new Map<PlayableProviderId, number>();
  readonly #directProviderBudgets = new Map<PlayableProviderId, DirectProviderBudget>();
  #directBudgetInitialization:
    | {
        readonly dayKey: string;
        readonly promise: Promise<void>;
      }
    | undefined;

  constructor(
    @Inject(PROVIDER_CONFIG_REPOSITORY)
    private readonly providerRepository: ProviderConfigRepository = new EncryptedMemoryProviderConfigRepository(),
    @Inject(ProviderSecretCipher)
    private readonly providerCipher: ProviderSecretCipher = createProviderSecretCipherFromEnv(),
  ) {
    const developmentCode = process.env.DEV_INVITE_CODE;
    if (developmentCode && process.env.NODE_ENV !== 'production') {
      const invite: InviteRecord = {
        id: randomUUID(),
        label: 'Development',
        code: developmentCode,
        maxUses: 10_000,
        uses: 0,
        revoked: false,
        createdAt: new Date().toISOString(),
      };
      this.#invites.set(invite.id, invite);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.providerRepository.disconnect?.();
  }

  async listProviders(): Promise<readonly ProviderRecord[]> {
    const [providers, usage] = await Promise.all([
      this.resolveProviders(),
      this.providerUsageSummary(),
    ]);
    const readyIds = providers
      .filter((provider) => provider.enabled)
      .map((provider) => provider.id);

    return providers.map((provider) => {
      const definition = PLAYABLE_PROVIDER_DEFINITIONS[provider.id];
      const fallbackProviderId = readyIds.find((id) => id !== provider.id);
      const status = provider.configurationError
        ? ('error' as const)
        : !provider.configured
          ? ('missing-credential' as const)
          : provider.enabled
            ? ('ready' as const)
            : ('disabled' as const);

      return {
        id: provider.record?.id ?? `runtime-${provider.id}`,
        slug: provider.id,
        name: definition.displayName,
        kind: 'openai-compatible',
        baseUrl: provider.baseUrl,
        modelId: provider.modelId,
        source: provider.source,
        configured: provider.configured,
        enabled: provider.enabled,
        status,
        concurrencyLimit: provider.concurrencyLimit,
        timeoutMs: provider.timeoutMs,
        dailyBudgetCents: provider.dailyBudgetCents,
        ...(fallbackProviderId ? { fallbackProviderId } : {}),
        maskedApiKey: provider.apiKey ? this.maskKey(provider.apiKey) : '',
        ...(provider.record
          ? {
              createdAt: provider.record.createdAt.toISOString(),
              updatedAt: provider.record.updatedAt.toISOString(),
            }
          : {}),
        usage: usage.get(provider.id) ?? emptyUsage(provider.id),
      };
    });
  }

  async createProvider(dto: CreateProviderDto): Promise<ProviderRecord> {
    const normalized = dto.slug ?? this.providerSlug(dto.name);
    if (!isPlayableProviderId(normalized)) {
      throw new BadRequestException('Only DeepSeek and Kimi providers are supported');
    }
    const definition = PLAYABLE_PROVIDER_DEFINITIONS[normalized];
    await this.providerRepository.upsert({
      slug: normalized,
      displayName: definition.displayName,
      kind: 'openai-compatible',
      baseUrl: dto.baseUrl,
      encryptedApiKey: this.providerCipher.encrypt(dto.apiKey),
      enabled: dto.enabled ?? false,
      concurrencyLimit: dto.concurrencyLimit ?? DEFAULT_PROVIDER_CONCURRENCY,
      timeoutMs: dto.timeoutMs ?? readAiProviderTimeoutMs(),
      dailyBudgetCents: dto.dailyBudgetCents ?? 0,
      capabilities: { chat: true },
    });
    return this.requireProvider(normalized);
  }

  async updateProvider(providerId: string, dto: UpdateProviderDto): Promise<ProviderRecord> {
    if (!isPlayableProviderId(providerId)) {
      throw new NotFoundException('Provider does not exist');
    }
    const [resolved] = (await this.resolveProviders()).filter((item) => item.id === providerId);
    if (!resolved) throw new NotFoundException('Provider does not exist');
    const apiKey = dto.apiKey?.trim() || resolved.apiKey;
    if (!apiKey) {
      throw new BadRequestException(
        'An API key is required before this provider can be configured',
      );
    }
    const definition = PLAYABLE_PROVIDER_DEFINITIONS[providerId];
    await this.providerRepository.upsert({
      slug: providerId,
      displayName: definition.displayName,
      kind: 'openai-compatible',
      baseUrl: dto.baseUrl ?? resolved.baseUrl,
      encryptedApiKey: this.providerCipher.encrypt(apiKey),
      enabled: dto.enabled ?? resolved.desiredEnabled,
      concurrencyLimit: dto.concurrencyLimit ?? resolved.concurrencyLimit,
      timeoutMs: dto.timeoutMs ?? resolved.timeoutMs,
      dailyBudgetCents: dto.dailyBudgetCents ?? resolved.dailyBudgetCents,
      capabilities: { chat: true },
    });
    return this.requireProvider(providerId);
  }

  /**
   * Infrastructure-free local path. The same structured-output gateway and
   * legal deterministic fallback are used as the Worker path, but no Redis is
   * required.
   */
  async executeAiTurnDirect(data: AiTurnJobData): Promise<AiTurnJobResult> {
    await this.ensureDirectBudgetDay();
    const providers = (await this.resolveProviders()).filter(
      (provider): provider is ResolvedProvider & { apiKey: string } =>
        provider.enabled && provider.apiKey !== undefined,
    );
    if (providers.length === 0) {
      return fallbackAiTurnResult(
        data.fallbackAction,
        'No enabled Kimi or DeepSeek credential is configured',
      );
    }

    const requestedPrimary = isPlayableProviderId(data.primaryProviderId)
      ? data.primaryProviderId
      : undefined;
    const primaryProviderId =
      providers.find((provider) => provider.id === requestedPrimary)?.id ?? providers[0]?.id;
    if (!primaryProviderId) {
      return fallbackAiTurnResult(data.fallbackAction, 'No playable AI provider is available');
    }

    const requestedFallbacks = (data.fallbackProviderIds ?? []).filter(isPlayableProviderId);
    const fallbackProviderIds = [
      ...requestedFallbacks,
      ...providers.map((provider) => provider.id),
    ].filter(
      (providerId, index, all) =>
        providerId !== primaryProviderId &&
        providers.some((provider) => provider.id === providerId) &&
        all.indexOf(providerId) === index,
    );
    const gateway = new AiGateway({
      providers: providers.map((provider) => this.createDirectProvider(provider)),
      ...(this.#directCostGuard ? { costGuard: this.#directCostGuard } : {}),
      maxAttemptsPerProvider: readAiMaxAttemptsPerProvider(),
    });
    const result = await gateway.executeTurn({
      primaryProviderId,
      ...(fallbackProviderIds.length > 0 ? { fallbackProviderIds } : {}),
      request: data.request,
      actionType: data.actionType,
      ...(data.allowedSeatIds ? { allowedSeatIds: data.allowedSeatIds } : {}),
      ...(data.requireDecisionSummary
        ? { requireDecisionSummary: data.requireDecisionSummary }
        : {}),
      ...(data.requireVisibleAnalysis
        ? { requireVisibleAnalysis: data.requireVisibleAnalysis }
        : {}),
      deterministicFallback: () => data.fallbackAction,
    });
    await this.recordAiTurnResult(result);
    return result;
  }

  async recordAiTurnResult(result: AiTurnJobResult): Promise<void> {
    for (const attempt of result.providerAttempts ?? []) {
      if (!isPlayableProviderId(attempt.providerId)) continue;
      const usage: AppendProviderUsage = {
        providerId: attempt.providerId,
        succeeded: attempt.succeeded,
        durationMs: Math.max(0, Math.round(attempt.durationMs)),
        costCents: Math.max(0, attempt.costCents),
        ...(attempt.inputTokens !== undefined
          ? { inputTokens: Math.max(0, Math.round(attempt.inputTokens)) }
          : {}),
        ...(attempt.outputTokens !== undefined
          ? { outputTokens: Math.max(0, Math.round(attempt.outputTokens)) }
          : {}),
        ...(attempt.error ? { error: this.sanitizeProviderError(attempt.error) } : {}),
      };
      if (this.providerRepository.appendUsage) {
        try {
          await this.providerRepository.appendUsage(usage);
          continue;
        } catch {
          // A metrics write must never block or invalidate an otherwise legal
          // game action. Retain the truthful sample in process memory.
        }
      }
      this.#usageFallback.push({ ...usage, createdAt: new Date() });
    }
  }

  listInvites(): readonly InviteRecord[] {
    return [...this.#invites.values()];
  }

  createInvite(dto: CreateInviteDto): InviteRecord {
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())) {
      throw new BadRequestException('expiresAt must be a future ISO date');
    }
    const record: InviteRecord = {
      id: randomUUID(),
      label: dto.label,
      code: randomBytes(6).toString('base64url').toUpperCase(),
      maxUses: dto.maxUses,
      uses: 0,
      ...(expiresAt ? { expiresAt: expiresAt.toISOString() } : {}),
      revoked: false,
      createdAt: new Date().toISOString(),
    };
    this.#invites.set(record.id, record);
    return record;
  }

  consumeInvite(code: string): void {
    const invite = [...this.#invites.values()].find((item) => item.code === code);
    if (!invite) throw new NotFoundException('Invite code does not exist');
    if (
      invite.revoked ||
      invite.uses >= invite.maxUses ||
      (invite.expiresAt && new Date(invite.expiresAt) <= new Date())
    ) {
      throw new BadRequestException('Invite code is no longer valid');
    }
    this.#invites.set(invite.id, { ...invite, uses: invite.uses + 1 });
  }

  async usageSummary(): Promise<AggregateUsageSummary> {
    const usage = await this.providerUsageSummary();
    const providerUsage = PLAYABLE_PROVIDER_IDS.map(
      (providerId) => usage.get(providerId) ?? emptyUsage(providerId),
    );
    const calls = providerUsage.reduce((sum, item) => sum + item.calls, 0);
    const totalDuration = providerUsage.reduce(
      (sum, item) => sum + item.averageLatencyMs * item.calls,
      0,
    );
    return {
      calls,
      succeeded: providerUsage.reduce((sum, item) => sum + item.succeeded, 0),
      failed: providerUsage.reduce((sum, item) => sum + item.failed, 0),
      costCents: providerUsage.reduce((sum, item) => sum + item.costCents, 0),
      averageLatencyMs: calls > 0 ? Math.round(totalDuration / calls) : 0,
      providers: PLAYABLE_PROVIDER_IDS.length,
      providerUsage,
    };
  }

  private async resolveProviders(): Promise<readonly ResolvedProvider[]> {
    const records = await this.providerRepository.list();
    const bySlug = new Map(
      records
        .filter((record) => isPlayableProviderId(record.slug))
        .map((record) => [record.slug as PlayableProviderId, record]),
    );

    return Promise.all(
      PLAYABLE_PROVIDER_IDS.map(async (providerId): Promise<ResolvedProvider> => {
        const definition = PLAYABLE_PROVIDER_DEFINITIONS[providerId];
        const defaults = playableProviderDefaults(providerId);
        const record = bySlug.get(providerId);
        const environmentApiKey = process.env[definition.apiKeyEnvironmentVariable]?.trim();
        let apiKey: string | undefined;
        let configurationError: string | undefined;

        if (record) {
          try {
            const secret = this.providerCipher.decryptAndRotate(record.encryptedApiKey);
            apiKey = secret.plaintext;
            if (secret.rotated) {
              await this.providerRepository.upsert({
                ...this.toUpsert(record),
                encryptedApiKey: secret.ciphertext,
              });
            }
          } catch {
            configurationError = 'Stored credential could not be decrypted';
          }
        } else {
          apiKey = environmentApiKey || undefined;
        }

        const desiredEnabled = record?.enabled ?? apiKey !== undefined;
        return {
          id: providerId,
          ...(record ? { record } : {}),
          ...(apiKey ? { apiKey } : {}),
          baseUrl: record?.baseUrl ?? defaults.baseUrl,
          modelId: defaults.modelId,
          configured: apiKey !== undefined && !configurationError,
          desiredEnabled,
          enabled: desiredEnabled && apiKey !== undefined && !configurationError,
          source: record ? 'stored' : apiKey ? 'environment' : 'default',
          concurrencyLimit: record?.concurrencyLimit ?? DEFAULT_PROVIDER_CONCURRENCY,
          timeoutMs: record?.timeoutMs ?? readAiProviderTimeoutMs(),
          dailyBudgetCents:
            record?.dailyBudgetCents ?? Math.max(0, Number(process.env.AI_DAILY_BUDGET_CENTS) || 0),
          ...(configurationError ? { configurationError } : {}),
        };
      }),
    );
  }

  private async providerUsageSummary(): Promise<
    ReadonlyMap<PlayableProviderId, ProviderUsageSummary>
  > {
    const since = beijingDayStart();
    let persisted: readonly ProviderUsageRecord[] = [];
    if (this.providerRepository.listUsage) {
      try {
        persisted = await this.providerRepository.listUsage(since);
      } catch {
        persisted = [];
      }
    }
    const records = [
      ...persisted,
      ...this.#usageFallback.filter((item) => item.createdAt >= since),
    ];
    const summary = new Map<PlayableProviderId, ProviderUsageSummary>();

    for (const providerId of PLAYABLE_PROVIDER_IDS) {
      const calls = records.filter((item) => item.providerId === providerId);
      const latestError = [...calls].reverse().find((item) => !item.succeeded && item.error);
      const latestCall = calls.at(-1);
      summary.set(providerId, {
        providerId,
        calls: calls.length,
        succeeded: calls.filter((item) => item.succeeded).length,
        failed: calls.filter((item) => !item.succeeded).length,
        costCents: calls.reduce((sum, item) => sum + item.costCents, 0),
        averageLatencyMs:
          calls.length > 0
            ? Math.round(
                calls.reduce((sum, item) => sum + Math.max(0, item.durationMs), 0) / calls.length,
              )
            : 0,
        ...(latestError?.error ? { lastError: latestError.error } : {}),
        ...(latestCall ? { lastCalledAt: latestCall.createdAt.toISOString() } : {}),
      });
    }
    return summary;
  }

  private async ensureDirectBudgetDay(): Promise<void> {
    const dayKey = beijingDayStart().toISOString();
    if (this.#directBudgetInitialization?.dayKey !== dayKey) {
      const promise = this.providerUsageSummary().then((usage) => {
        for (const providerId of PLAYABLE_PROVIDER_IDS) {
          this.#directProviderBudgets.set(providerId, {
            dayKey,
            spentCents: usage.get(providerId)?.costCents ?? 0,
          });
        }
      });
      this.#directBudgetInitialization = { dayKey, promise };
    }
    await this.#directBudgetInitialization.promise;
  }

  private createDirectProvider(
    provider: ResolvedProvider & { apiKey: string },
  ): ModelProviderAdapter {
    const pricing = this.providerPricing(provider.id);
    const delegate = createPlayableProviderAdapter({
      id: provider.id,
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      modelId: provider.modelId,
      timeoutMs: provider.timeoutMs,
      pricing,
    });
    return {
      id: delegate.id,
      ...(delegate.modelId ? { modelId: delegate.modelId } : {}),
      kind: delegate.kind,
      capabilities: delegate.capabilities,
      complete: (request, signal) =>
        this.completeDirectProvider(provider, delegate, pricing, request, signal),
    };
  }

  private async completeDirectProvider(
    provider: ResolvedProvider,
    delegate: ModelProviderAdapter,
    pricing: ProviderPricing,
    request: ChatCompletionRequest,
    signal?: AbortSignal,
  ): Promise<ChatCompletionResult> {
    const inFlight = this.#directProviderInFlight.get(provider.id) ?? 0;
    if (inFlight >= provider.concurrencyLimit) {
      throw new ProviderCallRejectedError(
        `Provider ${provider.id} concurrency limit is reached`,
        provider.id,
      );
    }

    const budget = this.#directProviderBudgets.get(provider.id);
    const minimumReservation = positiveNumber(process.env.AI_MIN_RESERVATION_CENTS) ?? 1;
    const reservedCents =
      provider.dailyBudgetCents > 0
        ? estimateChatRequestCostCents(request, pricing, minimumReservation)
        : 0;
    if (
      provider.dailyBudgetCents > 0 &&
      (!budget || budget.spentCents + reservedCents > provider.dailyBudgetCents)
    ) {
      throw new ProviderCallRejectedError(
        `Provider ${provider.id} daily budget is exhausted`,
        provider.id,
      );
    }

    if (budget && reservedCents > 0) budget.spentCents += reservedCents;
    this.#directProviderInFlight.set(provider.id, inFlight + 1);
    try {
      const result = await delegate.complete(request, signal);
      if (budget && reservedCents > 0) {
        const actual =
          result.costCents !== undefined &&
          Number.isFinite(result.costCents) &&
          result.costCents >= 0
            ? result.costCents
            : reservedCents;
        budget.spentCents = Math.max(0, budget.spentCents - reservedCents + actual);
      }
      return result;
    } finally {
      const remaining = Math.max(0, (this.#directProviderInFlight.get(provider.id) ?? 1) - 1);
      if (remaining === 0) this.#directProviderInFlight.delete(provider.id);
      else this.#directProviderInFlight.set(provider.id, remaining);
    }
  }

  private async requireProvider(providerId: PlayableProviderId): Promise<ProviderRecord> {
    const provider = (await this.listProviders()).find((item) => item.slug === providerId);
    if (!provider) throw new NotFoundException('Provider does not exist');
    return provider;
  }

  private toUpsert(record: ProviderConfigRecord): UpsertProviderConfig {
    return {
      slug: record.slug,
      displayName: record.displayName,
      kind: record.kind,
      baseUrl: record.baseUrl,
      encryptedApiKey: record.encryptedApiKey,
      enabled: record.enabled,
      concurrencyLimit: record.concurrencyLimit,
      timeoutMs: record.timeoutMs,
      dailyBudgetCents: record.dailyBudgetCents,
      capabilities: record.capabilities,
    };
  }

  private providerPricing(providerId: PlayableProviderId): ProviderPricing {
    const prefix = `AI_PRICE_${providerId.toUpperCase()}_`;
    const input = positiveNumber(process.env[`${prefix}INPUT_CENTS_PER_MILLION`]);
    const output = positiveNumber(process.env[`${prefix}OUTPUT_CENTS_PER_MILLION`]);
    return {
      ...(input !== undefined ? { inputCentsPerMillion: input } : {}),
      ...(output !== undefined ? { outputCentsPerMillion: output } : {}),
    };
  }

  private providerSlug(name: string): string {
    const normalized = name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
    return normalized || `provider-${createHash('sha256').update(name).digest('hex').slice(0, 12)}`;
  }

  private maskKey(value: string): string {
    return value.length <= 8
      ? '********'
      : `${value.slice(0, 3)}${'*'.repeat(Math.min(16, value.length - 6))}${value.slice(-3)}`;
  }

  private sanitizeProviderError(value: string): string {
    return value
      .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, '[redacted]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, PROVIDER_ERROR_LIMIT);
  }
}
