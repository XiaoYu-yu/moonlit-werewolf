import { PLAYABLE_AI_DEFAULT_MODELS } from '@werewolf/contracts';
import { describe, expect, it } from 'vitest';

import { activeAiModels, findActiveAiModel, isActiveProvider, personalityLabel } from './ai-models';

describe('playable AI models', () => {
  it('exposes only the two runtime-supported providers and shared default model ids', () => {
    expect(activeAiModels.map((model) => model.providerId)).toEqual(['deepseek', 'kimi']);
    expect(activeAiModels.map((model) => model.modelId)).toEqual([
      PLAYABLE_AI_DEFAULT_MODELS.deepseek,
      PLAYABLE_AI_DEFAULT_MODELS.kimi,
    ]);
  });

  it('resolves a model from provider, label, or exact model id', () => {
    expect(findActiveAiModel('DeepSeek')?.providerId).toBe('deepseek');
    expect(findActiveAiModel('kimi-k2.6')?.providerId).toBe('kimi');
    expect(findActiveAiModel('inactive-model')).toBeUndefined();
  });

  it('filters inactive provider records and maps configured personalities', () => {
    expect(isActiveProvider({ id: 'stored-1', slug: 'deepseek', name: 'DeepSeek' })).toBe(true);
    expect(
      isActiveProvider({ id: 'stored-2', slug: 'inactive-provider', name: '未启用供应商' }),
    ).toBe(false);
    expect(personalityLabel('aggressive')).toBe('激进型');
    expect(personalityLabel(undefined)).toBe('逻辑型');
  });
});
