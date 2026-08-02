import { describe, expect, it } from 'vitest';
import {
  aiBudgetPolicyFromEnvironment,
  beijingBudgetDay,
  estimateAiTurnCosts,
  RedisBudgetLedger,
  type AiBudgetPolicy,
  type RedisEvalClient,
  type ReserveBudgetInput,
} from './budget-ledger.js';
import { providersFromEnvironment } from './providers.js';

interface FakeReservation {
  state: 'active' | 'settled' | 'released';
  reserved: number;
  dailyKey: string;
  matchKey: string;
  actual?: number;
}

class FakeRedisScripts implements RedisEvalClient {
  readonly #values = new Map<string, number>();
  readonly #reservations = new Map<string, FakeReservation>();

  async eval(
    script: string,
    _numberOfKeys: number,
    ...args: readonly (string | number)[]
  ): Promise<unknown> {
    const dailyKey = String(args[0]);
    const matchKey = String(args[1]);
    const reservationKey = String(args[2]);

    if (script.includes('reserve-v1')) {
      const amount = Number(args[3]);
      const dailyLimit = Number(args[4]);
      const matchLimit = Number(args[5]);
      const existing = this.#reservations.get(reservationKey);
      if (existing) {
        if (existing.matchKey !== matchKey) return [-3, 'match-scope-mismatch'];
        if (existing.state === 'active' && existing.reserved !== amount) {
          return [-4, 'amount-mismatch'];
        }
        return [2, existing.state, existing.dailyKey, existing.matchKey];
      }
      const daily = this.#value(dailyKey);
      const match = this.#value(matchKey);
      if (daily + amount > dailyLimit) return [0, 'daily', daily];
      if (match + amount > matchLimit) return [0, 'match', match];
      this.#values.set(dailyKey, daily + amount);
      this.#values.set(matchKey, match + amount);
      this.#reservations.set(reservationKey, {
        state: 'active',
        reserved: amount,
        dailyKey,
        matchKey,
      });
      return [1, daily + amount, match + amount];
    }

    if (script.includes('settle-v1')) {
      const actual = Number(args[3]);
      const reservation = this.#reservations.get(reservationKey);
      if (!reservation) return [-1, 'missing'];
      if (reservation.dailyKey !== dailyKey || reservation.matchKey !== matchKey) {
        return [-3, 'scope-mismatch'];
      }
      if (reservation.state === 'settled') return [2, reservation.actual ?? 0];
      if (reservation.state !== 'active') return [-2, reservation.state];
      const delta = actual - reservation.reserved;
      this.#values.set(dailyKey, this.#value(dailyKey) + delta);
      this.#values.set(matchKey, this.#value(matchKey) + delta);
      reservation.state = 'settled';
      reservation.actual = actual;
      return [1, actual];
    }

    if (script.includes('release-v1')) {
      const reservation = this.#reservations.get(reservationKey);
      if (!reservation) return [0, 'missing'];
      if (reservation.dailyKey !== dailyKey || reservation.matchKey !== matchKey) {
        return [-2, 'scope-mismatch'];
      }
      if (reservation.state === 'released') return [2, 0];
      if (reservation.state !== 'active') return [-1, reservation.state];
      this.#values.set(dailyKey, this.#value(dailyKey) - reservation.reserved);
      this.#values.set(matchKey, this.#value(matchKey) - reservation.reserved);
      reservation.state = 'released';
      return [1, reservation.reserved];
    }

    throw new Error('unknown script');
  }

  #value(key: string): number {
    return this.#values.get(key) ?? 0;
  }
}

const baseInput: ReserveBudgetInput = {
  reservationId: 'reservation-1',
  matchId: 'match-1',
  dayKey: '2026-07-18',
  amountCents: 6,
  dailyLimitCents: 10,
  matchLimitCents: 10,
  dailyTtlSeconds: 7_200,
  matchTtlSeconds: 86_400,
};

