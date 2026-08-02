import { PLAYABLE_AI_DEFAULT_MODELS } from '@werewolf/contracts';

import type { AiPersonality } from './types';

export const activeAiModels = [
  {
    label: 'DeepSeek',
    providerId: 'deepseek',
    modelId: PLAYABLE_AI_DEFAULT_MODELS.deepseek,
    accent: '#d8ad62',
  },
  {
    label: 'Kimi',
    providerId: 'kimi',
    modelId: PLAYABLE_AI_DEFAULT_MODELS.kimi,
    accent: '#91b9d6',
  },
] as const;

export type ActiveAiModel = (typeof activeAiModels)[number];
export type ActiveAiProviderId = ActiveAiModel['providerId'];

export const aiPersonalities = [
  { id: 'logical', label: '逻辑型', description: '重视证据链和发言矛盾' },
  { id: 'cautious', label: '谨慎型', description: '保守站边，延迟暴露身份' },
  { id: 'aggressive', label: '激进型', description: '主动施压，快速推动归票' },
  { id: 'fun', label: '娱乐型', description: '表达生动但仍遵守规则' },
] as const;

export type AiPersonalityId = (typeof aiPersonalities)[number]['id'];

export function findActiveAiModel(value: string | undefined): ActiveAiModel | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  return activeAiModels.find(
    (model) =>
      model.label.toLowerCase() === normalized ||
      model.modelId.toLowerCase() === normalized ||
      model.providerId === normalized,
  );
}

export function personalityLabel(value: string | undefined): AiPersonality {
  return aiPersonalities.find((personality) => personality.id === value)?.label ?? '逻辑型';
}

export function isActiveProvider(value: { id?: string; name?: string; slug?: string }): boolean {
  const candidates = [value.id, value.name, value.slug]
    .filter((candidate): candidate is string => typeof candidate === 'string')
    .map((candidate) => candidate.toLowerCase());
  return activeAiModels.some((model) =>
    candidates.some(
      (candidate) =>
        candidate === model.providerId ||
        candidate === model.label.toLowerCase() ||
        candidate.includes(model.providerId),
    ),
  );
}
