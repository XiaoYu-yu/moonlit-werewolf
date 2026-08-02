export const MINIMUM_PRODUCTION_ADMIN_KEY_LENGTH = 32;
export const DEFAULT_API_HOST = '127.0.0.1';
export const DEFAULT_ROOM_CREATE_RATE_LIMIT = 5;
export const DEFAULT_AI_PROVIDER_TIMEOUT_MS = 20_000;
export const DEFAULT_AI_MAX_ATTEMPTS_PER_PROVIDER = 2;
export const DEFAULT_AI_QUEUE_CONNECT_TIMEOUT_MS = 1_500;
export const DEFAULT_AI_QUEUE_RESULT_TIMEOUT_MS = 30_000;
export const AI_QUEUE_SCHEDULING_MARGIN_MS = 5_000;
const MAXIMUM_TIMER_TIMEOUT_MS = 2_147_483_647;

const API_HOSTS = ['127.0.0.1', '::1', '0.0.0.0', '::'] as const;
export type ApiHost = (typeof API_HOSTS)[number];

export interface RuntimeConfiguration {
  apiHost: ApiHost;
  aiQueueConnectTimeoutMs: number;
  aiQueueResultTimeoutMs: number;
  roomCreateRateLimit: number;
  trustProxyHopCount: number | false;
}

export interface TrustProxyApplication {
  set(setting: 'trust proxy', value: number | false): unknown;
}

const OBVIOUS_ADMIN_KEY_PLACEHOLDERS = [
  'admin',
  'changeme',
  'change-me',
  'dev-admin-key',
  'example',
  'password',
  'placeholder',
  'replace-me',
  'secret',
] as const;

export function readApiHost(environment: NodeJS.ProcessEnv = process.env): ApiHost {
  const rawValue = environment.API_HOST;
  if (rawValue === undefined || rawValue === '') return DEFAULT_API_HOST;

  if ((API_HOSTS as readonly string[]).includes(rawValue)) {
    return rawValue as ApiHost;
  }
  if (environment.NODE_ENV === 'production') {
    throw new Error(`API_HOST must be one of ${API_HOSTS.join(', ')} in production`);
  }
  return DEFAULT_API_HOST;
}

function invalidIntegerConfiguration<TFallback extends number | false>(
  environment: NodeJS.ProcessEnv,
  variableName: 'ROOM_CREATE_RATE_LIMIT' | 'TRUST_PROXY',
  safeFallback: TFallback,
): TFallback {
  if (environment.NODE_ENV === 'production') {
    throw new Error(
      `${variableName} must be a canonical positive integer${
        variableName === 'TRUST_PROXY' ? ', 0, or false' : ''
      } in production`,
    );
  }

  return safeFallback;
}

function parseCanonicalPositiveInteger(rawValue: string | undefined): number | undefined {
  if (!rawValue || !/^[1-9]\d*$/.test(rawValue)) return undefined;

  const value = Number(rawValue);
  return Number.isSafeInteger(value) ? value : undefined;
}

function readCanonicalPositiveInteger(
  environment: NodeJS.ProcessEnv,
  variableName:
    | 'AI_MAX_ATTEMPTS_PER_PROVIDER'
    | 'AI_PROVIDER_TIMEOUT_MS'
    | 'AI_QUEUE_CONNECT_TIMEOUT_MS'
    | 'AI_QUEUE_RESULT_TIMEOUT_MS',
  fallback: number,
): number {
  const rawValue = environment[variableName];
  if (rawValue === undefined || rawValue === '') return fallback;

  const parsed = parseCanonicalPositiveInteger(rawValue);
  if (parsed !== undefined && parsed <= MAXIMUM_TIMER_TIMEOUT_MS) return parsed;
  if (environment.NODE_ENV === 'production') {
    throw new Error(
      `${variableName} must be a canonical positive integer no greater than ${MAXIMUM_TIMER_TIMEOUT_MS} in production`,
    );
  }
  return fallback;
}

function configuredFallbackProviderCount(environment: NodeJS.ProcessEnv): number {
  return new Set(
    (environment.AI_FALLBACK_PROVIDER_IDS ?? '')
      .split(',')
      .map((providerId) => providerId.trim())
      .filter(Boolean),
  ).size;
}

export function readAiProviderTimeoutMs(environment: NodeJS.ProcessEnv = process.env): number {
  return readCanonicalPositiveInteger(
    environment,
    'AI_PROVIDER_TIMEOUT_MS',
    DEFAULT_AI_PROVIDER_TIMEOUT_MS,
  );
}

export function readAiMaxAttemptsPerProvider(environment: NodeJS.ProcessEnv = process.env): number {
  return readCanonicalPositiveInteger(
    environment,
    'AI_MAX_ATTEMPTS_PER_PROVIDER',
    DEFAULT_AI_MAX_ATTEMPTS_PER_PROVIDER,
  );
}

export function readAiQueueConnectTimeoutMs(environment: NodeJS.ProcessEnv = process.env): number {
  return readCanonicalPositiveInteger(
    environment,
    'AI_QUEUE_CONNECT_TIMEOUT_MS',
    DEFAULT_AI_QUEUE_CONNECT_TIMEOUT_MS,
  );
}