const policy: AiBudgetPolicy = {
  dailyLimitCents: 100,
  matchLimitCents: 50,
  minReservationCents: 1,
  maxAttemptsPerProvider: 2,
  matchTtlSeconds: 86_400,
  settlementGraceSeconds: 3_600,
};

describe('RedisBudgetLedger Lua semantics', () => {
  it('allows only one concurrent reservation at the shared boundary', async () => {
    const ledger = new RedisBudgetLedger(new FakeRedisScripts());
    const results = await Promise.all([
      ledger.reserve(baseInput),
      ledger.reserve({ ...baseInput, reservationId: 'reservation-2' }),
    ]);

    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(
      results.find((result) => !result.accepted && result.exhaustedScope === 'daily'),
    ).toBeDefined();
    const accepted = results.find((result) => result.accepted);
    if (accepted?.accepted) {
      expect(accepted.reservation.dailyKey).toContain('{ai-budget}');
      expect(accepted.reservation.matchKey).toContain('{ai-budget}');
      expect(accepted.reservation.reservationKey).toContain('{ai-budget}');
    }
  });

  it('reports daily and match exhaustion independently', async () => {
    const dailyLedger = new RedisBudgetLedger(new FakeRedisScripts());
    await expect(
      dailyLedger.reserve({ ...baseInput, dailyLimitCents: 5, matchLimitCents: 100 }),
    ).resolves.toMatchObject({ accepted: false, exhaustedScope: 'daily' });

    const matchLedger = new RedisBudgetLedger(new FakeRedisScripts());
    await expect(
      matchLedger.reserve({ ...baseInput, dailyLimitCents: 100, matchLimitCents: 5 }),
    ).resolves.toMatchObject({ accepted: false, exhaustedScope: 'match' });
  });

  it('settles over-estimates downward and releases failed reservations', async () => {
    const ledger = new RedisBudgetLedger(new FakeRedisScripts());
    const first = await ledger.reserve({ ...baseInput, amountCents: 8 });
    expect(first.accepted).toBe(true);
    if (!first.accepted) return;
    await ledger.settle(first.reservation, 2);

    const second = await ledger.reserve({
      ...baseInput,
      reservationId: 'reservation-2',
      amountCents: 8,
    });
    expect(second.accepted).toBe(true);
    if (!second.accepted) return;
    await ledger.release(second.reservation);

    await expect(
      ledger.reserve({
        ...baseInput,
        reservationId: 'reservation-3',
        amountCents: 8,
      }),
    ).resolves.toMatchObject({ accepted: true });
  });

  it('records actual overages and blocks subsequent calls', async () => {
    const ledger = new RedisBudgetLedger(new FakeRedisScripts());
    const result = await ledger.reserve({ ...baseInput, amountCents: 5 });
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    await ledger.settle(result.reservation, 12);

    await expect(
      ledger.reserve({
        ...baseInput,
        reservationId: 'reservation-2',
        amountCents: 0.001,
      }),
    ).resolves.toMatchObject({ accepted: false, exhaustedScope: 'daily' });
  });

  it('settles a repeated reservation id against its original day keys', async () => {
    const ledger = new RedisBudgetLedger(new FakeRedisScripts());
    await expect(
      ledger.reserve({
        ...baseInput,
        amountCents: 6,
        dailyLimitCents: 10,
        matchLimitCents: 100,
      }),
    ).resolves.toMatchObject({ accepted: true });
    await expect(
      ledger.reserve({
        ...baseInput,
        reservationId: 'new-day-other-job',
        dayKey: '2026-07-19',
        amountCents: 4,
        dailyLimitCents: 10,
        matchLimitCents: 100,
      }),
    ).resolves.toMatchObject({ accepted: true });

    const repeated = await ledger.reserve({
      ...baseInput,
      dayKey: '2026-07-19',
      amountCents: 6,
      dailyLimitCents: 10,
      matchLimitCents: 100,
    });
    expect(repeated).toMatchObject({
      accepted: false,
      replayed: true,
      reservationState: 'active',
    });

    await expect(
      ledger.reserve({
        ...baseInput,
        reservationId: 'new-day-boundary-job',
        dayKey: '2026-07-19',
        amountCents: 7,
        dailyLimitCents: 10,
        matchLimitCents: 100,
      }),
    ).resolves.toMatchObject({ accepted: false, exhaustedScope: 'daily' });
  });

  it('marks settled and released reservation ids as safe replays', async () => {
    const ledger = new RedisBudgetLedger(new FakeRedisScripts());
    const settled = await ledger.reserve(baseInput);
    expect(settled.accepted).toBe(true);
    if (!settled.accepted) return;
    await ledger.settle(settled.reservation, 2);
    await expect(ledger.reserve(baseInput)).resolves.toMatchObject({
      accepted: false,
      replayed: true,
      reservationState: 'settled',
    });

    const releasedInput = { ...baseInput, reservationId: 'released-reservation' };
    const released = await ledger.reserve(releasedInput);
    expect(released.accepted).toBe(true);
    if (!released.accepted) return;
    await ledger.release(released.reservation);
    await expect(ledger.reserve(releasedInput)).resolves.toMatchObject({
      accepted: false,
      replayed: true,
      reservationState: 'released',
    });
  });
});

