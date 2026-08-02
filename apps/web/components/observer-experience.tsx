'use client';

import type {
  GameAction,
  GameEvent,
  GamePhase,
  ObserverPlayerState,
  Role,
} from '@werewolf/contracts';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { memo, useEffect, useMemo, useRef, useState } from 'react';

import { findActiveAiModel, personalityLabel } from '@/lib/ai-models';
import type { LiveGameEvent, LiveRoomState, ObserverPrivateState } from '@/lib/live-api';
import { motionTokens } from '@/lib/motion';
import { buildObserverDiscussion } from '@/lib/observer-discussion';
import {
  normalizeActiveAiDecision,
  normalizeObserverThoughtHistory,
  OBSERVER_FALLBACK_GUIDANCE,
} from '@/lib/observer-thoughts';
import type { ActiveAiDecision, AiThoughtSource, ObserverAiThought } from '@/lib/observer-thoughts';
import { haptic, playUiTone } from '@/lib/sensory';

import { useUiPreferences } from './app-providers';
import { Icons } from './icons';
import { ObserverAiAnalysisDialog, type ObserverAnalysisSeat } from './observer-ai-analysis-dialog';
import { ObserverDiscussionTimeline } from './observer-discussion-timeline';
import { ParticleCanvas } from './particle-canvas';
import { SiteHeader } from './site-header';

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
  night: '夜间技能',
  acknowledge_role: '确认身份',
  guard: '守卫选择',
  werewolf_vote: '狼人袭击',
  seer_check: '预言家查验',
  witch: '女巫用药',
  finish_speech: '公开发言',
  day_vote: '放逐投票',
  hunter_shot: '猎人开枪',
};

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

const observerProgress = [
  { id: 'role', label: '身份', phases: ['lobby', 'role_reveal'] },
  {
    id: 'night',
    label: '夜间',
    phases: ['night_guard', 'night_werewolves', 'night_seer', 'night_witch'],
  },
  { id: 'dawn', label: '黎明', phases: ['dawn', 'resolution'] },
  { id: 'discussion', label: '发言', phases: ['last_words', 'discussion'] },
  { id: 'voting', label: '投票', phases: ['voting', 'hunter_shot'] },
  { id: 'ended', label: '结算', phases: ['ended'] },
] as const;

function phaseTone(phase: GamePhase): 'tap' | 'reveal' | 'confirm' | 'victory' {
  if (phase === 'role_reveal') return 'reveal';
  if (phase === 'ended') return 'victory';
  if (phase === 'dawn' || phase === 'voting') return 'confirm';
  return 'tap';
}

function isNightPhase(phase: GamePhase): boolean {
  return phase.startsWith('night');
}

function phaseGroupIndex(phase: GamePhase): number {
  const index = observerProgress.findIndex((item) =>
    (item.phases as readonly string[]).includes(phase),
  );
  return Math.max(0, index);
}

function sourceLabel(source: AiThoughtSource): string {
  return source === 'provider' ? '真实模型' : '规则兜底';
}

function decisionSource(decision: ActiveAiDecision | undefined): AiThoughtSource | undefined {
  if (decision?.status === 'fallback') return 'fallback';
  return decision?.source;
}

function lifecycleLabel(status: ActiveAiDecision['status']): string {
  if (status === 'thinking') return '正在生成决策';
  if (status === 'summary_ready') return '决策摘要已返回';
  return '规则兜底处理中';
}

function playerName(room: LiveRoomState, playerId: unknown): string {
  if (typeof playerId !== 'string') return '未知玩家';
  const seat = room.seats.find((item) => item.id === playerId);
  return seat ? `${seat.number} 号 ${seat.nickname}` : '未知玩家';
}

