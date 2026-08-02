import type { Winner } from '@werewolf/contracts';

import type { Role } from './types';

export interface ResultPresentation {
  readonly description: string;
  readonly ready: boolean;
  readonly title: string;
}

export function resultPresentation(winner: Winner | undefined): ResultPresentation {
  if (winner === 'good') {
    return {
      description: '所有狼人均已出局',
      ready: true,
      title: '好人阵营胜利',
    };
  }
  if (winner === 'werewolves') {
    return {
      description: '狼人已达成屠边条件',
      ready: true,
      title: '狼人阵营胜利',
    };
  }
  return {
    description: '正在等待服务器确认胜利阵营',
    ready: false,
    title: '结果同步中',
  };
}

export function countRevealedRoles(players: readonly { readonly role?: Role }[]): {
  readonly good: number;
  readonly wolf: number;
} {
  let good = 0;
  let wolf = 0;
  for (const player of players) {
    if (player.role === '狼人') {
      wolf += 1;
    } else if (player.role !== undefined) {
      good += 1;
    }
  }
  return { good, wolf };
}

const publicEventDescriptions: Readonly<Record<string, string>> = {
  'action.accepted': '玩家行动已确认',
  'ai.action': 'AI 玩家完成公开行动',
  'dawn.revealed': '黎明公布昨夜结果',
  'game.created': '对局已创建',
  'game.ended': '对局结束',
  'game.started': '对局正式开始',
  'night.resolved': '夜间行动结算完成',
  'phase.changed': '游戏进入下一阶段',
  'phase.force_advanced': '房主推进了游戏阶段',
  'player.died': '有玩家出局',
  'seer.result': '预言家完成一次查验',
  'vote.resolved': '放逐投票结算完成',
};

export function publicGameEventDescription(type: string): string {
  return publicEventDescriptions[type] ?? '公开事件已记录';
}