describe('budget policy helpers', () => {
  it('uses a Beijing calendar day with settlement grace', () => {
    expect(beijingBudgetDay(new Date('2026-07-18T15:59:59.000Z'), 3_600)).toEqual({
      dayKey: '2026-07-18',
      ttlSeconds: 3_601,
    });
    expect(beijingBudgetDay(new Date('2026-07-18T16:00:00.000Z'), 3_600).dayKey).toBe('2026-07-19');
  });

  it('uses a non-zero minimum when request and provider prices are unknown', () => {
    const estimate = estimateAiTurnCosts(
      {
        roomId: 'room',
        matchId: 'match',
        actorSeatId: 'seat',
        primaryProviderId: 'unknown',
        request: { model: 'model', messages: [] },
        actionType: 'vote',
        fallbackAction: { type: 'vote', abstain: true },
      },
      new Map(),
      policy,
    );

    expect(estimate.perAttemptCents).toBe(1);
    expect(estimate.reservationCents).toBe(2);
  });

  it('reserves the maximum per-attempt estimate for every possible provider attempt', () => {
    const estimate = estimateAiTurnCosts(
      {
        roomId: 'room',
        matchId: 'match',
        actorSeatId: 'seat',
        primaryProviderId: 'cheap',
        fallbackProviderIds: ['expensive'],
        request: { model: 'model', messages: [], maxOutputTokens: 100 },
        actionType: 'vote',
        fallbackAction: { type: 'vote', abstain: true },
      },
      new Map([
        ['cheap', { outputCentsPerMillion: 100_000 }],
        ['expensive', { outputCentsPerMillion: 200_000 }],
      ]),
      policy,
    );

    expect(estimate.perAttemptCents).toBe(20);
    expect(estimate.reservationCents).toBe(80);
  });

  it('rejects a zero minimum and exposes provider price environment values', () => {
    const guardedPolicy = aiBudgetPolicyFromEnvironment({
      AI_MIN_RESERVATION_CENTS: '0',
    });
    expect(guardedPolicy.minReservationCents).toBeGreaterThan(0);

    const providers = providersFromEnvironment({
      environment: {
        DEEPSEEK_API_KEY: 'test-only',
        AI_PRICE_DEEPSEEK_INPUT_CENTS_PER_MILLION: '14',
        AI_PRICE_DEEPSEEK_OUTPUT_CENTS_PER_MILLION: '28',
      },
    });
    expect(providers.prices.get('deepseek')).toEqual({
      inputCentsPerMillion: 14,
      outputCentsPerMillion: 28,
    });
  });
});
