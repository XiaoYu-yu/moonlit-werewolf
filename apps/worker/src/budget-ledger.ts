import { createHash } from 'node:crypto';
import {
  estimateChatRequestCostCents,
  type AiTurnJobData,
  type ProviderPricing,
} from '@werewolf/ai-gateway';

const COST_UNIT_SCALE = 1_000;
const DAY_MS = 86_400_000;
const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000;
const REDIS_KEY_PREFIX = 'werewolf:{ai-budget}';

export const RESERVE_BUDGET_LUA = `
-- werewolf-ai-budget-reserve-v1
local amount = tonumber(ARGV[1])
local daily_limit = tonumber(ARGV[2])
local match_limit = tonumber(ARGV[3])
local daily_ttl = tonumber(ARGV[4])
local match_ttl = tonumber(ARGV[5])
local reservation_ttl = tonumber(ARGV[6])

local state = redis.call('HGET', KEYS[3], 'state')
if state then
  local existing = tonumber(redis.call('HGET', KEYS[3], 'reserved') or '-1')
  local original_daily_key = redis.call('HGET', KEYS[3], 'daily_key')
  local original_match_key = redis.call('HGET', KEYS[3], 'match_key')
  if not original_daily_key or not original_match_key then
    return {-2, 'missing-scope'}
  end
  if original_match_key ~= KEYS[2] then
    return {-3, 'match-scope-mismatch'}
  end
  if state == 'active' and existing ~= amount then
    return {-4, 'amount-mismatch'}
  end
  return {2, state, original_daily_key, original_match_key}
end

local daily = tonumber(redis.call('GET', KEYS[1]) or '0')
local match = tonumber(redis.call('GET', KEYS[2]) or '0')
if daily + amount > daily_limit then
  return {0, 'daily', daily}
end
if match + amount > match_limit then
  return {0, 'match', match}
end

local next_daily = redis.call('INCRBY', KEYS[1], amount)
local next_match = redis.call('INCRBY', KEYS[2], amount)
redis.call('EXPIRE', KEYS[1], daily_ttl)
redis.call('EXPIRE', KEYS[2], match_ttl)
redis.call(
  'HSET',
  KEYS[3],
  'state',
  'active',
  'reserved',
  amount,
  'daily_key',
  KEYS[1],
  'match_key',
  KEYS[2]
)
redis.call('EXPIRE', KEYS[3], reservation_ttl)
return {1, next_daily, next_match}
`;

export const SETTLE_BUDGET_LUA = `
-- werewolf-ai-budget-settle-v1
local actual = tonumber(ARGV[1])
local daily_ttl = tonumber(ARGV[2])
local match_ttl = tonumber(ARGV[3])
local reservation_ttl = tonumber(ARGV[4])
local state = redis.call('HGET', KEYS[3], 'state')
if not state then
  return {-1, 'missing'}
end
local original_daily_key = redis.call('HGET', KEYS[3], 'daily_key')
local original_match_key = redis.call('HGET', KEYS[3], 'match_key')
if original_daily_key ~= KEYS[1] or original_match_key ~= KEYS[2] then
  return {-3, 'scope-mismatch'}
end
if state == 'settled' then
  return {2, tonumber(redis.call('HGET', KEYS[3], 'actual') or '0')}
end
if state ~= 'active' then
  return {-2, state}
end

local reserved = tonumber(redis.call('HGET', KEYS[3], 'reserved') or '0')
local delta = actual - reserved
if redis.call('EXISTS', KEYS[1]) == 1 and delta ~= 0 then
  redis.call('INCRBY', KEYS[1], delta)
  redis.call('EXPIRE', KEYS[1], daily_ttl)
end
if redis.call('EXISTS', KEYS[2]) == 1 and delta ~= 0 then
  redis.call('INCRBY', KEYS[2], delta)
  redis.call('EXPIRE', KEYS[2], match_ttl)
end
redis.call('HSET', KEYS[3], 'state', 'settled', 'actual', actual)
redis.call('EXPIRE', KEYS[3], reservation_ttl)
return {1, actual}
`;

