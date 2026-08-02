import type { ChatCompletionRequest, ProviderPricing } from './types.js';

const DEFAULT_MAX_OUTPUT_TOKENS = 800;

function positiveFinite(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function estimatedInputTokens(request: ChatCompletionRequest): number {
  const bytes = request.messages.reduce(
    (total, message) => total + new TextEncoder().encode(message.content).byteLength,
    0,
  );
  // Three UTF-8 bytes per token is deliberately conservative for Chinese while
  // still leaving room for role/message framing overhead.
  return Math.max(1, Math.ceil(bytes / 3) + request.messages.length * 4 + 8);
}

/**
 * Returns a strictly positive per-provider-call estimate. Explicit request
 * estimates and configured token prices are both lower bounds; neither can
 * suppress the other. Missing/partial price data still falls back to the
 * operator-controlled minimum instead of silently becoming free.
 */
export function estimateChatRequestCostCents(
  request: ChatCompletionRequest,
  pricing: ProviderPricing | undefined,
  minimumCents: number,
): number {
  const minimum = positiveFinite(minimumCents);
  if (minimum === undefined) {
    throw new TypeError('minimumCents must be a positive finite number');
  }

  const explicit = positiveFinite(request.estimatedCostCents);
  const inputPrice = positiveFinite(pricing?.inputCentsPerMillion);
  const outputPrice = positiveFinite(pricing?.outputCentsPerMillion);
  let priced = 0;
  if (inputPrice !== undefined || outputPrice !== undefined) {
    const inputTokens = estimatedInputTokens(request);
    const outputTokens = Math.max(
      1,
      Math.ceil(positiveFinite(request.maxOutputTokens) ?? DEFAULT_MAX_OUTPUT_TOKENS),
    );
    priced = (inputTokens * (inputPrice ?? 0) + outputTokens * (outputPrice ?? 0)) / 1_000_000;
  }
  return Math.max(minimum, explicit ?? 0, priced);
}