function actionDescription(event: GameEvent, room: LiveRoomState): string {
  if (event.kind === 'action.accepted') {
    const action = event.payload.action as GameAction | undefined;
    if (!action) return '服务器接受了一次行动';
    const actor = playerName(room, action.actorId);
    if (action.type === 'acknowledge_role') return `${actor} 已确认身份`;
    if (action.type === 'finish_speech') return `${actor} 完成发言`;
    if (action.type === 'witch') {
      const poison = action.poisonTargetId
        ? `，毒药目标 ${playerName(room, action.poisonTargetId)}`
        : '';
      return `${actor} ${action.useHeal ? '使用了解药' : '未使用解药'}${poison}`;
    }
    const targetId = 'targetId' in action ? action.targetId : undefined;
    const target = targetId ? playerName(room, targetId) : '放弃行动';
    const verbs: Partial<Record<GameAction['type'], string>> = {
      guard: '守护',
      werewolf_vote: '选择袭击',
      seer_check: '查验',
      day_vote: '投票给',
      hunter_shot: '选择带走',
    };
    return `${actor} ${verbs[action.type] ?? '行动目标'} ${target}`;
  }
  if (event.kind === 'seer.result') {
    const target = playerName(room, event.payload.targetId);
    return `预言家查验 ${target}：${event.payload.alignment === 'werewolves' ? '狼人' : '好人'}`;
  }
  if (event.kind === 'vote.resolved') {
    const eliminated = event.payload.eliminatedId;
    return eliminated
      ? `投票结束，${playerName(room, eliminated)} 被放逐`
      : '投票结束，本轮无人被放逐';
  }
  if (event.kind === 'player.died') {
    return `${playerName(room, event.payload.playerId)} 出局`;
  }
  if (event.kind === 'night.resolved') return '夜间全部行动已经结算';
  if (event.kind === 'dawn.revealed') return '天亮了，公布昨夜结果';
  if (event.kind === 'game.started') return '全部 AI 已确认身份，对局开始';
  if (event.kind === 'game.ended') {
    return `对局结束：${event.payload.winner === 'werewolves' ? '狼人阵营' : '好人阵营'}获胜`;
  }
  if (event.kind === 'phase.changed') return `阶段切换至 ${phaseLabels[event.phase]}`;
  return event.kind;
}