export const RELEASE_BUDGET_LUA = `
-- werewolf-ai-budget-release-v1
local daily_ttl = tonumber(ARGV[1])
local match_ttl = tonumber(ARGV[2])
local reservation_ttl = tonumber(ARGV[3])
local state = redis.call('HGET', KEYS[3], 'state')
if not state then
  return {0, 'missing'}
end
local original_daily_key = redis.call('HGET', KEYS[3], 'daily_key')
local original_match_key = redis.call('HGET', KEYS[3], 'match_key')
if original_daily_key ~= KEYS[1] or original_match_key ~= KEYS[2] then
  return {-2, 'scope-mismatch'}
end
if state == 'released' then
  return {2, 0}
end
if state ~= 'active' then
  return {-1, state}
end

local reserved = tonumber(redis.call('HGET', KEYS[3], 'reserved') or '0')
if redis.call('EXISTS', KEYS[1]) == 1 and reserved ~= 0 then
  redis.call('INCRBY', KEYS[1], -reserved)
  redis.call('EXPIRE', KEYS[1], daily_ttl)
end
if redis.call('EXISTS', KEYS[2]) == 1 and reserved ~= 0 then
  redis.call('INCRBY', KEYS[2], -reserved)
  redis.call('EXPIRE', KEYS[2], match_ttl)
end
redis.call('HSET', KEYS[3], 'state', 'released')
redis.call('EXPIRE', KEYS[3], reservation_ttl)
return {1, reserved}
`;

export interface RedisEvalClient {
  eval(
    script: string,
    numberOfKeys: number,
    ...args: readonly (string | number)[]
  ): Promise<unknown>;
}

export type BudgetScope = 'daily' | 'match';
export type BudgetReservationState = 'active' | 'settled' | 'released';

export interface BudgetReservation {
  readonly id: string;
  readonly amountCents: number;
  readonly dailyKey: string;
  readonly matchKey: string;
  readonly reservationKey: string;
  readonly dailyTtlSeconds: number;
  readonly matchTtlSeconds: number;
  readonly reservationTtlSeconds: number;
}

export interface ReserveBudgetInput {
  readonly reservationId: string;
  readonly matchId: string;
  readonly dayKey: string;
  readonly amountCents: number;
  readonly dailyLimitCents: number;
  readonly matchLimitCents: number;
  readonly dailyTtlSeconds: number;
  readonly matchTtlSeconds: number;
}

export type ReserveBudgetResult =
  | { readonly accepted: true; readonly reservation: BudgetReservation }
  | {
      readonly accepted: false;
      readonly replayed: true;
      readonly reservationState: BudgetReservationState;
    }
  | {
      readonly accepted: false;
      readonly replayed?: false;
      readonly exhaustedScope: BudgetScope;
      readonly usedCents: number;
      readonly limitCents: number;
    };

export interface DistributedBudgetLedger {
  reserve(input: ReserveBudgetInput): Promise<ReserveBudgetResult>;
  settle(reservation: BudgetReservation, actualCostCents: number): Promise<void>;
  release(reservation: BudgetReservation): Promise<void>;
}

export interface AiBudgetPolicy {
  readonly dailyLimitCents: number;
  readonly matchLimitCents: number;
  readonly minReservationCents: number;
  readonly maxAttemptsPerProvider: number;
  readonly matchTtlSeconds: number;
  readonly settlementGraceSeconds: number;
}

export interface AiTurnCostEstimate {
  readonly perAttemptCents: number;
  readonly reservationCents: number;
}

