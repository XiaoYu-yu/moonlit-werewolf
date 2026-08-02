import { describe, expect, it, vi } from 'vitest';
import {
  AI_QUEUE_SCHEDULING_MARGIN_MS,
  assertRuntimeConfiguration,
  configureTrustProxy,
  DEFAULT_API_HOST,
  DEFAULT_AI_MAX_ATTEMPTS_PER_PROVIDER,
  DEFAULT_AI_PROVIDER_TIMEOUT_MS,
  DEFAULT_AI_QUEUE_CONNECT_TIMEOUT_MS,
  DEFAULT_AI_QUEUE_RESULT_TIMEOUT_MS,
  DEFAULT_ROOM_CREATE_RATE_LIMIT,
  MINIMUM_PRODUCTION_ADMIN_KEY_LENGTH,
  minimumAiQueueResultTimeoutMs,
  readApiHost,
  readAiQueueConnectTimeoutMs,
  readAiQueueResultTimeoutMs,
  readRoomCreateRateLimit,
  readTrustProxyHopCount,
} from './runtime-config.js';

describe('API bind host configuration', () => {
  it.each([{}, { NODE_ENV: 'development' }, { NODE_ENV: 'production' }])(
    'defaults to IPv4 loopback for %o',
    (environment) => {
      expect(readApiHost(environment)).toBe('127.0.0.1');
    },
  );

  it.each(['0.0.0.0', '::', '127.0.0.1', '::1'] as const)(
    'accepts an explicit canonical API_HOST=%s',
    (apiHost) => {
      expect(readApiHost({ NODE_ENV: 'production', API_HOST: apiHost })).toBe(apiHost);
    },
  );

  it.each(['localhost', ' 0.0.0.0', '0.0.0.0 ', '192.168.1.20', 'example.test'])(
    'rejects unsafe or ambiguous production API_HOST=%s',
    (apiHost) => {
      expect(() =>
        assertRuntimeConfiguration({
          NODE_ENV: 'production',
          ADMIN_API_KEY: '8f94c21be67a40ddad90a807a0da31bf',
          API_HOST: apiHost,
        }),
      ).toThrow(/API_HOST/);
    },
  );

  it('falls back to loopback for an invalid development host', () => {
    expect(readApiHost({ NODE_ENV: 'development', API_HOST: '192.168.1.20' })).toBe('127.0.0.1');
  });
});

describe('production runtime configuration', () => {
  it('allows development without an administrator key', () => {
    expect(() => assertRuntimeConfiguration({ NODE_ENV: 'development' })).not.toThrow();
  });

  it.each([
    undefined,
    'short',
    'dev-admin-key',
    'replace-with-a-long-random-admin-api-key',
    ` ${'a'.repeat(MINIMUM_PRODUCTION_ADMIN_KEY_LENGTH)} `,
  ])('rejects a missing, weak or placeholder production key: %s', (adminKey) => {
    expect(() =>
      assertRuntimeConfiguration({
        NODE_ENV: 'production',
        ...(adminKey === undefined ? {} : { ADMIN_API_KEY: adminKey }),
      }),
    ).toThrow(/ADMIN_API_KEY/);
  });

  it('accepts a sufficiently long non-placeholder production key', () => {
    expect(
      assertRuntimeConfiguration({
        NODE_ENV: 'production',
        ADMIN_API_KEY: '8f94c21be67a40ddad90a807a0da31bf',
      }),
    ).toEqual({
      apiHost: DEFAULT_API_HOST,
      aiQueueConnectTimeoutMs: DEFAULT_AI_QUEUE_CONNECT_TIMEOUT_MS,
      aiQueueResultTimeoutMs:
        DEFAULT_AI_PROVIDER_TIMEOUT_MS * DEFAULT_AI_MAX_ATTEMPTS_PER_PROVIDER +
        AI_QUEUE_SCHEDULING_MARGIN_MS,
      roomCreateRateLimit: DEFAULT_ROOM_CREATE_RATE_LIMIT,
      trustProxyHopCount: false,
    });
  });
});

