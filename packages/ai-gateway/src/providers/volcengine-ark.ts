import { OpenAiCompatibleAdapter } from './openai-compatible.js';
import type { HttpAdapterOptions } from '../http.js';
import type { ProviderKind } from '../types.js';

export interface VolcengineArkAdapterOptions extends Omit<HttpAdapterOptions, 'baseUrl'> {
  readonly baseUrl?: string;
}

export class VolcengineArkAdapter extends OpenAiCompatibleAdapter {
  override readonly kind: ProviderKind = 'volcengine-ark';

  constructor(options: VolcengineArkAdapterOptions) {
    super({
      ...options,
      baseUrl: options.baseUrl ?? 'https://ark.cn-beijing.volces.com/api/v3',
    });
  }
}
