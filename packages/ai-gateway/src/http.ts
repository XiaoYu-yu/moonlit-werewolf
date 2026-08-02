import { ProviderRequestError } from './errors.js';

export type FetchLike = typeof fetch;

export interface HttpAdapterOptions {
  readonly id: string;
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetch?: FetchLike;
  readonly inputPriceCentsPerMillion?: number;
  readonly outputPriceCentsPerMillion?: number;
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

export async function parseJsonResponse(
  response: Response,
  providerId: string,
): Promise<Record<string, unknown>> {
  const requestId = response.headers.get('x-request-id') ?? undefined;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    throw new ProviderRequestError(
      `Provider ${providerId} returned a non-JSON response${requestId ? ` (${requestId})` : ''}`,
      providerId,
      response.status,
      { cause: error },
    );
  }
  if (!response.ok) {
    const record =
      payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
    const nestedError =
      record.error && typeof record.error === 'object' && !Array.isArray(record.error)
        ? (record.error as Record<string, unknown>)
        : undefined;
    const providerMessage =
      typeof record.message === 'string'
        ? record.message
        : typeof nestedError?.message === 'string'
          ? nestedError.message
          : undefined;
    const details = providerMessage ? `: ${providerMessage}` : '';
    throw new ProviderRequestError(
      `Provider ${providerId} request failed with ${response.status}${details}`,
      providerId,
      response.status,
    );
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProviderRequestError(
      `Provider ${providerId} returned an invalid payload`,
      providerId,
    );
  }
  return payload as Record<string, unknown>;
}

export function estimateTokenCost(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  options: HttpAdapterOptions,
): number | undefined {
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  const inputPrice = options.inputPriceCentsPerMillion;
  const outputPrice = options.outputPriceCentsPerMillion;
  if (
    inputPrice === undefined ||
    outputPrice === undefined ||
    !Number.isFinite(inputPrice) ||
    !Number.isFinite(outputPrice) ||
    inputPrice < 0 ||
    outputPrice < 0
  ) {
    return undefined;
  }
  return ((inputTokens ?? 0) * inputPrice + (outputTokens ?? 0) * outputPrice) / 1_000_000;
}