export function ObserverExperience({
  error,
  events,
  onHostControl,
  observerState,
  pending,
  room,
  roomCode,
  seconds,
}: {
  error: string | undefined;
  events: readonly LiveGameEvent[];
  onHostControl: (command: 'pause' | 'resume' | 'advance') => Promise<boolean>;
  observerState: ObserverPrivateState | undefined;
  pending: string | null;
  room: LiveRoomState;
  roomCode: string;
  seconds: number;
}) {
  const { preferences } = useUiPreferences();
  const previousPhase = useRef<GamePhase | undefined>(undefined);
  const lastAnalysisTrigger = useRef<HTMLButtonElement | null>(null);
  const [selectedAnalysisActorId, setSelectedAnalysisActorId] = useState<string>();
  const phase = observerState?.phase ?? (room.phase === 'night' ? 'night_werewolves' : room.phase);
  const round = observerState?.round ?? room.game?.round ?? 1;
  const roles = observerState?.roles ?? [];
  const rolesByPlayer = useMemo(
    () => new Map(roles.map((player) => [player.playerId, player])),
    [roles],
  );
  const rawThoughtHistory = observerState?.aiThoughtHistory;
  const rawActiveDecision = observerState?.activeDecision;
  const thoughtItems = useMemo(
    () => normalizeObserverThoughtHistory(rawThoughtHistory),
    [rawThoughtHistory],
  );
  const activeDecision = useMemo(
    () => normalizeActiveAiDecision(rawActiveDecision),
    [rawActiveDecision],
  );
  const thoughtCountByActor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thought of thoughtItems) {
      counts.set(thought.actorId, (counts.get(thought.actorId) ?? 0) + 1);
    }
    return counts;
  }, [thoughtItems]);
  const actionItems = useMemo(
    () =>
      (observerState?.actions ?? [])
        .filter((event) => event.kind !== 'phase.changed' || event.sequence > 0)
        .slice(-36)
        .reverse(),
    [observerState?.actions],
  );
  const discussionItems = useMemo(
    () => buildObserverDiscussion(observerState?.chatHistory, events, round),
    [events, observerState?.chatHistory, round],
  );
  const seatsByPlayer = useMemo(
    () => new Map(room.seats.map((seat) => [seat.id, seat])),
    [room.seats],
  );
  const publicPlayersById = useMemo(
    () => new Map((room.game?.players ?? []).map((player) => [player.id, player])),
    [room.game?.players],
  );
  const currentActorIds = observerState?.currentActorIds ?? room.game?.currentActorIds ?? [];
  const visibleActiveDecision =
    activeDecision?.phase === phase && activeDecision.round === round ? activeDecision : undefined;
  const activeDecisionSource = decisionSource(visibleActiveDecision);
  const thinkingActorId = visibleActiveDecision?.actorId;
  const activeGroup = phaseGroupIndex(phase);
  const winner = observerState?.winner ?? room.game?.winner;
  const selectedAnalysisSeat = useMemo<ObserverAnalysisSeat | undefined>(() => {
    if (!selectedAnalysisActorId) return undefined;
    const seat = seatsByPlayer.get(selectedAnalysisActorId);
    if (!seat) return undefined;
    const roleState = rolesByPlayer.get(selectedAnalysisActorId);
    const providerId = roleState?.providerId ?? seat.ai?.providerId;
    const modelId = roleState?.modelId ?? seat.ai?.modelId;
    const personality = roleState?.personality ?? seat.ai?.personality;
    return {
      playerId: seat.id,
      seatNumber: seat.number,
      nickname: seat.nickname,
      ...(roleState?.role ? { role: roleState.role } : {}),
      alive: roleState?.alive ?? publicPlayersById.get(seat.id)?.alive ?? true,
      ...(providerId ? { providerId } : {}),
      ...(modelId ? { modelId } : {}),
      ...(personality ? { personality } : {}),
    };
  }, [publicPlayersById, rolesByPlayer, seatsByPlayer, selectedAnalysisActorId]);

  useEffect(() => {
    if (previousPhase.current && previousPhase.current !== phase) {
      const tone = phaseTone(phase);
      playUiTone(tone, preferences);
      haptic(tone === 'reveal' ? 'reveal' : tone === 'tap' ? 'tap' : 'confirm', preferences);
    }
    previousPhase.current = phase;
  }, [phase, preferences]);

  return (
    <main
      className={`game-page observer-page ${
        isNightPhase(phase) ? 'phase-night' : phase === 'ended' ? 'phase-result' : 'phase-day'
      }`}
      id="main-content"
    >
      <div className="game-background" aria-hidden="true">
        <div className="game-moon" />
        <div className="roofline" />
        <div className="mist-layer" />
      </div>
      <AnimatePresence initial={false}>
        <m.div
          animate={{ opacity: 0 }}
          aria-hidden="true"
          className={`phase-light phase-light--${isNightPhase(phase) ? 'night' : 'day'}`}
          initial={{ opacity: 0.58 }}
          key={phase}
          transition={motionTokens.phase}
        />
      </AnimatePresence>
      {phase === 'ended' ? <ParticleCanvas mode="embers" /> : null}
      <SiteHeader
        compact
        connectionLabel="AI 全知观战"
        playerCount={room.seats.length}
        roomCode={roomCode}
      />

      <div
        aria-live="polite"
        className="connection-strip connection-strip--observer"
        data-testid="observer-connection-mode"
      >
        <span aria-hidden="true" />
        全知观察者 · 不占玩家席位 · 对局由 AI 自动推进
        {error ? <strong>{error}</strong> : null}
      </div>

      <div className="game-topbar observer-topbar">
        <div className="phase-status">
          <span>第 {round} 轮</span>
          <strong>{phaseLabels[phase]}</strong>
        </div>
        <div className="observer-live-status" data-source={activeDecisionSource ?? 'waiting'}>
          <i aria-hidden="true" />
          {room.isPaused
            ? '已暂停'
            : visibleActiveDecision
              ? `${visibleActiveDecision.seatNumber} 号 · ${lifecycleLabel(
                  visibleActiveDecision.status,
                )}`
              : currentActorIds.length > 0
                ? '等待真实模型状态'
                : '自动结算中'}
          {seconds > 0 ? <b>{seconds}s</b> : null}
        </div>
        <button
          className="secondary-button compact-button"
          data-testid="observer-pause-toggle"
          disabled={pending !== null}
          onClick={() => void onHostControl(room.isPaused ? 'resume' : 'pause')}
          aria-label={room.isPaused ? '继续 AI 观战对局' : '立即暂停 AI 观战对局'}
          type="button"
        >
          {room.isPaused ? '继续观战 ▶' : '暂停观战 Ⅱ'}
        </button>
      </div>

      <ol aria-label="AI 对局进度" className="observer-progress">
        {observerProgress.map((item, index) => (
          <li
            aria-current={index === activeGroup ? 'step' : undefined}
            className={index === activeGroup ? 'active' : index < activeGroup ? 'complete' : ''}
            key={item.id}
          >
            <span>{index < activeGroup ? '✓' : index + 1}</span>
            {item.label}
          </li>
        ))}
      </ol>

      <section
        className="observer-stage"
        data-phase={phase}
        data-testid={`observer-stage-${phase}`}
      >
        <ObserverThinkingStage
          paused={room.isPaused}
          role={
            visibleActiveDecision ? rolesByPlayer.get(visibleActiveDecision.actorId) : undefined
          }
          status={visibleActiveDecision}
        />

        {phase === 'ended' ? (
          <div className="observer-result-banner ornate-panel">
            <Icons.sun size={26} />
            <div>
              <span>AI 对局已经结束</span>
              <strong>
                {winner
                  ? winner === 'werewolves'
                    ? '狼人阵营胜利'
                    : '好人阵营胜利'
                  : '胜负结果同步中'}
              </strong>
            </div>
            <a className="primary-button compact-button" href="/">
              返回首页
            </a>
          </div>
        ) : null}

        <section className="observer-roles ornate-panel">
          <div className="section-heading">
            <div>
              <p className="panel-kicker">全身份视图</p>
              <h1>{room.preset} 席 AI 阵容</h1>
              <p>点击任一席位，可查看该 AI 按时间记录的模型可公开分析。</p>
            </div>
            <span className="observer-private-badge">
              <Icons.shield size={14} />
              观察者私密数据
            </span>
          </div>
          <div className="observer-role-grid" data-testid="observer-role-grid">
            {room.seats.map((seat, index) => {
              const roleState = rolesByPlayer.get(seat.id);
              const providerId = roleState?.providerId ?? seat.ai?.providerId;
              const model = findActiveAiModel(providerId);
              const modelId = roleState?.modelId ?? seat.ai?.modelId;
              const personality = roleState?.personality ?? seat.ai?.personality;
              const thinking = thinkingActorId === seat.id;
              const alive = roleState?.alive ?? publicPlayersById.get(seat.id)?.alive ?? true;
              const selected = selectedAnalysisActorId === seat.id;
              const thoughtCount = thoughtCountByActor.get(seat.id) ?? 0;
              return (
                <m.article
                  animate={{ opacity: 1, y: 0 }}
                  className={`observer-role-card ${
                    roleState?.role === 'werewolf' ? 'wolf' : 'good'
                  } ${thinking ? 'thinking' : ''} ${alive ? '' : 'dead'} ${
                    selected ? 'selected' : ''
                  }`}
                  data-selected={selected ? 'true' : 'false'}
                  data-thinking={thinking ? 'true' : 'false'}
                  initial={{ opacity: 0, y: 10 }}
                  key={seat.id}
                  transition={{ ...motionTokens.spring, delay: index * 0.025 }}
                >
                  <button
                    aria-expanded={selected}
                    aria-haspopup="dialog"
                    aria-label={`查看 ${seat.number} 号 ${seat.nickname} 的 AI 可公开分析`}
                    data-testid={`observer-seat-analysis-${seat.number}`}
                    onClick={(event) => {
                      lastAnalysisTrigger.current = event.currentTarget;
                      setSelectedAnalysisActorId(seat.id);
                    }}
                    type="button"
                  >
                    <span className="observer-seat-number">{seat.number}</span>
                    <span className="observer-bot-portrait" aria-hidden="true">
                      <Icons.bot size={24} />
                      <i>{model?.label.slice(0, 2) ?? 'AI'}</i>
                    </span>
                    <span className="observer-role-identity">
                      <strong>{seat.nickname}</strong>
                      <small title={`${modelId ?? ''} · ${personalityLabel(personality)}`}>
                        {model?.label ?? providerId ?? 'AI'} · {personalityLabel(personality)}
                      </small>
                    </span>
                    <b>{roleState ? roleLabels[roleState.role] : '身份同步中'}</b>
                    <span className="observer-analysis-count">{thoughtCount} 条分析</span>
                    {thinking ? (
                      <em>
                        {activeDecisionSource === 'fallback'
                          ? '规则兜底'
                          : visibleActiveDecision?.status === 'summary_ready'
                            ? '分析已返回'
                            : '模型生成中'}
                      </em>
                    ) : !alive ? (
                      <em>{roleState?.death ? `第 ${roleState.death.round} 轮出局` : '已出局'}</em>
                    ) : null}
                  </button>
                </m.article>
              );
            })}
          </div>
        </section>

        <ObserverDiscussionTimeline
          activeDecision={visibleActiveDecision}
          currentActorId={
            (phase === 'discussion' || phase === 'last_words') &&
            (!visibleActiveDecision || visibleActiveDecision.actionType === 'speak')
              ? currentActorIds[0]
              : undefined
          }
          items={discussionItems}
          room={room}
        />

        <div className="observer-detail-grid">
          <ObserverThoughtChannel
            activeSource={activeDecisionSource}
            onSelectActor={(actorId, trigger) => {
              lastAnalysisTrigger.current = trigger;
              setSelectedAnalysisActorId(actorId);
            }}
            rolesByPlayer={rolesByPlayer}
            thoughts={thoughtItems}
          />
          <section className="observer-actions ornate-panel">
            <div className="observer-panel-heading">
              <div>
                <p className="panel-kicker">私密行动轨迹</p>
                <h2>夜间、投票与结算</h2>
              </div>
              <span>{actionItems.length} 条</span>
            </div>
            <ObserverActionFeed actions={actionItems} room={room} />
          </section>
        </div>
      </section>

      <ObserverAiAnalysisDialog
        activeDecision={visibleActiveDecision}
        onOpenChange={(open) => {
          if (!open) setSelectedAnalysisActorId(undefined);
        }}
        open={selectedAnalysisActorId !== undefined}
        returnFocusRef={lastAnalysisTrigger}
        seat={selectedAnalysisSeat}
        thoughts={thoughtItems}
      />
    </main>
  );
}

