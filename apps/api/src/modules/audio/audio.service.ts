import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DashScopeTranscriptionAdapter, type TranscriptionAdapter } from '@werewolf/ai-gateway';
import {
  transcriptionMaxSecondsFromEnvironment,
  validateBrowserAudioFile,
} from './audio-validation.js';

export const AUDIO_TRANSCRIPTION_ADAPTER = Symbol('AUDIO_TRANSCRIPTION_ADAPTER');

@Injectable()
export class AudioService {
  readonly #adapter?: TranscriptionAdapter;
  readonly #maxSeconds: number;

  constructor(
    @Optional()
    @Inject(AUDIO_TRANSCRIPTION_ADAPTER)
    adapter?: TranscriptionAdapter,
  ) {
    this.#maxSeconds = transcriptionMaxSecondsFromEnvironment();
    if (adapter) {
      this.#adapter = adapter;
    } else if (process.env.DASHSCOPE_API_KEY && process.env.DASHSCOPE_ASR_MODEL) {
      this.#adapter = new DashScopeTranscriptionAdapter({
        id: 'dashscope-asr',
        apiKey: process.env.DASHSCOPE_API_KEY,
        model: process.env.DASHSCOPE_ASR_MODEL,
      });
    }
  }

  async transcribe(file: Express.Multer.File) {
    const audio = validateBrowserAudioFile(file, this.#maxSeconds);
    if (!this.#adapter) {
      throw new ServiceUnavailableException('Transcription provider is not configured');
    }
    const result = await this.#adapter.transcribe({
      bytes: audio.bytes,
      mimeType: audio.mimeType,
      filename: audio.filename,
      language: 'zh',
    });
    if (result.durationMs !== undefined && result.durationMs > this.#maxSeconds * 1_000) {
      throw new BadRequestException(`Audio duration exceeds the ${this.#maxSeconds}-second limit`);
    }
    return result;
  }
}
