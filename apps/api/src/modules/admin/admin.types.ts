import type { PlayableProviderId } from '@werewolf/ai-gateway';

export type ProviderKindDto = 'openai-compatible';
export type ProviderRuntimeStatus = 'ready' | 'disabled' | 'missing-credential' | 'error';
export type ProviderConfigSource = 'environment' | 'stored' | 'default';

export interface ProviderUsageSummary {
  readonly providerId: PlayableProviderId;
  readonly calls: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly costCents: number;
  readonly averageLatencyMs: number;
  readonly lastError?: string;
  readonly lastCalledAt?: string;
}

export interface ProviderRecord {
  readonly id: string;
  readonly slug: PlayableProviderId;
  readonly name: string;
  readonly kind: ProviderKindDto;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly source: ProviderConfigSource;
  readonly configured: boolean;
  readonly enabled: boolean;
  readonly status: ProviderRuntimeStatus;
  readonly concurrencyLimit: number;
  readonly timeoutMs: number;
  readonly dailyBudgetCents: number;
  readonly fallbackProviderId?: PlayableProviderId;
  readonly maskedApiKey: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly usage: ProviderUsageSummary;
}

export interface AggregateUsageSummary {
  readonly calls: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly costCents: number;
  readonly averageLatencyMs: number;
  readonly providers: number;
  readonly providerUsage: readonly ProviderUsageSummary[];
}

export interface InviteRecord {
  readonly id: string;
  readonly label: string;
  readonly code: string;
  readonly maxUses: number;
  readonly uses: number;
  readonly expiresAt?: string;
  readonly revoked: boolean;
  readonly createdAt: string;
}