const ObserverActionFeed = memo(function ObserverActionFeed({
  actions,
  room,
}: {
  actions: readonly GameEvent[];
  room: LiveRoomState;
}) {
  return (
    <ol
      aria-label="AI 对局私密行动轨迹"
      aria-live="off"
      className="observer-action-feed"
      data-testid="observer-action-feed"
    >
      {actions.length === 0 ? (
        <li className="observer-waiting">正在等待首个权威行动事件…</li>
      ) : (
        actions.map((event) => (
          <m.li
            animate={{ opacity: 1, x: 0 }}
            initial={{ opacity: 0, x: -8 }}
            key={`${event.sequence}-${event.kind}`}
          >
            <span>{event.sequence}</span>
            <div>
              <small>
                第 {event.round} 轮 · {phaseLabels[event.phase]}
              </small>
              <p>{actionDescription(event, room)}</p>
            </div>
          </m.li>
        ))
      )}
    </ol>
  );
});

const ObserverThinkingStage = memo(function ObserverThinkingStage({
  paused,
  role,
  status,
}: {
  paused: boolean;
  role: ObserverPlayerState | undefined;
  status: ActiveAiDecision | undefined;
}) {
  const providerId = status?.providerId ?? role?.providerId;
  const modelId = status?.modelId ?? role?.modelId;
  const model = findActiveAiModel(providerId);
  const isActivelyThinking = status?.status === 'thinking';
  const activeSource = decisionSource(status);
  const stageAnnouncement = paused
    ? status
      ? `${status.seatNumber} 号 ${status.nickname} 的当前决策已冻结，恢复后继续同一回合，不会重复调用模型。`
      : 'AI 观战对局已暂停。'
    : status
      ? `${status.seatNumber} 号 ${status.nickname}，${lifecycleLabel(status.status)}。`
      : '等待服务器发出真实模型调用状态。';

  return (
    <>
      <div aria-atomic="true" aria-live="polite" className="sr-only" role="status">
        {stageAnnouncement}
      </div>
      <section
        aria-busy={isActivelyThinking}
        className={`observer-thinking-stage ornate-panel ${
          status ? `status-${status.status}` : 'status-waiting'
        }`}
        data-actor-id={status?.actorId}
        data-source={activeSource ?? 'waiting'}
        data-status={status?.status ?? 'waiting'}
        data-testid="observer-thinking-stage"
        data-turn-id={status?.turnId}
      >
        <span className="observer-thinking-avatar" aria-hidden="true">
          {status?.seatNumber ?? '·'}
          {isActivelyThinking ? <i /> : null}
        </span>
        <div className="observer-thinking-copy">
          <p className="panel-kicker">当前决策席位</p>
          {paused ? (
            status ? (
              <>
                <strong>当前决策已冻结</strong>
                <small>恢复后继续同一回合的剩余展示时间，不会重复调用模型。</small>
              </>
            ) : (
              <>
                <strong>观战已暂停</strong>
                <small>恢复后，下一次真实模型调用状态会显示在这里。</small>
              </>
            )
          ) : status ? (
            <>
              <strong>
                {status.seatNumber} 号 {status.nickname} · {lifecycleLabel(status.status)}
              </strong>
              <small>
                {status.status === 'thinking'
                  ? '计划模型'
                  : status.status === 'fallback'
                    ? '原计划模型'
                    : '实际模型'}
                ：{model?.label ?? providerId ?? 'AI'} · {modelId ?? '默认模型'} ·{' '}
                {role ? roleLabels[role.role] : phaseLabels[status.phase]} ·{' '}
                {actionLabels[status.actionType ?? ''] ?? '本阶段行动'}
                {status.status === 'thinking' ? ' · 实际来源以返回结果为准' : ''}
              </small>
            </>
          ) : (
            <>
              <strong>等待服务器发出真实模型调用状态</strong>
              <small>尚未收到状态时不会模拟“思考中”，也不会生成占位摘要。</small>
            </>
          )}
        </div>
        <div className="observer-thinking-source">
          <span>
            {status ? (activeSource ? sourceLabel(activeSource) : '正在确认调用来源') : '等待状态'}
          </span>
          {isActivelyThinking ? (
            <i className="observer-thinking-dots" aria-label="模型正在生成决策">
              <b />
              <b />
              <b />
            </i>
          ) : null}
        </div>
        <span className="observer-thinking-progress" aria-hidden="true">
          <i />
        </span>
      </section>
    </>
  );
});

