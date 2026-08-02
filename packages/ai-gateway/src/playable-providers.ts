import { OpenAiCompatibleAdapter } from './providers/openai-compatible.js';
import type { ModelProviderAdapter, ProviderPricing } from './types.js';

export const PLAYABLE_PROVIDER_IDS = ['deepseek', 'kimi'] as const;
export type PlayableProviderId = (typeof PLAYABLE_PROVIDER_IDS)[number];

export type PlayableProviderSource = 'environment' | 'stored' | 'default';

export interface PlayableProviderDefinition {
  readonly id: PlayableProviderId;
  readonly displayName: string;
  readonly defaultBaseUrl: string;
  readonly defaultModelId: string;
  readonly apiKeyEnvironmentVariable: 'DEEPSEEK_API_KEY' | 'KIMI_API_KEY';
  readonly baseUrlEnvironmentVariable: 'DEEPSEEK_BASE_URL' | 'KIMI_BASE_URL';
  readonly modelEnvironmentVariable: 'DEEPSEEK_MODEL' | 'KIMI_MODEL';
}

export interface PlayableProviderRuntimeConfig {
  readonly id: PlayableProviderId;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly modelId: string;
  readonly timeoutMs?: number;
  readonly pricing?: ProviderPricing;
}

export const PLAYABLE_PROVIDER_DEFINITIONS: Readonly<
  Record<PlayableProviderId, PlayableProviderDefinition>
> = {
  deepseek: {
    id: 'deepseek',
    displayName: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModelId: 'deepseek-v4-flash',
    apiKeyEnvironmentVariable: 'DEEPSEEK_API_KEY',
    baseUrlEnvironmentVariable: 'DEEPSEEK_BASE_URL',
    modelEnvironmentVariable: 'DEEPSEEK_MODEL',
  },
  kimi: {
    id: 'kimi',
    displayName: 'Kimi',
    defaultBaseUrl: 'https://api.moonshot.cn/v1',
    defaultModelId: 'kimi-k2.6',
    apiKeyEnvironmentVariable: 'KIMI_API_KEY',
    baseUrlEnvironmentVariable: 'KIMI_BASE_URL',
    modelEnvironmentVariable: 'KIMI_MODEL',
  },
};

export function isPlayableProviderId(value: string): value is PlayableProviderId {
  return (PLAYABLE_PROVIDER_IDS as readonly string[]).includes(value);
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function playableProviderDefaults(
  providerId: PlayableProviderId,
  environment: NodeJS.ProcessEnv = process.env,
): {
  readonly baseUrl: string;
  readonly modelId: string;
} {
  const definition = PLAYABLE_PROVIDER_DEFINITIONS[providerId];
  return {
    baseUrl:
      nonEmpty(environment[definition.baseUrlEnvironmentVariable]) ?? definition.defaultBaseUrl,
    modelId:
      nonEmpty(environment[definition.modelEnvironmentVariable]) ?? definition.defaultModelId,
  };
}

export function playableProviderConfigFromEnvironment(
  providerId: PlayableProviderId,
  environment: NodeJS.ProcessEnv = process.env,
): PlayableProviderRuntimeConfig | undefined {
  const definition = PLAYABLE_PROVIDER_DEFINITIONS[providerId];
  const apiKey = nonEmpty(environment[definition.apiKeyEnvironmentVariable]);
  if (!apiKey) return undefined;
  const defaults = playableProviderDefaults(providerId, environment);
  return {
    id: providerId,
    apiKey,
    ...defaults,
  };
}

/**
 * Creates the only two chat adapters that are playable in v1. Model overrides
 * are provider-local so a fallback never sends a DeepSeek model ID to Kimi (or
 * vice versa).
 */
export function createPlayableProviderAdapter(
  config: PlayableProviderRuntimeConfig,
): ModelProviderAdapter {
  const pricing = config.pricing;
  return new OpenAiCompatibleAdapter({
    id: config.id,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    modelOverride: config.modelId,
    ...(config.timeoutMs !== undefined ? { timeoutOverrideMs: config.timeoutMs } : {}),
    ...(pricing?.inputCentsPerMillion !== undefined
      ? { inputPriceCentsPerMillion: pricing.inputCentsPerMillion }
      : {}),
    ...(pricing?.outputCentsPerMillion !== undefined
      ? { outputPriceCentsPerMillion: pricing.outputCentsPerMillion }
      : {}),
    // Both current playable defaults are reasoning models. A game turn needs a
    // short, bounded JSON decision rather than thousands of hidden reasoning
    // tokens; their public rationale is carried separately in decisionSummary.
    extraBody: { thinking: { type: 'disabled' } },
    // Kimi K2.6 uses its provider-recommended non-thinking temperature.
    ...(config.id === 'kimi'
      ? {
          temperatureOverride: 0.6,
        }
      : {}),
  });
}
