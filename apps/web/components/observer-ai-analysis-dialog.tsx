'use client';

import * as Dialog from '@radix-ui/react-dialog';
import type { AiPersonality, GamePhase, Role } from '@werewolf/contracts';
import * as m from 'motion/react-m';
import { useMemo, type RefObject } from 'react';

import { findActiveAiModel, personalityLabel } from '@/lib/ai-models';
import { motionTokens } from '@/lib/motion';
import {
  observerThoughtsForActor,
  type ActiveAiDecision,
  type ObserverAiThought,
} from '@/lib/observer-thoughts';

import { Icons } from './icons';

const roleLabels: Record<Role, string> = {
  werewolf: '狼人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
};

const phaseLabels: Record<GamePhase, string> = {
  lobby: '阵容就绪',
  role_reveal: '身份确认',
  night_guard: '守卫行动',
  night_werewolves: '狼人行动',
  night_seer: '预言家查验',
  night_witch: '女巫行动',
  dawn: '黎明结算',
  last_words: '遗言阶段',
  discussion: '白天发言',
  voting: '放逐投票',
  hunter_shot: '猎人开枪',
  resolution: '回合结算',
  ended: '对局结束',
};

const actionLabels: Readonly<Record<string, string>> = {
  speak: '公开发言',
  vote: '放逐投票',
  night: '夜间行动',
};

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

export interface ObserverAnalysisSeat {
  readonly playerId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly role?: Role;
  readonly alive: boolean;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly personality?: AiPersonality;
}

function lifecycleCopy(activeDecision: ActiveAiDecision | undefined): string {
  if (!activeDecision) return '等待该 AI 的下一次行动';
  if (activeDecision.status === 'thinking') return '真实模型请求进行中';
  if (activeDecision.status === 'summary_ready') return '可公开分析已经返回';
  return '本回合正在使用规则兜底';
}

