export const AI_PROVIDER_IDS = [
  'deepseek',
  'mimo',
  'kimi',
  'qwen',
  'glm',
  'doubao',
  'custom',
] as const;

export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const PLAYABLE_AI_PROVIDER_IDS = ['deepseek', 'kimi'] as const;

export type PlayableAiProviderId = (typeof PLAYABLE_AI_PROVIDER_IDS)[number];

export const PLAYABLE_AI_DEFAULT_MODELS: Readonly<Record<PlayableAiProviderId, string>> = {
  deepseek: 'deepseek-v4-flash',
  kimi: 'kimi-k2.6',
};

export const AI_PERSONALITIES = ['logical', 'cautious', 'aggressive', 'fun'] as const;

export type AiPersonality = (typeof AI_PERSONALITIES)[number];

export interface AiSeatConfig {
  readonly providerId: AiProviderId;
  readonly modelId: string;
  readonly fallbackModelId?: string;
  readonly personality: AiPersonality;
}

export interface ProviderCapabilities {
  readonly structuredOutput: boolean;
  readonly transcription: boolean;
  readonly streaming: boolean;
  readonly maximumContextTokens?: number;
}

export interface ModelUsage {
  readonly providerId: AiProviderId;
  readonly modelId: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly estimatedCostMinorUnits: number;
  readonly currency: string;
}

export type MotionLevel = 'auto' | 'high' | 'medium' | 'low';
export type RuntimePerformanceTier = Exclude<MotionLevel, 'auto'>;

export interface UiPreferences {
  readonly motionLevel: MotionLevel;
  readonly soundEnabled: boolean;
  readonly hapticsEnabled: boolean;
  readonly masterVolume: number;
}
