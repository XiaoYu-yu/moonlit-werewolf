import { ProviderRequestError } from '../errors.js';
import { estimateTokenCost, joinUrl, parseJsonResponse, type HttpAdapterOptions } from '../http.js';
import type {
  ChatCompletionRequest,
  ChatCompletionResult,
  ModelProviderAdapter,
  ProviderCapabilities,
  ProviderKind,
} from '../types.js';

export interface OpenAiAdapterOptions extends HttpAdapterOptions {
  readonly endpointPath?: string;
  readonly extraHeaders?: Readonly<Record<string, string>>;
  readonly extraBody?: Readonly<Record<string, unknown>>;
  readonly capabilities?: Partial<ProviderCapabilities>;
  readonly modelOverride?: string;
  readonly temperatureOverride?: number;
  readonly timeoutOverrideMs?: number;
}

export class OpenAiCompatibleAdapter implements ModelProviderAdapter {
  readonly id: string;
  readonly modelId?: string;
  readonly kind: ProviderKind = 'openai-compatible';
  readonly capabilities: ProviderCapabilities;
  protected readonly options: OpenAiAdapterOptions;

  constructor(options: OpenAiAdapterOptions) {
    this.options = options;
    this.id = options.id;
    if (options.modelOverride) this.modelId = options.modelOverride;
    this.capabilities = {
      jsonMode: true,
      streaming: false,
      transcription: false,
      ...options.capabilities,
    };
  }

  async complete(
    request: ChatCompletionRequest,
    outerSignal?: AbortSignal,
  ): Promise<ChatCompletionResult> {
    const timeout = AbortSignal.timeout(
      this.options.timeoutOverrideMs ?? request.timeoutMs ?? 25_000,
    );
    const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        joinUrl(this.options.baseUrl, this.options.endpointPath ?? 'chat/completions'),
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.options.apiKey}`,
            'content-type': 'application/json',
            ...this.options.extraHeaders,
          },
          body: JSON.stringify({
            model: this.options.modelOverride ?? request.model,
            messages: request.messages,
            temperature: this.options.temperatureOverride ?? request.temperature ?? 0.5,
            max_tokens: request.maxOutputTokens ?? 800,
            ...(request.responseFormat === 'json' && this.capabilities.jsonMode
              ? { response_format: { type: 'json_object' } }
              : {}),
            ...this.options.extraBody,
          }),
          signal,
        },
      );
    } catch (error) {
      throw new ProviderRequestError(
        `Provider ${this.id} request could not be completed`,
        this.id,
        undefined,
        {
          cause: error,
        },
      );
    }

    const payload = await parseJsonResponse(response, this.id);
    const choices = Array.isArray(payload.choices) ? payload.choices : [];
    const first = choices[0] as Record<string, unknown> | undefined;
    const message =
      first?.message && typeof first.message === 'object'
        ? (first.message as Record<string, unknown>)
        : undefined;
    if (typeof message?.content !== 'string') {
      throw new ProviderRequestError(`Provider ${this.id} returned no message content`, this.id);
    }

    const usage =
      payload.usage && typeof payload.usage === 'object'
        ? (payload.usage as Record<string, unknown>)
        : undefined;
    const inputTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : undefined;
    const outputTokens =
      typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : undefined;
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const costCents = estimateTokenCost(inputTokens, outputTokens, this.options);

    return {
      content: message.content,
      ...(inputTokens !== undefined ? { inputTokens } : {}),
      ...(outputTokens !== undefined ? { outputTokens } : {}),
      ...(costCents !== undefined ? { costCents } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}
