export type ProviderKind = 'openai-compatible' | 'dashscope' | 'volcengine-ark';

export interface ProviderCapabilities {
  readonly jsonMode: boolean;
  readonly streaming: boolean;
  readonly transcription: boolean;
  readonly maxContextTokens?: number;
}

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface ChatCompletionRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly maxOutputTokens?: number;
  readonly responseFormat?: 'text' | 'json';
  readonly timeoutMs?: number;
  readonly estimatedCostCents?: number;
}

export interface ChatCompletionResult {
  readonly content: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly costCents?: number;
  readonly requestId?: string;
}

/**
 * Sanitized operational telemetry for one provider HTTP attempt. It is safe to
 * return through the internal BullMQ contract: prompts, responses, credentials,
 * and hidden reasoning are deliberately excluded.
 */
export interface ProviderAttemptTelemetry {
  readonly providerId: string;
  readonly succeeded: boolean;
  readonly durationMs: number;
  readonly costCents: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly error?: string;
}

export interface ModelProviderAdapter {
  readonly id: string;
  readonly modelId?: string;
  readonly kind: ProviderKind;
  readonly capabilities: ProviderCapabilities;
  complete(request: ChatCompletionRequest, signal?: AbortSignal): Promise<ChatCompletionResult>;
}

export interface AudioInput {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly filename: string;
  readonly language?: string;
}

export interface TranscriptionResult {
  readonly text: string;
  readonly durationMs?: number;
  readonly requestId?: string;
}

export interface TranscriptionAdapter {
  readonly id: string;
  transcribe(input: AudioInput, signal?: AbortSignal): Promise<TranscriptionResult>;
}

export type AiActionType = 'speak' | 'vote' | 'night';

export const MAX_AI_MEMORY_SUMMARY_CHARS = 1_000;
export const MAX_AI_DECISION_SUMMARY_CHARS = 600;
export const MAX_AI_VISIBLE_ANALYSIS_CHARS = 1_200;

export interface AiAction {
  readonly type: AiActionType;
  readonly message?: string;
  readonly targetSeatId?: string;
  readonly abstain?: boolean;
  readonly useHeal?: boolean;
  readonly memorySummary?: string;
  /**
   * One or two user-visible sentences explaining the final choice. This is
   * deliberately not a hidden chain-of-thought or provider reasoning trace.
   */
  readonly decisionSummary?: string;
  /**
   * A provider-authored analysis intentionally composed for an authenticated
   * observer. It must never contain a raw chain-of-thought or provider trace.
   */
  readonly visibleAnalysis?: string;
}

export interface ExecuteAiTurnInput {
  readonly primaryProviderId: string;
  readonly fallbackProviderIds?: readonly string[];
  readonly request: ChatCompletionRequest;
  readonly actionType: AiActionType;
  readonly allowedSeatIds?: readonly string[];
  readonly requireDecisionSummary?: boolean;
  readonly requireVisibleAnalysis?: boolean;
  readonly deterministicFallback?: () => AiAction;
}

export interface ExecuteAiTurnResult {
  readonly action: AiAction;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly attempts: number;
  readonly usedFallback: boolean;
  readonly failureReasons: readonly string[];
  readonly providerAttempts?: readonly ProviderAttemptTelemetry[];
  /**
   * Total provider cost observed across every completed attempt in this turn.
   * Gateways produced before this field existed may omit it, so queue consumers
   * must retain a conservative non-zero estimate for compatibility.
   */
  readonly costCents?: number;
}

export interface UsageBudgetSnapshot {
  readonly limitCents: number;
  readonly spentCents: number;
  readonly remainingCents: number;
}

export interface ProviderPricing {
  readonly inputCentsPerMillion?: number;
  readonly outputCentsPerMillion?: number;
}
