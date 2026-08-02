import type {
  AiAction,
  AiActionType,
  ChatCompletionRequest,
  ExecuteAiTurnResult,
} from './types.js';
import {
  MAX_AI_DECISION_SUMMARY_CHARS,
  MAX_AI_MEMORY_SUMMARY_CHARS,
  MAX_AI_VISIBLE_ANALYSIS_CHARS,
} from './types.js';
import { hasConsistentAiActionControls } from './structured-action.js';

export const AI_TURN_QUEUE_NAME = 'werewolf-ai';
export const AI_TURN_JOB_NAME = 'ai-turn';

/**
 * Serializable contract shared by the API producer and BullMQ worker.
 * The request must contain only the public room view and the acting player's
 * own private view; authoritative server state is never placed on the queue.
 */
export interface AiTurnJobData {
  readonly primaryProviderId: string;
  readonly fallbackProviderIds?: readonly string[];
  readonly request: ChatCompletionRequest;
  readonly actionType: AiActionType;
  readonly allowedSeatIds?: readonly string[];
  readonly requireDecisionSummary?: boolean;
  readonly requireVisibleAnalysis?: boolean;
  readonly fallbackAction: AiAction;
  readonly roomId: string;
  readonly matchId: string;
  readonly actorSeatId: string;
}

export type AiTurnJobResult = ExecuteAiTurnResult;

export function isAiTurnJobResult(
  value: unknown,
  expectedType: AiActionType,
  allowedSeatIds: readonly string[],
  requireDecisionSummary = false,
  requireVisibleAnalysis = false,
): value is AiTurnJobResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (
    !result.action ||
    typeof result.action !== 'object' ||
    Array.isArray(result.action) ||
    typeof result.attempts !== 'number' ||
    !Number.isInteger(result.attempts) ||
    result.attempts < 0 ||
    typeof result.usedFallback !== 'boolean' ||
    !Array.isArray(result.failureReasons) ||
    !result.failureReasons.every((reason) => typeof reason === 'string') ||
    (result.providerAttempts !== undefined &&
      (!Array.isArray(result.providerAttempts) ||
        !result.providerAttempts.every((attempt) => {
          if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) return false;
          const telemetry = attempt as Record<string, unknown>;
          return (
            typeof telemetry.providerId === 'string' &&
            typeof telemetry.succeeded === 'boolean' &&
            typeof telemetry.durationMs === 'number' &&
            Number.isFinite(telemetry.durationMs) &&
            telemetry.durationMs >= 0 &&
            typeof telemetry.costCents === 'number' &&
            Number.isFinite(telemetry.costCents) &&
            telemetry.costCents >= 0 &&
            (telemetry.inputTokens === undefined ||
              (typeof telemetry.inputTokens === 'number' &&
                Number.isInteger(telemetry.inputTokens) &&
                telemetry.inputTokens >= 0)) &&
            (telemetry.outputTokens === undefined ||
              (typeof telemetry.outputTokens === 'number' &&
                Number.isInteger(telemetry.outputTokens) &&
                telemetry.outputTokens >= 0)) &&
            (telemetry.error === undefined || typeof telemetry.error === 'string')
          );
        }))) ||
    (result.costCents !== undefined &&
      (typeof result.costCents !== 'number' ||
        !Number.isFinite(result.costCents) ||
        result.costCents < 0)) ||
    (result.providerId !== undefined && typeof result.providerId !== 'string') ||
    (result.modelId !== undefined && typeof result.modelId !== 'string') ||
    (result.providerId === undefined && result.modelId !== undefined) ||
    (result.providerId !== undefined &&
      (typeof result.modelId !== 'string' ||
        result.modelId.trim().length === 0 ||
        result.attempts < 1 ||
        !Array.isArray(result.providerAttempts) ||
        !result.providerAttempts.some((attempt) => {
          if (!attempt || typeof attempt !== 'object' || Array.isArray(attempt)) return false;
          const telemetry = attempt as Record<string, unknown>;
          return telemetry.providerId === result.providerId && telemetry.succeeded === true;
        })))
  ) {
    return false;
  }

  const action = result.action as Record<string, unknown>;
  if (!hasConsistentAiActionControls(action, expectedType)) return false;
  const memorySummary = action.memorySummary;
  if (
    memorySummary !== undefined &&
    (typeof memorySummary !== 'string' || memorySummary.length > MAX_AI_MEMORY_SUMMARY_CHARS)
  ) {
    return false;
  }
  const decisionSummary = action.decisionSummary;
  if (
    decisionSummary !== undefined &&
    (typeof decisionSummary !== 'string' ||
      decisionSummary.trim().length === 0 ||
      decisionSummary.length > MAX_AI_DECISION_SUMMARY_CHARS)
  ) {
    return false;
  }
  if (requireDecisionSummary && typeof decisionSummary !== 'string') return false;
  const visibleAnalysis = action.visibleAnalysis;
  if (
    visibleAnalysis !== undefined &&
    (typeof visibleAnalysis !== 'string' ||
      visibleAnalysis.trim().length === 0 ||
      visibleAnalysis.length > MAX_AI_VISIBLE_ANALYSIS_CHARS)
  ) {
    return false;
  }
  if (requireVisibleAnalysis && typeof visibleAnalysis !== 'string') return false;
  return typeof action.targetSeatId !== 'string' || allowedSeatIds.includes(action.targetSeatId);
}

export function fallbackAiTurnResult(
  action: AiAction,
  reason: string,
  attempts = 0,
): AiTurnJobResult {
  return {
    action,
    attempts,
    usedFallback: true,
    failureReasons: [reason],
    providerAttempts: [],
    costCents: 0,
  };
}
