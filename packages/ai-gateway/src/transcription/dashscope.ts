import { ProviderRequestError } from '../errors.js';
import { joinUrl, parseJsonResponse, type FetchLike } from '../http.js';
import type { AudioInput, TranscriptionAdapter, TranscriptionResult } from '../types.js';

export interface DashScopeTranscriptionOptions {
  readonly id: string;
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint?: string;
  readonly fetch?: FetchLike;
}

export class DashScopeTranscriptionAdapter implements TranscriptionAdapter {
  readonly id: string;

  constructor(private readonly options: DashScopeTranscriptionOptions) {
    this.id = options.id;
  }

  async transcribe(input: AudioInput, signal?: AbortSignal): Promise<TranscriptionResult> {
    const form = new FormData();
    form.append('model', this.options.model);
    const audioBuffer = new ArrayBuffer(input.bytes.byteLength);
    new Uint8Array(audioBuffer).set(input.bytes);
    form.append('file', new Blob([audioBuffer], { type: input.mimeType }), input.filename);
    if (input.language) form.append('language', input.language);

    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(
        joinUrl(
          this.options.endpoint ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          'audio/transcriptions',
        ),
        {
          method: 'POST',
          headers: { authorization: `Bearer ${this.options.apiKey}` },
          body: form,
          signal: signal ?? AbortSignal.timeout(60_000),
        },
      );
    } catch (error) {
      throw new ProviderRequestError(
        'Transcription request could not be completed',
        this.id,
        undefined,
        {
          cause: error,
        },
      );
    }
    const payload = await parseJsonResponse(response, this.id);
    if (typeof payload.text !== 'string' || payload.text.trim() === '') {
      throw new ProviderRequestError('Transcription provider returned no text', this.id);
    }
    const requestId = response.headers.get('x-request-id') ?? undefined;
    return {
      text: payload.text.trim(),
      ...(typeof payload.duration_ms === 'number' ? { durationMs: payload.duration_ms } : {}),
      ...(requestId ? { requestId } : {}),
    };
  }
}