export class BudgetLedgerUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BudgetLedgerUnavailableError';
  }
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative finite number`);
  }
  return value;
}

function toLimitUnits(cents: number): number {
  const units = Math.floor(finiteNonNegative(cents, 'budget limit') * COST_UNIT_SCALE);
  if (!Number.isSafeInteger(units)) throw new TypeError('budget limit is too large');
  return units;
}

function toCostUnits(cents: number): number {
  const units = Math.ceil(finiteNonNegative(cents, 'cost') * COST_UNIT_SCALE);
  if (!Number.isSafeInteger(units)) throw new TypeError('cost is too large');
  return units;
}

function fromCostUnits(units: number): number {
  return units / COST_UNIT_SCALE;
}

function resultArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new BudgetLedgerUnavailableError('Redis budget script returned an invalid result');
  }
  return value;
}

function resultNumber(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) {
    throw new BudgetLedgerUnavailableError('Redis budget script returned an invalid number');
  }
  return number;
}

function resultString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  return String(value);
}

function positiveIntegerFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = Number(environment[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeNumberFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = Number(environment[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function positiveNumberFromEnvironment(
  environment: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const value = Number(environment[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function aiBudgetPolicyFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): AiBudgetPolicy {
  return {
    dailyLimitCents: nonNegativeNumberFromEnvironment(environment, 'AI_DAILY_BUDGET_CENTS', 10_000),
    matchLimitCents: nonNegativeNumberFromEnvironment(environment, 'AI_MATCH_BUDGET_CENTS', 300),
    minReservationCents: positiveNumberFromEnvironment(environment, 'AI_MIN_RESERVATION_CENTS', 1),
    maxAttemptsPerProvider: positiveIntegerFromEnvironment(
      environment,
      'AI_MAX_ATTEMPTS_PER_PROVIDER',
      2,
    ),
    matchTtlSeconds: positiveIntegerFromEnvironment(
      environment,
      'AI_MATCH_BUDGET_TTL_SECONDS',
      172_800,
    ),
    settlementGraceSeconds: positiveIntegerFromEnvironment(
      environment,
      'AI_BUDGET_SETTLEMENT_GRACE_SECONDS',
      7_200,
    ),
  };
}

/**
 * Budget days are fixed to Asia/Shanghai (UTC+08:00, no daylight saving).
 * The extra grace keeps a just-before-midnight reservation settleable.
 */
export function beijingBudgetDay(
  now: Date,
  settlementGraceSeconds: number,
): { readonly dayKey: string; readonly ttlSeconds: number } {
  const localEpoch = now.getTime() + BEIJING_UTC_OFFSET_MS;
  const dayNumber = Math.floor(localEpoch / DAY_MS);
  const nextMidnight = (dayNumber + 1) * DAY_MS;
  const dayKey = new Date(dayNumber * DAY_MS).toISOString().slice(0, 10);
  const untilMidnightSeconds = Math.max(1, Math.ceil((nextMidnight - localEpoch) / 1_000));
  return {
    dayKey,
    ttlSeconds: untilMidnightSeconds + settlementGraceSeconds,
  };
}

export function estimateAiTurnCosts(
  data: AiTurnJobData,
  prices: ReadonlyMap<string, ProviderPricing>,
  policy: AiBudgetPolicy,
): AiTurnCostEstimate {
  const providerIds = [data.primaryProviderId, ...(data.fallbackProviderIds ?? [])].filter(
    (value, index, all) => all.indexOf(value) === index,
  );
  const estimates = providerIds.map((providerId) =>
    estimateChatRequestCostCents(data.request, prices.get(providerId), policy.minReservationCents),
  );
  const perAttemptCents = Math.max(policy.minReservationCents, ...estimates);
  const reservationCents = perAttemptCents * providerIds.length * policy.maxAttemptsPerProvider;
  return {
    perAttemptCents,
    reservationCents: Math.max(policy.minReservationCents, reservationCents),
  };
}

export class RedisBudgetLedger implements DistributedBudgetLedger {
  constructor(private readonly redis: RedisEvalClient) {}

  async reserve(input: ReserveBudgetInput): Promise<ReserveBudgetResult> {
    const matchHash = createHash('sha256').update(input.matchId).digest('hex');
    const reservationHash = createHash('sha256').update(input.reservationId).digest('hex');
    const dailyKey = `${REDIS_KEY_PREFIX}:daily:${input.dayKey}`;
    const matchKey = `${REDIS_KEY_PREFIX}:match:${matchHash}`;
    const reservationKey = `${REDIS_KEY_PREFIX}:reservation:${reservationHash}`;
    const reservationTtlSeconds = Math.max(input.dailyTtlSeconds, input.matchTtlSeconds);
    const amountUnits = toCostUnits(input.amountCents);
    const dailyLimitUnits = toLimitUnits(input.dailyLimitCents);
    const matchLimitUnits = toLimitUnits(input.matchLimitCents);

    let raw: unknown;
    try {
      raw = await this.redis.eval(
        RESERVE_BUDGET_LUA,
        3,
        dailyKey,
        matchKey,
        reservationKey,
        amountUnits,
        dailyLimitUnits,
        matchLimitUnits,
        input.dailyTtlSeconds,
        input.matchTtlSeconds,
        reservationTtlSeconds,
      );
    } catch (error) {
      throw new BudgetLedgerUnavailableError('Redis budget reservation failed', {
        cause: error,
      });
    }

    const result = resultArray(raw);
    const code = resultNumber(result[0]);
    if (code === 2) {
      const state = resultString(result[1]);
      const originalDailyKey = resultString(result[2]);
      const originalMatchKey = resultString(result[3]);
      if (
        (state !== 'active' && state !== 'settled' && state !== 'released') ||
        !originalDailyKey.startsWith(`${REDIS_KEY_PREFIX}:daily:`) ||
        originalMatchKey !== matchKey
      ) {
        throw new BudgetLedgerUnavailableError('Redis returned an invalid replay marker');
      }
      return {
        accepted: false,
        replayed: true,
        reservationState: state,
      };
    }
    if (code === 0) {
      const scope = resultString(result[1]);
      if (scope !== 'daily' && scope !== 'match') {
        throw new BudgetLedgerUnavailableError('Redis returned an unknown budget scope');
      }
      return {
        accepted: false,
        replayed: false,
        exhaustedScope: scope,
        usedCents: fromCostUnits(resultNumber(result[2])),
        limitCents: scope === 'daily' ? input.dailyLimitCents : input.matchLimitCents,
      };
    }
    if (code !== 1) {
      throw new BudgetLedgerUnavailableError('Redis rejected the reservation state');
    }
    return {
      accepted: true,
      reservation: {
        id: input.reservationId,
        amountCents: fromCostUnits(amountUnits),
        dailyKey,
        matchKey,
        reservationKey,
        dailyTtlSeconds: input.dailyTtlSeconds,
        matchTtlSeconds: input.matchTtlSeconds,
        reservationTtlSeconds,
      },
    };
  }

  async settle(reservation: BudgetReservation, actualCostCents: number): Promise<void> {
    let raw: unknown;
    try {
      raw = await this.redis.eval(
        SETTLE_BUDGET_LUA,
        3,
        reservation.dailyKey,
        reservation.matchKey,
        reservation.reservationKey,
        toCostUnits(actualCostCents),
        reservation.dailyTtlSeconds,
        reservation.matchTtlSeconds,
        reservation.reservationTtlSeconds,
      );
    } catch (error) {
      throw new BudgetLedgerUnavailableError('Redis budget settlement failed', {
        cause: error,
      });
    }
    const code = resultNumber(resultArray(raw)[0]);
    if (code !== 1 && code !== 2) {
      throw new BudgetLedgerUnavailableError('Redis could not settle the reservation');
    }
  }

  async release(reservation: BudgetReservation): Promise<void> {
    let raw: unknown;
    try {
      raw = await this.redis.eval(
        RELEASE_BUDGET_LUA,
        3,
        reservation.dailyKey,
        reservation.matchKey,
        reservation.reservationKey,
        reservation.dailyTtlSeconds,
        reservation.matchTtlSeconds,
        reservation.reservationTtlSeconds,
      );
    } catch (error) {
      throw new BudgetLedgerUnavailableError('Redis budget release failed', {
        cause: error,
      });
    }
    const code = resultNumber(resultArray(raw)[0]);
    if (code !== 0 && code !== 1 && code !== 2) {
      throw new BudgetLedgerUnavailableError('Redis could not release the reservation');
    }
  }
}
