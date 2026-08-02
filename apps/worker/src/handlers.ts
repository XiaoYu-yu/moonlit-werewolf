import { randomUUID } from 'node:crypto';
import {
  fallbackAiTurnResult,
  type AiGateway,
  type ProviderPricing,
  type TranscriptionAdapter,
} from '@werewolf/ai-gateway';
import {
  aiBudgetPolicyFromEnvironment,
  beijingBudgetDay,
  estimateAiTurnCosts,
  type AiBudgetPolicy,
  type BudgetReservation,
  type DistributedBudgetLedger,
} from './budget-ledger.js';
import type {
  AiTurnJobData,
  AiTurnJobResult,
  PersistEventJobData,
  PersistEventJobResult,
  TranscriptionJobData,
  TranscriptionJobResult,
} from './jobs.js';

export interface WorkerDependencies {
  readonly aiGateway: AiGateway;
  readonly budgetLedger?: DistributedBudgetLedger;
  readonly budgetPolicy?: AiBudgetPolicy;
  readonly providerPrices?: ReadonlyMap<string, ProviderPricing>;
  readonly now?: () => Date;
  readonly reservationId?: (executionId?: string) => string;
  readonly ledgerRetryAfterMs?: number;
  readonly transcriptionAdapters?: ReadonlyMap<string, TranscriptionAdapter>;
  readonly persistEvent?: (data: PersistEventJobData) => Promise<boolean>;
}

export function createJobHandlers(dependencies: WorkerDependencies) {
  const policy = dependencies.budgetPolicy ?? aiBudgetPolicyFromEnvironment();
  const prices = dependencies.providerPrices ?? new Map<string, ProviderPricing>();
  const now = dependencies.now ?? (() => new Date());
  const reservationId =
    dependencies.reservationId ?? ((executionId?: string) => executionId ?? randomUUID());
  const retryAfterMs = Math.max(1_000, dependencies.ledgerRetryAfterMs ?? 5_000);
  let ledgerBlockedUntil = 0;

  function ledgerFallback(data: AiTurnJobData, reason: string): AiTurnJobResult {
    return fallbackAiTurnResult(data.fallbackAction, reason);
  }

  function tripLedgerCircuit(): void {
    ledgerBlockedUntil = now().getTime() + retryAfterMs;
  }

  return {
    async aiTurn(data: AiTurnJobData, executionId?: string): Promise<AiTurnJobResult> {
      const ledger = dependencies.budgetLedger;
      if (!ledger || now().getTime() < ledgerBlockedUntil) {
        return ledgerFallback(data, 'AI budget ledger unavailable; deterministic fallback used');
      }

      const day = beijingBudgetDay(now(), policy.settlementGraceSeconds);
      const estimate = estimateAiTurnCosts(data, prices, policy);
      let reserved: BudgetReservation;
      try {
        const result = await ledger.reserve({
          reservationId: reservationId(executionId),
          matchId: data.matchId,
          dayKey: day.dayKey,
          amountCents: estimate.reservationCents,
          dailyLimitCents: policy.dailyLimitCents,
          matchLimitCents: policy.matchLimitCents,
          dailyTtlSeconds: day.ttlSeconds,
          matchTtlSeconds: policy.matchTtlSeconds,
        });
        if (!result.accepted) {
          if ('replayed' in result && result.replayed) {
            return ledgerFallback(
              data,
              `AI reservation replayed (${result.reservationState}); deterministic fallback used`,
            );
          }
          return ledgerFallback(
            data,
            `AI ${result.exhaustedScope} budget exhausted; deterministic fallback used`,
          );
        }
        reserved = result.reservation;
      } catch {
        tripLedgerCircuit();
        return ledgerFallback(data, 'AI budget ledger unavailable; deterministic fallback used');
      }

      try {
        const result = await dependencies.aiGateway.executeTurn({
          primaryProviderId: data.primaryProviderId,
          ...(data.fallbackProviderIds ? { fallbackProviderIds: data.fallbackProviderIds } : {}),
          request: {
            ...data.request,
            estimatedCostCents: estimate.perAttemptCents,
          },
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
        const actualCost =
          result.costCents ??
          (result.attempts > 0 ? estimate.perAttemptCents * result.attempts : 0);
        try {
          await ledger.settle(reserved, actualCost);
        } catch {
          // Settlement is idempotent; a second immediate attempt covers a lost
          // Redis response without risking a double charge.
          try {
            await ledger.settle(reserved, actualCost);
          } catch {
            tripLedgerCircuit();
            return ledgerFallback(
              data,
              'AI budget settlement unavailable; deterministic fallback used',
            );
          }
        }
        return result;
      } catch (error) {
        try {
          await ledger.settle(reserved, reserved.amountCents);
        } catch {
          try {
            await ledger.settle(reserved, reserved.amountCents);
          } catch {
            tripLedgerCircuit();
          }
        }
        return {
          ...fallbackAiTurnResult(
            data.fallbackAction,
            error instanceof Error ? `AI gateway failed: ${error.message}` : 'AI gateway failed',
          ),
          costCents: reserved.amountCents,
        };
      }
    },

    async transcription(data: TranscriptionJobData): Promise<TranscriptionJobResult> {
      const adapter = dependencies.transcriptionAdapters?.get(data.providerId);
      if (!adapter) throw new Error(`Transcription provider "${data.providerId}" is unavailable`);
      return adapter.transcribe({
        bytes: Buffer.from(data.audioBase64, 'base64'),
        mimeType: data.mimeType,
        filename: data.filename,
        ...(data.language ? { language: data.language } : {}),
      });
    },

    async persistEvent(data: PersistEventJobData): Promise<PersistEventJobResult> {
      const accepted = (await dependencies.persistEvent?.(data)) ?? true;
      return { accepted, idempotencyKey: data.idempotencyKey };
    },
  };
}