const ObserverThoughtChannel = memo(function ObserverThoughtChannel({
  activeSource,
  onSelectActor,
  rolesByPlayer,
  thoughts,
}: {
  activeSource: AiThoughtSource | undefined;
  onSelectActor: (actorId: string, trigger: HTMLButtonElement) => void;
  rolesByPlayer: ReadonlyMap<string, ObserverPlayerState>;
  thoughts: readonly ObserverAiThought[];
}) {
  const orderedThoughts = useMemo(() => thoughts.slice(-18).toReversed(), [thoughts]);
  const hasProviderSummary = thoughts.some((thought) => thought.source === 'provider');
  const onlyFallback = (thoughts.length > 0 && !hasProviderSummary) || activeSource === 'fallback';
  const announcement = useNewThoughtAnnouncement(thoughts);

  return (
    <section className="observer-thoughts ornate-panel" data-testid="observer-thought-channel">
      <div aria-atomic="true" aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <div className="observer-panel-heading">
        <div>
          <p className="panel-kicker">观察者私密频道</p>
          <h2>最近的 AI 可公开分析</h2>
          <p>点击任一记录查看该席位完整历史；内容不包含隐藏思维链或系统提示词。</p>
        </div>
        <span>{thoughts.length} 条决策记录</span>
      </div>

      {onlyFallback ? (
        <div className="observer-thought-warning" role="status">
          <Icons.shield size={15} />
          <div>
            <strong>本次调用未产生可执行的真实模型摘要，已使用规则兜底</strong>
            <span>{OBSERVER_FALLBACK_GUIDANCE}</span>
          </div>
        </div>
      ) : null}

      <div className="observer-thought-feed">
        {orderedThoughts.length === 0 ? (
          <div className="observer-thought-empty">
            <span aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <div>
              <strong>
                {activeSource === 'provider' ? '真实模型正在生成决策' : '等待第一条模型决策摘要'}
              </strong>
              <p>
                {activeSource === 'fallback'
                  ? OBSERVER_FALLBACK_GUIDANCE
                  : '收到服务端观战私有记录后才会在这里显示文字。'}
              </p>
            </div>
          </div>
        ) : (
          orderedThoughts.map((thought) => {
            const roleState = rolesByPlayer.get(thought.actorId);
            const model = findActiveAiModel(thought.providerId);
            return (
              <m.button
                animate={{ opacity: 1, y: 0 }}
                aria-label={`查看 ${thought.seatNumber} 号 ${thought.nickname} 的完整 AI 分析记录`}
                className="observer-thought-card"
                data-provider-id={thought.providerId}
                data-source={thought.source}
                data-testid={`observer-thought-${thought.id}`}
                initial={{ opacity: 0, y: 7 }}
                key={thought.id}
                onClick={(event) => onSelectActor(thought.actorId, event.currentTarget)}
                transition={motionTokens.standard}
                type="button"
              >
                <span className="observer-thought-seat">{thought.seatNumber}</span>
                <div className="observer-thought-body">
                  <header>
                    <div>
                      <strong>{thought.nickname}</strong>
                      <small>
                        {model?.label ?? thought.providerId} · {thought.modelId}
                      </small>
                    </div>
                    <span
                      className={`observer-source-badge source-${thought.source}`}
                      data-testid={`observer-thought-source-${thought.id}`}
                    >
                      {thought.source === 'provider'
                        ? '模型返回的最终判断摘要'
                        : '确定性规则兜底 · 非模型输出'}
                    </span>
                  </header>
                  <p>{thought.content}</p>
                  <footer>
                    <span>
                      第 {thought.round} 轮 · {phaseLabels[thought.phase]} ·{' '}
                      {roleState ? roleLabels[roleState.role] : '身份同步中'}
                    </span>
                    <span>{actionLabels[thought.actionType] ?? thought.actionType}</span>
                    <time dateTime={new Date(thought.timestamp).toISOString()}>
                      {timeFormatter.format(thought.timestamp)}
                    </time>
                  </footer>
                </div>
              </m.button>
            );
          })
        )}
      </div>
    </section>
  );
});

function useNewThoughtAnnouncement(thoughts: readonly ObserverAiThought[]): string {
  const initialized = useRef(false);
  const knownIds = useRef(new Set<string>());
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    const latestThought = thoughts.at(-1);
    if (!initialized.current) {
      initialized.current = true;
      knownIds.current = new Set(thoughts.map((thought) => thought.id));
      return;
    }
    if (!latestThought || knownIds.current.has(latestThought.id)) return;

    knownIds.current = new Set(thoughts.map((thought) => thought.id));
    setAnnouncement(
      `${latestThought.seatNumber} 号 ${latestThought.nickname} 新增一条${
        latestThought.source === 'provider' ? '模型决策摘要' : '规则兜底记录'
      }，时间 ${timeFormatter.format(latestThought.timestamp)}`,
    );
  }, [thoughts]);

  return announcement;
}