export function minimumAiQueueResultTimeoutMs(
  environment: NodeJS.ProcessEnv = process.env,
): number {
  const providerTimeoutMs = readAiProviderTimeoutMs(environment);
  let maxAttemptsPerProvider = readAiMaxAttemptsPerProvider(environment);
  if (
    environment.NODE_ENV !== 'production' &&
    parseCanonicalPositiveInteger(environment.AI_MAX_ATTEMPTS_PER_PROVIDER) === undefined
  ) {
    // The Worker currently accepts any positive safe integer after Number()
    // conversion. Conservatively cover that development-only legacy value so
    // the API never times out before the Worker's possible attempts finish.
    const workerCompatibleValue = Number(environment.AI_MAX_ATTEMPTS_PER_PROVIDER);
    if (Number.isSafeInteger(workerCompatibleValue) && workerCompatibleValue > 0) {
      maxAttemptsPerProvider = Math.max(maxAttemptsPerProvider, workerCompatibleValue);
    }
  }
  // The primary provider is not known until a seat acts, so adding one to the
  // unique configured fallbacks is the conservative candidate-provider count.
  const candidateProviderCount = configuredFallbackProviderCount(environment) + 1;
  const minimumTimeoutMs =
    providerTimeoutMs * maxAttemptsPerProvider * candidateProviderCount +
    AI_QUEUE_SCHEDULING_MARGIN_MS;

  if (!Number.isSafeInteger(minimumTimeoutMs) || minimumTimeoutMs > MAXIMUM_TIMER_TIMEOUT_MS) {
    throw new Error(
      'AI provider timeout envelope exceeds the maximum supported queue result timeout',
    );
  }
  return minimumTimeoutMs;
}

export function readAiQueueResultTimeoutMs(environment: NodeJS.ProcessEnv = process.env): number {
  const minimumTimeoutMs = minimumAiQueueResultTimeoutMs(environment);
  const defaultTimeoutMs = Math.max(DEFAULT_AI_QUEUE_RESULT_TIMEOUT_MS, minimumTimeoutMs);
  const rawValue = environment.AI_QUEUE_RESULT_TIMEOUT_MS;
  if (rawValue === undefined || rawValue === '') return defaultTimeoutMs;

  const configuredTimeoutMs = readCanonicalPositiveInteger(
    environment,
    'AI_QUEUE_RESULT_TIMEOUT_MS',
    defaultTimeoutMs,
  );
  if (configuredTimeoutMs >= minimumTimeoutMs) return configuredTimeoutMs;
  if (environment.NODE_ENV === 'production') {
    throw new Error(
      `AI_QUEUE_RESULT_TIMEOUT_MS must be at least ${minimumTimeoutMs} to cover all configured provider attempts in production`,
    );
  }
  return minimumTimeoutMs;
}

export function readTrustProxyHopCount(
  environment: NodeJS.ProcessEnv = process.env,
): number | false {
  const rawValue = environment.TRUST_PROXY;
  if (rawValue === undefined || rawValue === '' || rawValue === '0' || rawValue === 'false') {
    return false;
  }

  return (
    parseCanonicalPositiveInteger(rawValue) ??
    invalidIntegerConfiguration(environment, 'TRUST_PROXY', false)
  );
}

export function readRoomCreateRateLimit(environment: NodeJS.ProcessEnv = process.env): number {
  const rawValue = environment.ROOM_CREATE_RATE_LIMIT;
  if (rawValue === undefined || rawValue === '') return DEFAULT_ROOM_CREATE_RATE_LIMIT;

  return (
    parseCanonicalPositiveInteger(rawValue) ??
    invalidIntegerConfiguration(
      environment,
      'ROOM_CREATE_RATE_LIMIT',
      DEFAULT_ROOM_CREATE_RATE_LIMIT,
    )
  );
}

export function readRuntimeConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfiguration {
  return {
    apiHost: readApiHost(environment),
    aiQueueConnectTimeoutMs: readAiQueueConnectTimeoutMs(environment),
    aiQueueResultTimeoutMs: readAiQueueResultTimeoutMs(environment),
    roomCreateRateLimit: readRoomCreateRateLimit(environment),
    trustProxyHopCount: readTrustProxyHopCount(environment),
  };
}

export function configureTrustProxy(
  application: TrustProxyApplication,
  trustProxyHopCount: number | false,
): void {
  application.set('trust proxy', trustProxyHopCount);
}

export function assertRuntimeConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): RuntimeConfiguration {
  const configuration = readRuntimeConfiguration(environment);
  if (environment.NODE_ENV !== 'production') return configuration;

  const rawKey = environment.ADMIN_API_KEY;
  const key = rawKey?.trim() ?? '';
  const lower = key.toLowerCase();
  const isPlaceholder =
    OBVIOUS_ADMIN_KEY_PLACEHOLDERS.some(
      (placeholder) => lower === placeholder || lower.includes(placeholder),
    ) ||
    /^(?:your|replace|change)[-_ ]/.test(lower) ||
    /^x+$/.test(lower);

  if (
    !rawKey ||
    rawKey !== key ||
    key.length < MINIMUM_PRODUCTION_ADMIN_KEY_LENGTH ||
    isPlaceholder
  ) {
    throw new Error(
      `ADMIN_API_KEY must be a non-placeholder secret of at least ${MINIMUM_PRODUCTION_ADMIN_KEY_LENGTH} characters in production`,
    );
  }

  return configuration;
}
