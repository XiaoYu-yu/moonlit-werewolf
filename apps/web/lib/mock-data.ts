import { activeAiModels } from './ai-models';
import type { ChatMessage, PlayerSummary } from './types';

const personalities = ['逻辑型', '谨慎型', '激进型', '娱乐型'] as const;
const aiRoles = ['狼人', '狼人', '女巫', '村民', '狼人', '村民'] as const;

function makeDemoAiPlayer(index: number): PlayerSummary {
  const model = activeAiModels[index % activeAiModels.length] ?? activeAiModels[0];
  return {
    seat: index + 4,
    name: `${model.label} · ${index + 4}`,
    kind: 'ai',
    ready: true,
    alive: index !== 4,
    role: aiRoles[index] ?? '村民',
    ai: {
      provider: model.providerId,
      model: model.modelId,
      personality: personalities[index % personalities.length] ?? '逻辑型',
    },
  };
}

export const players: PlayerSummary[] = [
  { seat: 1, name: '山岚', kind: 'human', ready: true, alive: true, role: '预言家' },
  { seat: 2, name: '晚照', kind: 'human', ready: true, alive: true, role: '村民' },
  { seat: 3, name: '临川', kind: 'human', ready: true, alive: true, role: '猎人' },
  ...Array.from({ length: 6 }, (_, index) => makeDemoAiPlayer(index)),
];

export const initialMessages: ChatMessage[] = [
  {
    id: 'sys-1',
    seat: null,
    author: '法官',
    text: '天亮了。昨夜 8 号玩家倒牌，请从 1 号开始依次发言。',
    tone: 'system',
  },
  {
    id: 'm-1',
    seat: 1,
    author: '山岚',
    text: '昨夜的信息很关键，我建议大家先听完整轮发言，不要急着归票。',
    tone: 'normal',
  },
  {
    id: 'm-2',
    seat: 2,
    author: '晚照',
    text: '我会重点听 4、6 两个位置，他们昨天的站边有明显变化。',
    tone: 'normal',
  },
];
