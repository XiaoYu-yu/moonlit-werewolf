export type { MotionLevel, RuntimePerformanceTier, UiPreferences } from '@werewolf/contracts';

export type GamePhase = 'lobby' | 'role' | 'day' | 'night' | 'result';
export type PlayerKind = 'human' | 'ai' | 'takeover';
export type Role = '狼人' | '村民' | '预言家' | '女巫' | '猎人' | '守卫';
export type AiPersonality = '逻辑型' | '谨慎型' | '激进型' | '娱乐型';

export interface AiSeatConfig {
  provider: string;
  model: string;
  personality: AiPersonality;
}

export interface PlayerSummary {
  seat: number;
  name: string;
  kind: PlayerKind;
  ready: boolean;
  alive: boolean;
  role?: Role;
  ai?: AiSeatConfig;
}

export interface ChatMessage {
  id: string;
  seat: number | null;
  author: string;
  text: string;
  tone?: 'system' | 'normal' | 'accent';
}