describe('AI queue result timeout configuration', () => {
  it('computes the provider-attempt envelope plus a fixed scheduling margin', () => {
    expect(
      minimumAiQueueResultTimeoutMs({
        AI_PROVIDER_TIMEOUT_MS: '10000',
        AI_MAX_ATTEMPTS_PER_PROVIDER: '3',
        AI_FALLBACK_PROVIDER_IDS: 'kimi, glm, kimi, ,',
      }),
    ).toBe(95_000);
  });

  it('raises the default to cover one provider with the full attempt envelope', () => {
    expect(
      minimumAiQueueResultTimeoutMs({
        AI_PROVIDER_TIMEOUT_MS: String(DEFAULT_AI_PROVIDER_TIMEOUT_MS),
        AI_MAX_ATTEMPTS_PER_PROVIDER: String(DEFAULT_AI_MAX_ATTEMPTS_PER_PROVIDER),
      }),
    ).toBe(
      DEFAULT_AI_PROVIDER_TIMEOUT_MS * DEFAULT_AI_MAX_ATTEMPTS_PER_PROVIDER +
        AI_QUEUE_SCHEDULING_MARGIN_MS,
    );
    expect(readAiQueueResultTimeoutMs({})).toBe(
      DEFAULT_AI_PROVIDER_TIMEOUT_MS * DEFAULT_AI_MAX_ATTEMPTS_PER_PROVIDER +
        AI_QUEUE_SCHEDULING_MARGIN_MS,
    );
  });

  it('raises the computed default for unique fallback providers', () => {
    expect(
      readAiQueueResultTimeoutMs({
        AI_FALLBACK_PROVIDER_IDS: 'kimi,glm,kimi',
      }),
    ).toBe(125_000);
  });

  it('accepts an explicit timeout at or above the computed minimum', () => {
    expect(
      readAiQueueResultTimeoutMs({
        NODE_ENV: 'production',
        AI_PROVIDER_TIMEOUT_MS: '10000',
        AI_MAX_ATTEMPTS_PER_PROVIDER: '3',
        AI_FALLBACK_PROVIDER_IDS: 'kimi,glm',
        AI_QUEUE_RESULT_TIMEOUT_MS: '95000',
      }),
    ).toBe(95_000);
  });

  it('fails fast for an explicitly undersized production timeout', () => {
    expect(() =>
      assertRuntimeConfiguration({
        NODE_ENV: 'production',
        ADMIN_API_KEY: '8f94c21be67a40ddad90a807a0da31bf',
        AI_FALLBACK_PROVIDER_IDS: 'kimi,glm',
        AI_QUEUE_RESULT_TIMEOUT_MS: '30000',
      }),
    ).toThrow(/AI_QUEUE_RESULT_TIMEOUT_MS.*125000/);
  });

  it('safely raises an explicitly undersized development timeout', () => {
    expect(
      readAiQueueResultTimeoutMs({
        NODE_ENV: 'development',
        AI_FALLBACK_PROVIDER_IDS: 'kimi',
        AI_QUEUE_RESULT_TIMEOUT_MS: '1000',
      }),
    ).toBe(85_000);
  });

  it.each([
    ['AI_PROVIDER_TIMEOUT_MS', '01'],
    ['AI_MAX_ATTEMPTS_PER_PROVIDER', '2.0'],
    ['AI_QUEUE_RESULT_TIMEOUT_MS', '30e3'],
  ])('rejects non-canonical production %s=%s', (name, value) => {
    expect(() =>
      assertRuntimeConfiguration({
        NODE_ENV: 'production',
        ADMIN_API_KEY: '8f94c21be67a40ddad90a807a0da31bf',
        [name]: value,
      }),
    ).toThrow(new RegExp(name));
  });

  it('falls back to safe defaults for invalid development values', () => {
    expect(
      readAiQueueResultTimeoutMs({
        NODE_ENV: 'development',
        AI_PROVIDER_TIMEOUT_MS: 'eight seconds',
        AI_MAX_ATTEMPTS_PER_PROVIDER: 'two',
        AI_QUEUE_RESULT_TIMEOUT_MS: 'forever',
      }),
    ).toBe(
      DEFAULT_AI_PROVIDER_TIMEOUT_MS * DEFAULT_AI_MAX_ATTEMPTS_PER_PROVIDER +
        AI_QUEUE_SCHEDULING_MARGIN_MS,
    );
  });

  it('conservatively covers the Worker numeric parser during development migration', () => {
    expect(
      readAiQueueResultTimeoutMs({
        NODE_ENV: 'development',
        AI_MAX_ATTEMPTS_PER_PROVIDER: '10e0',
      }),
    ).toBe(205_000);
  });

  it('rejects an unrepresentable timer envelope instead of creating an immediate or hanging timer', () => {
    expect(() =>
      readAiQueueResultTimeoutMs({
        NODE_ENV: 'development',
        AI_PROVIDER_TIMEOUT_MS: '2147483647',
        AI_MAX_ATTEMPTS_PER_PROVIDER: '2',
      }),
    ).toThrow(/exceeds the maximum supported/);
  });
});

