import { CostLimitExceededError } from './errors.js';
import type { UsageBudgetSnapshot } from './types.js';

export class CostGuard {
  #spentCents = 0;
  #reservedCents = 0;

  constructor(readonly limitCents: number) {
    if (!Number.isFinite(limitCents) || limitCents < 0) {
      throw new TypeError('limitCents must be a non-negative finite number');
    }
  }

  assertCanSpend(estimatedCents: number): void {
    const normalized = Math.max(0, estimatedCents);
    const remaining = this.limitCents - this.#spentCents - this.#reservedCents;
    if (normalized > remaining) {
      throw new CostLimitExceededError(normalized, remaining);
    }
  }

  record(actualCents: number): void {
    this.#spentCents += Math.max(0, actualCents);
  }

  reserve(estimatedCents: number): CostReservation {
    const normalized = Math.max(0, estimatedCents);
    this.assertCanSpend(normalized);
    this.#reservedCents += normalized;
    return { amountCents: normalized, active: true };
  }

  settle(reservation: CostReservation, actualCents: number): void {
    if (!reservation.active) return;
    reservation.active = false;
    this.#reservedCents = Math.max(0, this.#reservedCents - reservation.amountCents);
    this.record(actualCents);
  }

  release(reservation: CostReservation): void {
    if (!reservation.active) return;
    reservation.active = false;
    this.#reservedCents = Math.max(0, this.#reservedCents - reservation.amountCents);
  }

  snapshot(): UsageBudgetSnapshot {
    return {
      limitCents: this.limitCents,
      spentCents: this.#spentCents,
      remainingCents: Math.max(0, this.limitCents - this.#spentCents - this.#reservedCents),
    };
  }
}

export interface CostReservation {
  readonly amountCents: number;
  active: boolean;
}
