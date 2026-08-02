import { CostGuard, type CostReservation } from './cost-guard.js';
import { ProviderCallRejectedError } from './errors.js';
import {
  buildRepairMessages,
  deterministicAction,
  parseStructuredAction,
} from './structured-action.js';
import type {
  ChatCompletionRequest,
  ExecuteAiTurnInput,
  ExecuteAiTurnResult,
  ModelProviderAdapter,
  ProviderAttemptTelemetry,
} from './types.js';

export interface AiGatewayOptions {
  readonly providers: readonly ModelProviderAdapter[];
  readonly costGuard?: CostGuard;
  readonly maxAttemptsPerProvider?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown provider error';
}

export class AiGateway {
  readonly #providers: ReadonlyMap<string, ModelProviderAdapter>;
  readonly #costGuard: CostGuard | undefined;
  readonly #maxAttempts: number;

  constructor(options: AiGatewayOptions) {
    this.#providers = new Map(options.providers.map((provider) => [provider.id, provider]));
    this.#costGuard = options.costGuard;
    this.#maxAttempts = Math.max(1, options.maxAttemptsPerProvider ?? 2);
  }

  async executeTurn(input: ExecuteAiTurnInput): Promise<ExecuteAiTurnResult> {
    const providerIds = [input.primaryProviderId, ...(input.fallbackProviderIds ?? [])].filter(
      (value, index, all) => all.indexOf(value) === index,
    );
    const reasons: string[] = [];
    const providerAttempts: ProviderAttemptTelemetry[] = [];
    let attempts = 0;
    let costCents = 0;

    for (const [providerIndex, providerId] of providerIds.entries()) {
      const provider = this.#providers.get(providerId);
      if (!provider) {
        reasons.push(`Provider "${providerId}" is not configured`);
        continue;
      }

      let request: ChatCompletionRequest = {
        ...input.request,
        responseFormat: provider.capabilities.jsonMode ? 'json' : 'text',
      };

      for (let attempt = 0; attempt < this.#maxAttempts; attempt += 1) {
        attempts += 1;
        let reservation: CostReservation | undefined;
        let providerCallStarted = false;
        const startedAt = Date.now();
        try {
          const estimatedCost = Math.max(0, request.estimatedCostCents ?? 0);
          reservation = this.#costGuard?.reserve(estimatedCost);
          providerCallStarted = true;
          const result = await provider.complete(request);
          const reportedCost =
            result.costCents !== undefined &&
            Number.isFinite(result.costCents) &&
            result.costCents >= 0
              ? result.costCents
              : estimatedCost;
          const actualCost = Math.max(0, reportedCost);
          costCents += actualCost;
          if (reservation) {
            this.#costGuard?.settle(reservation, actualCost);
          }
          try {
            const action = parseStructuredAction(
              result.content,
              input.actionType,
              input.allowedSeatIds ?? [],
              input.requireDecisionSummary ?? false,
              input.requireVisibleAnalysis ?? false,
            );
            providerAttempts.push({
              providerId,
              succeeded: true,
              durationMs: Math.max(0, Date.now() - startedAt),
              costCents: actualCost,
              ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
              ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
            });
            return {
              action,
              providerId,
              modelId: provider.modelId ?? request.model,
              attempts,
              usedFallback: providerIndex > 0,
              failureReasons: reasons,
              providerAttempts,
              costCents,
            };
          } catch (parseError) {
            const reason = errorMessage(parseError);
            reasons.push(`${providerId}: ${reason}`);
            providerAttempts.push({
              providerId,
              succeeded: false,
              durationMs: Math.max(0, Date.now() - startedAt),
              costCents: actualCost,
              ...(result.inputTokens !== undefined ? { inputTokens: result.inputTokens } : {}),
              ...(result.outputTokens !== undefined ? { outputTokens: result.outputTokens } : {}),
              error: reason,
            });
            request = {
              ...request,
              messages: buildRepairMessages(
                input.request.messages,
                result.content,
                input.actionType,
                input.allowedSeatIds ?? [],
                input.requireDecisionSummary ?? false,
                input.requireVisibleAnalysis ?? false,
              ),
              temperature: 0,
              responseFormat: provider.capabilities.jsonMode ? 'json' : 'text',
            };
          }
        } catch (error) {
          const callRejected = error instanceof ProviderCallRejectedError;
          if (providerCallStarted && !callRejected) {
            const unknownCost = Math.max(0, request.estimatedCostCents ?? 0);
            costCents += unknownCost;
            if (reservation) this.#costGuard?.settle(reservation, unknownCost);
          } else if (reservation) {
            this.#costGuard?.release(reservation);
          }
          const reason = errorMessage(error);
          reasons.push(`${providerId}: ${reason}`);
          if (providerCallStarted && !callRejected) {
            providerAttempts.push({
              providerId,
              succeeded: false,
              durationMs: Math.max(0, Date.now() - startedAt),
              costCents: Math.max(0, request.estimatedCostCents ?? 0),
              error: reason,
            });
          }
        }
      }
    }

    return {
      action:
        input.deterministicFallback?.() ??
        deterministicAction(input.actionType, input.allowedSeatIds ?? []),
      attempts,
      usedFallback: true,
      failureReasons: reasons,
      providerAttempts,
      costCents,
    };
  }
}