describe('AI queue connection timeout configuration', () => {
  it.each([undefined, ''])('uses the bounded default for %s', (configuredTimeout) => {
    expect(
      readAiQueueConnectTimeoutMs({
        ...(configuredTimeout === undefined
          ? {}
          : { AI_QUEUE_CONNECT_TIMEOUT_MS: configuredTimeout }),
      }),
    ).toBe(DEFAULT_AI_QUEUE_CONNECT_TIMEOUT_MS);
  });

  it.each([
    ['1', 1],
    ['1500', 1_500],
    ['2147483647', 2_147_483_647],
  ])('accepts canonical positive AI_QUEUE_CONNECT_TIMEOUT_MS=%s', (configured, expected) => {
    expect(readAiQueueConnectTimeoutMs({ AI_QUEUE_CONNECT_TIMEOUT_MS: configured })).toBe(expected);
  });

  it.each(['0', '-1', '01', '+1500', '1500.0', '15e2', ' 1500', '1500 ', '2147483648'])(
    'rejects invalid production AI_QUEUE_CONNECT_TIMEOUT_MS=%s',
    (configuredTimeout) => {
      expect(() =>
        assertRuntimeConfiguration({
          NODE_ENV: 'production',
          ADMIN_API_KEY: '8f94c21be67a40ddad90a807a0da31bf',
          AI_QUEUE_CONNECT_TIMEOUT_MS: configuredTimeout,
        }),
      ).toThrow(/AI_QUEUE_CONNECT_TIMEOUT_MS/);
    },
  );

  it('falls back to 1500ms for invalid development configuration', () => {
    expect(
      readAiQueueConnectTimeoutMs({
        NODE_ENV: 'development',
        AI_QUEUE_CONNECT_TIMEOUT_MS: '15e2',
      }),
    ).toBe(DEFAULT_AI_QUEUE_CONNECT_TIMEOUT_MS);
  });
});

describe('reverse proxy configuration', () => {
  it.each([undefined, '', '0', 'false'])('disables trust proxy for %s', (trustProxy) => {
    expect(
      readTrustProxyHopCount({
        NODE_ENV: 'production',
        ...(trustProxy === undefined ? {} : { TRUST_PROXY: trustProxy }),
      }),
    ).toBe(false);
  });

  it.each([
    ['1', 1],
    ['2', 2],
    [Number.MAX_SAFE_INTEGER.toString(), Number.MAX_SAFE_INTEGER],
  ])('accepts canonical positive hop count %s', (trustProxy, expected) => {
    expect(readTrustProxyHopCount({ TRUST_PROXY: trustProxy })).toBe(expected);
  });

  it.each(['true', 'loopback', '127.0.0.1', '01', '+1', '1.0', '1e2', ' 1', '1 '])(
    'rejects unsafe production TRUST_PROXY=%s',
    (trustProxy) => {
      expect(() =>
        assertRuntimeConfiguration({
          NODE_ENV: 'production',
          ADMIN_API_KEY: '8f94c21be67a40ddad90a807a0da31bf',
          TRUST_PROXY: trustProxy,
        }),
      ).toThrow(/TRUST_PROXY/);
    },
  );

  it('fails closed when a non-production trust proxy value is invalid', () => {
    expect(readTrustProxyHopCount({ NODE_ENV: 'development', TRUST_PROXY: 'true' })).toBe(false);
  });

  it.each([false, 1] as const)(
    'applies trust proxy value %s through the Express-compatible set interface',
    (trustProxyHopCount) => {
      const set = vi.fn();

      configureTrustProxy({ set }, trustProxyHopCount);

      expect(set).toHaveBeenCalledOnce();
      expect(set).toHaveBeenCalledWith('trust proxy', trustProxyHopCount);
    },
  );
});

describe('room creation rate configuration', () => {
  it.each([undefined, ''])('uses the safe default for %s', (roomCreateRateLimit) => {
    expect(
      readRoomCreateRateLimit({
        ...(roomCreateRateLimit === undefined
          ? {}
          : { ROOM_CREATE_RATE_LIMIT: roomCreateRateLimit }),
      }),
    ).toBe(DEFAULT_ROOM_CREATE_RATE_LIMIT);
  });

  it.each([
    ['1', 1],
    ['8', 8],
    [Number.MAX_SAFE_INTEGER.toString(), Number.MAX_SAFE_INTEGER],
  ])('accepts canonical positive ROOM_CREATE_RATE_LIMIT=%s', (roomCreateRateLimit, expected) => {
    expect(readRoomCreateRateLimit({ ROOM_CREATE_RATE_LIMIT: roomCreateRateLimit })).toBe(expected);
  });

  it.each(['0', 'false', '-1', '01', '+5', '5.0', '5e1', ' 5', '5 '])(
    'uses the safe default for invalid non-production ROOM_CREATE_RATE_LIMIT=%s',
    (roomCreateRateLimit) => {
      expect(
        readRoomCreateRateLimit({
          NODE_ENV: 'development',
          ROOM_CREATE_RATE_LIMIT: roomCreateRateLimit,
        }),
      ).toBe(DEFAULT_ROOM_CREATE_RATE_LIMIT);
    },
  );

  it('fails fast for an invalid production room creation limit', () => {
    expect(() =>
      assertRuntimeConfiguration({
        NODE_ENV: 'production',
        ADMIN_API_KEY: '8f94c21be67a40ddad90a807a0da31bf',
        ROOM_CREATE_RATE_LIMIT: 'unlimited',
      }),
    ).toThrow(/ROOM_CREATE_RATE_LIMIT/);
  });
});
