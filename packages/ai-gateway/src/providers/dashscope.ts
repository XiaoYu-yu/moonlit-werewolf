import { OpenAiCompatibleAdapter } from './openai-compatible.js';
import type { HttpAdapterOptions } from '../http.js';
import type { ProviderKind } from '../types.js';

export interface DashScopeAdapterOptions extends Omit<HttpAdapterOptions, 'baseUrl'> {
  readonly baseUrl?: string;
}

export class DashScopeChatAdapter extends OpenAiCompatibleAdapter {
  override readonly kind: ProviderKind = 'dashscope';

  constructor(options: DashScopeAdapterOptions) {
    super({
      ...options,
      baseUrl: options.baseUrl ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    });
  }
}