export function ObserverAiAnalysisDialog({
  activeDecision,
  onOpenChange,
  open,
  returnFocusRef,
  seat,
  thoughts,
}: {
  activeDecision: ActiveAiDecision | undefined;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  seat: ObserverAnalysisSeat | undefined;
  thoughts: readonly ObserverAiThought[];
}) {
  const seatThoughts = useMemo(
    () => (seat ? observerThoughtsForActor(thoughts, seat.playerId) : []),
    [seat, thoughts],
  );
  const selectedDecision = activeDecision?.actorId === seat?.playerId ? activeDecision : undefined;
  const model = findActiveAiModel(seat?.providerId);

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        <Dialog.Overlay asChild>
          <m.div
            animate={{ opacity: 1 }}
            className="dialog-overlay observer-analysis-overlay"
            initial={{ opacity: 0 }}
            transition={motionTokens.instant}
          />
        </Dialog.Overlay>
        <Dialog.Content
          asChild
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocusRef.current?.focus();
          }}
        >
          <m.section
            animate={{ opacity: 1, x: 0 }}
            aria-describedby="observer-analysis-description"
            className="observer-analysis-dialog ornate-panel"
            data-testid="observer-analysis-drawer"
            initial={{ opacity: 0, x: 32 }}
            transition={motionTokens.standard}
          >
            <header className="observer-analysis-header">
              <div className="observer-analysis-avatar" aria-hidden="true">
                {seat?.seatNumber ?? '·'}
              </div>
              <div>
                <p className="panel-kicker">观察者私密视图</p>
                <Dialog.Title data-testid="observer-analysis-title">
                  {seat ? `${seat.seatNumber} 号 ${seat.nickname}` : 'AI 分析'}
                </Dialog.Title>
                <p className="observer-analysis-seat-meta">
                  {seat?.role ? roleLabels[seat.role] : '身份同步中'} ·{' '}
                  {model?.label ?? seat?.providerId ?? '模型同步中'} ·{' '}
                  {seat?.personality ? personalityLabel(seat.personality) : '性格同步中'}
                </p>
                {seat ? (
                  <div className="observer-analysis-badges" aria-label="AI 席位状态">
                    <span data-alive={seat.alive ? 'true' : 'false'}>
                      {seat.alive ? '存活' : '已出局'}
                    </span>
                    {seat.modelId ? <span translate="no">{seat.modelId}</span> : null}
                  </div>
                ) : null}
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="关闭 AI 分析"
                  className="dialog-close"
                  data-testid="observer-analysis-close"
                  type="button"
                >
                  <Icons.close />
                </button>
              </Dialog.Close>
            </header>

            <Dialog.Description
              className="observer-analysis-disclosure"
              id="observer-analysis-description"
            >
              <Icons.shield size={17} />
              <span>
                这里仅展示模型主动提供给观察者的可公开分析与最终判断，不是隐藏思维链、系统提示词或原始推理令牌。
              </span>
            </Dialog.Description>

            <div
              className={`observer-analysis-status ${
                selectedDecision ? `status-${selectedDecision.status}` : ''
              }`}
              data-testid="observer-analysis-current-status"
            >
              <span aria-hidden="true" />
              <div>
                <strong>{lifecycleCopy(selectedDecision)}</strong>
                <small>
                  {selectedDecision
                    ? `${phaseLabels[selectedDecision.phase]} · ${
                        actionLabels[selectedDecision.actionType]
                      } · ${selectedDecision.modelId}`
                    : seatThoughts.length > 0
                      ? `已记录 ${seatThoughts.length} 次可查看的行动分析`
                      : '该 AI 行动后，真实返回内容会按时间记录在这里'}
                </small>
              </div>
            </div>

            <div
              aria-label={seat ? `${seat.seatNumber} 号 AI 的分析记录` : 'AI 分析记录'}
              className="observer-analysis-timeline"
              data-testid="observer-analysis-feed"
            >
              {seatThoughts.length === 0 ? (
                <div className="observer-analysis-empty" data-testid="observer-analysis-empty">
                  <Icons.bot size={28} />
                  <strong>
                    {selectedDecision?.status === 'thinking'
                      ? '真实模型正在生成本回合内容'
                      : '尚无可公开分析'}
                  </strong>
                  <p>未收到供应商返回前不会生成占位分析，也不会把规则兜底冒充模型输出。</p>
                </div>
              ) : (
                seatThoughts.map((thought) => {
                  const hasVisibleAnalysis = Boolean(thought.visibleAnalysis);
                  return (
                    <article
                      className="observer-analysis-entry"
                      data-actor-id={thought.actorId}
                      data-phase={thought.phase}
                      data-provider-id={thought.providerId}
                      data-round={thought.round}
                      data-source={thought.source}
                      data-testid={`observer-analysis-entry-${thought.id}`}
                      key={thought.id}
                    >
                      <header>
                        <div>
                          <strong>
                            第 {thought.round} 轮 · {phaseLabels[thought.phase]}
                          </strong>
                          <small>{actionLabels[thought.actionType] ?? thought.actionType}</small>
                        </div>
                        <span className={`observer-source-badge source-${thought.source}`}>
                          {thought.source === 'provider' ? '真实模型返回' : '规则兜底'}
                        </span>
                      </header>

                      {thought.source === 'provider' && thought.visibleAnalysis ? (
                        <section
                          className="observer-analysis-visible-copy"
                          data-testid={`observer-analysis-visible-${thought.id}`}
                        >
                          <h3>模型提供的可公开分析</h3>
                          <p>{thought.visibleAnalysis}</p>
                        </section>
                      ) : null}

                      {thought.source === 'provider' && !hasVisibleAnalysis ? (
                        <p
                          className="observer-analysis-unavailable"
                          data-testid={`observer-analysis-visible-missing-${thought.id}`}
                        >
                          本回合供应商只返回了短结论，没有返回更完整的可公开分析。
                        </p>
                      ) : null}

                      <section
                        className="observer-analysis-summary"
                        data-testid={`observer-analysis-summary-${thought.id}`}
                      >
                        <h3>{thought.source === 'provider' ? '最终判断摘要' : '规则兜底说明'}</h3>
                        <p>{thought.content}</p>
                      </section>

                      <footer>
                        <span>
                          {findActiveAiModel(thought.providerId)?.label ?? thought.providerId} ·{' '}
                          {thought.modelId}
                        </span>
                        <time dateTime={new Date(thought.timestamp).toISOString()}>
                          {timeFormatter.format(thought.timestamp)}
                        </time>
                      </footer>
                    </article>
                  );
                })
              )}
            </div>
          </m.section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
