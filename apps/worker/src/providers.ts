import {
  AiGateway,
  CostGuard,
  DashScopeTranscriptionAdapter,
  PLAYABLE_PROVIDER_IDS,
  createPlayableProviderAdapter,
  playableProviderConfigFromEnvironment,
  type ModelProviderAdapter,
  type ProviderPricing,
  type TranscriptionAdapter,
} from '@werewolf/ai-gateway';

function providerPricing(providerId: string, environment: NodeJS.ProcessEnv): ProviderPricing {
  const prefix = `AI_PRICE_${providerId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const input = Number(environment[`${prefix}_INPUT_CENTS_PER_MILLION`]);
  const output = Number(environment[`${prefix}_OUTPUT_CENTS_PER_MILLION`]);
  return {
    ...(Number.isFinite(input) && input > 0 ? { inputCentsPerMillion: input } : {}),
    ...(Number.isFinite(output) && output > 0 ? { outputCentsPerMillion: output } : {}),
  };
}

export function providersFromEnvironment(options?: {
  readonly maxAttemptsPerProvider?: number;
  readonly environment?: NodeJS.ProcessEnv;
}): {
  readonly gateway: AiGateway;
  readonly transcriptions: ReadonlyMap<string, TranscriptionAdapter>;
  readonly prices: ReadonlyMap<string, ProviderPricing>;
} {
  const environment = options?.environment ?? process.env;
  const providers: ModelProviderAdapter[] = [];
  const transcriptions = new Map<string, TranscriptionAdapter>();
  const prices = new Map<string, ProviderPricing>();
  const priceFor = (providerId: string): ProviderPricing => {
    const pricing = providerPricing(providerId, environment);
    prices.set(providerId, pricing);
    return pricing;
  };

  for (const providerId of PLAYABLE_PROVIDER_IDS) {
    const config = playableProviderConfigFromEnvironment(providerId, environment);
    if (!config) continue;
    providers.push(
      createPlayableProviderAdapter({
        ...config,
        pricing: priceFor(providerId),
      }),
    );
  }

  // DashScope remains available only for speech-to-text. It is not exposed as
  // a playable chat provider.
  if (environment.DASHSCOPE_API_KEY) {
    if (environment.DASHSCOPE_ASR_MODEL) {
      transcriptions.set(
        'dashscope-asr',
        new DashScopeTranscriptionAdapter({
          id: 'dashscope-asr',
          apiKey: environment.DASHSCOPE_API_KEY,
          model: environment.DASHSCOPE_ASR_MODEL,
        }),
      );
    }
  }
  const configuredProcessLimit = environment.AI_PROCESS_BUDGET_CENTS;
  const processLimitCents =
    configuredProcessLimit === undefined || configuredProcessLimit.trim() === ''
      ? undefined
      : Number(configuredProcessLimit);
  const processCostGuard =
    processLimitCents !== undefined && Number.isFinite(processLimitCents) && processLimitCents >= 0
      ? new CostGuard(processLimitCents)
      : undefined;
  return {
    gateway: new AiGateway({
      providers,
      ...(processCostGuard ? { costGuard: processCostGuard } : {}),
      maxAttemptsPerProvider: options?.maxAttemptsPerProvider ?? 2,
    }),
    transcriptions,
    prices,
  };
}
