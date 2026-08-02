'use client';

import type { Role as EngineRole } from '@werewolf/contracts';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import dynamic from 'next/dynamic';
import { memo, useEffect, useMemo, useState } from 'react';

import {
  activeAiModels,
  aiPersonalities,
  findActiveAiModel,
  personalityLabel,
} from '@/lib/ai-models';
import type { AiPersonalityId } from '@/lib/ai-models';
import {
  countRevealedRoles,
  publicGameEventDescription,
  resultPresentation,
} from '@/lib/game-result-view';
import { daySurfaceForPhase } from '@/lib/game-view-phase';
import { makeIdempotencyKey } from '@/lib/live-api';
import type {
  AiSeatInput,
  LiveGameEvent,
  LivePrivatePlayerState,
  LiveRoomState,
  RequestedRoomMode,
  SubmitGameAction,
} from '@/lib/live-api';
import { initialMessages, players as demoPlayers } from '@/lib/mock-data';
import { motionTokens, phaseVariants } from '@/lib/motion';
import { haptic, playUiTone } from '@/lib/sensory';
import type { ChatMessage, GamePhase, PlayerSummary, Role } from '@/lib/types';
import { hasPrivatePlayerState, useLiveRoom } from '@/lib/use-live-room';
import { useSpeechTranscription } from '@/lib/use-speech-transcription';

import { useUiPreferences } from './app-providers';
import { Icons } from './icons';
import { ParticleCanvas } from './particle-canvas';
import { SiteHeader } from './site-header';

const ObserverExperience = dynamic(
  () => import('./observer-experience').then((module) => module.ObserverExperience),
  { loading: ObserverLoadingFallback },
);

function ObserverLoadingFallback() {
  return (
    <section aria-live="polite" className="connection-gate ornate-panel" role="status">
      <span className="connection-emblem">
        <Icons.moon size={34} />
      </span>
      <p className="panel-kicker">AI OBSERVER</p>
      <h1>正在载入观战界面</h1>
      <p>正在恢复公开对局与 AI 状态，请稍候。</p>
    </section>
  );
}

const phaseLabels: Record<GamePhase, string> = {
  lobby: '房间大厅',
  role: '身份揭示',
  day: '白天讨论',
  night: '夜间行动',
  result: '对局结算',
};

const phaseOrder: GamePhase[] = ['lobby', 'role', 'day', 'night', 'result'];

function livePhaseLabel(room: LiveRoomState | undefined, fallback: GamePhase): string {
  switch (room?.phase) {
    case 'role_reveal':
      return '身份确认';
    case 'night':
    case 'night_guard':
    case 'night_werewolves':
    case 'night_seer':
    case 'night_witch':
      return `第 ${room.game?.round ?? 1} 夜`;
    case 'dawn':
      return `第 ${room.game?.round ?? 1} 天 · 黎明公布`;
    case 'last_words':
      return `第 ${room.game?.round ?? 1} 天 · 遗言`;
    case 'discussion':
      return `第 ${room.game?.round ?? 1} 天 · 公开发言`;
    case 'voting':
      return `第 ${room.game?.round ?? 1} 天 · 放逐投票`;
    case 'hunter_shot':
      return `第 ${room.game?.round ?? 1} 天 · 猎人行动`;
    case 'resolution':
      return `第 ${room.game?.round ?? 1} 天 · 回合结算`;
    case 'ended':
      return '对局结束';
    case 'lobby':
      return '准备阶段';
    default:
      return phaseLabels[fallback];
  }
}

const roleLabels: Record<EngineRole, Role> = {
  werewolf: '狼人',
  villager: '村民',
  seer: '预言家',
  witch: '女巫',
  hunter: '猎人',
  guard: '守卫',
};

const roleGuidance: Record<Role, { ability: string; advice: string }> = {
  狼人: {
    ability: '每晚与狼队共同选择袭击目标',
    advice: '隐藏阵营，白天用发言争取信任',
  },
  村民: {
    ability: '没有夜间技能，依靠发言和投票寻找狼人',
    advice: '记录矛盾，谨慎使用每一票',
  },
  预言家: {
    ability: '每晚可查验一名玩家的阵营',
    advice: '看清真相，但别太早暴露自己',
  },
  女巫: {
    ability: '拥有一瓶解药和一瓶毒药',
    advice: '药剂有限，行动前仔细权衡',
  },
  猎人: {
    ability: '符合条件出局时可带走一名玩家',
    advice: '判断局势，保留最后的威慑',
  },
  守卫: {
    ability: '每晚守护一名玩家免受狼人袭击',
    advice: '不能连续守护同一目标',
  },
};

function aiModelForPlayer(player: PlayerSummary) {
  return findActiveAiModel(player.ai?.model) ?? findActiveAiModel(player.ai?.provider);
}

function toUiPhase(room: LiveRoomState | undefined): GamePhase {
  if (!room || room.phase === 'lobby') return 'lobby';
  if (room.phase === 'role_reveal') return 'role';
  if (room.phase.startsWith('night')) {
    return 'night';
  }
  if (room.phase === 'ended' || room.status === 'finished') return 'result';
  return 'day';
}

function playersFromRoom(room: LiveRoomState | undefined): PlayerSummary[] {
  if (!room) return [];
  const publicPlayers = new Map(room.game?.players.map((player) => [player.id, player]) ?? []);
  return room.seats.map((seat) => {
    const gamePlayer = publicPlayers.get(seat.id);
    const revealedRole = gamePlayer?.revealedRole;
    return {
      seat: seat.number,
      name: seat.nickname,
      kind: seat.kind === 'human' ? 'human' : seat.kind === 'ai_takeover' ? 'takeover' : 'ai',
      ready: seat.ready,
      alive: gamePlayer?.alive ?? true,
      ...(revealedRole ? { role: roleLabels[revealedRole] } : {}),
      ...(seat.ai
        ? {
            ai: {
              provider: seat.ai.providerId,
              model: seat.ai.modelId,
              personality: personalityLabel(seat.ai.personality),
            },
          }
        : {}),
    };
  });
}

function presetDescription(preset: 6 | 9 | 12): string {
  if (preset === 6) return '2 狼人 · 预言家 · 女巫 · 2 村民';
  if (preset === 12) {
    return '4 狼人 · 预言家 · 女巫 · 猎人 · 守卫 · 4 村民';
  }
  return '3 狼人 · 预言家 · 女巫 · 猎人 · 3 村民';
}

export function chatMessagesFromEvents(
  events: readonly LiveGameEvent[],
  room: LiveRoomState | undefined,
): ChatMessage[] {
  return events.flatMap((event, index) => {
    const isHumanChat = event.type === 'chat.message';
    const isAiSpeech = event.type === 'ai.action' && typeof event.message === 'string';
    if ((!isHumanChat && !isAiSpeech) || typeof event.message !== 'string') {
      return [];
    }

    const actorId = typeof event.actorId === 'string' ? event.actorId : undefined;
    const actorSeat = actorId ? room?.seats.find((seat) => seat.id === actorId) : undefined;
    const eventSeat =
      typeof event.seatNumber === 'number'
        ? event.seatNumber
        : typeof event.seat === 'number'
          ? event.seat
          : (actorSeat?.number ?? null);
    const author =
      typeof event.nickname === 'string'
        ? event.nickname
        : typeof event.author === 'string'
          ? event.author
          : (actorSeat?.nickname ?? (isAiSpeech ? 'AI 玩家' : '房间玩家'));

    return [
      {
        id:
          typeof event.id === 'string'
            ? event.id
            : `live-${event.version ?? event.at ?? index}-${index}`,
        seat: eventSeat,
        author,
        text: event.message,
        tone: 'normal' as const,
      },
    ];
  });
}

export function GameExperience({
  requestedMode,
  roomCode,
}: {
  requestedMode: RequestedRoomMode;
  roomCode: string;
}) {
  const { preferences } = useUiPreferences();
  const live = useLiveRoom(roomCode, requestedMode);
  const [demoPhase, setDemoPhase] = useState<GamePhase>('lobby');
  const [demoPaused, setDemoPaused] = useState(false);
  const [demoSeconds, setDemoSeconds] = useState(0);
  const isDemo = live.mode === 'demo';
  const phase = isDemo ? demoPhase : toUiPhase(live.room);
  const paused = isDemo ? demoPaused : (live.room?.isPaused ?? false);
  const seconds = isDemo ? demoSeconds : live.seconds;
  const roomPlayers = useMemo(
    () => (isDemo ? demoPlayers : playersFromRoom(live.room)),
    [isDemo, live.room],
  );

  useEffect(() => {
    if (!isDemo) return;
    setDemoSeconds(
      demoPhase === 'lobby' || demoPhase === 'result'
        ? 0
        : demoPhase === 'role'
          ? 12
          : demoPhase === 'night'
            ? 36
            : 42,
    );
  }, [demoPhase, isDemo]);

  useEffect(() => {
    if (
      !isDemo ||
      demoPaused ||
      demoSeconds <= 0 ||
      demoPhase === 'lobby' ||
      demoPhase === 'result'
    ) {
      return;
    }
    const timer = window.setInterval(
      () => setDemoSeconds((value) => Math.max(0, value - 1)),
      1_000,
    );
    return () => window.clearInterval(timer);
  }, [demoPaused, demoPhase, demoSeconds, isDemo]);

  const goToDemoPhase = (
    next: GamePhase,
    tone: 'tap' | 'reveal' | 'confirm' | 'victory' = 'tap',
  ) => {
    if (!isDemo) return;
    playUiTone(tone, preferences);
    haptic(tone === 'reveal' ? 'reveal' : tone === 'tap' ? 'tap' : 'confirm', preferences);
    setDemoPhase(next);
  };

  const togglePause = () => {
    if (isDemo) {
      setDemoPaused((value) => !value);
      return;
    }
    if (live.isHost && live.mode === 'live') {
      void live.hostControl(paused ? 'resume' : 'pause');
    }
  };

  if (!isDemo && live.mode !== 'live') {
    return (
      <main className="game-page phase-lobby" id="main-content">
        <div className="game-background" aria-hidden="true">
          <div className="game-moon" />
          <div className="roofline" />
          <div className="mist-layer" />
        </div>
        <SiteHeader
          compact
          connectionLabel={live.mode === 'connecting' ? '正在连接' : '连接不可用'}
          roomCode={roomCode}
        />
        <section className="connection-gate ornate-panel">
          <span className="connection-emblem">
            {live.mode === 'connecting' ? <Icons.moon size={34} /> : <Icons.shield size={34} />}
          </span>
          <p className="panel-kicker">LIVE ROOM</p>
          <h1>{live.mode === 'connecting' ? '正在恢复实时房间' : '无法进入实时房间'}</h1>
          <p aria-live="polite">{live.error ?? '正在使用安全会话连接服务器，请稍候。'}</p>
          <div className="connection-actions">
            <button
              className="primary-button"
              disabled={live.mode === 'connecting'}
              onClick={live.retry}
              type="button"
            >
              重新连接
            </button>
            <button className="secondary-button" onClick={live.enterDemo} type="button">
              明确进入本地演示
            </button>
            <a className="ghost-button" href="/">
              返回首页
            </a>
          </div>
          <small>本地演示不会写入线上房间，也不会伪装成其他真人玩家。</small>
        </section>
      </main>
    );
  }

  if (!isDemo && live.isObserver && live.room) {
    return (
      <ObserverExperience
        error={live.error}
        events={live.events}
        observerState={live.observerState}
        onHostControl={live.hostControl}
        pending={live.pending}
        room={live.room}
        roomCode={roomCode}
        seconds={live.seconds}
      />
    );
  }

  const privateState = hasPrivatePlayerState(live.privateState) ? live.privateState : undefined;

  return (
    <main className={`game-page phase-${phase}`} id="main-content">
      <div className="game-background" aria-hidden="true">
        <div className="game-moon" />
        <div className="roofline" />
        <div className="mist-layer" />
      </div>
      <AnimatePresence initial={false}>
        <m.div
          animate={{ opacity: 0 }}
          aria-hidden="true"
          className={`phase-light phase-light--${phase === 'night' || phase === 'role' ? 'night' : 'day'}`}
          initial={{ opacity: 0.5 }}
          key={phase}
          transition={motionTokens.phase}
        />
      </AnimatePresence>
      {phase === 'result' ? <ParticleCanvas mode="embers" /> : null}
      <SiteHeader
        compact
        connectionLabel={isDemo ? '本地演示' : '实时连接'}
        {...(live.room ? { playerCount: live.room.seats.length } : {})}
        roomCode={roomCode}
      />

      <div
        className={`connection-strip connection-strip--${isDemo ? 'demo' : 'live'}`}
        data-testid="room-connection-mode"
      >
        <span aria-hidden="true" className="connection-dot" />
        <div className="connection-copy">
          <span role="status">
            {isDemo ? '本地演示模式：所有阶段和玩家均为浏览器内模拟' : '实时房间已连接'}
          </span>
          {!isDemo ? <span aria-hidden="true"> · 状态版本 {live.room?.version ?? 0}</span> : null}
        </div>
        {live.error ? <strong role="alert">{live.error}</strong> : null}
      </div>

      <div className="game-topbar">
        <div className="phase-status">
          <span>{isDemo ? phaseLabels[phase] : livePhaseLabel(live.room, phase)}</span>
          {seconds > 0 ? (
            <strong aria-label={`剩余 ${seconds} 秒`}>
              {String(Math.floor(seconds / 60)).padStart(2, '0')}:
              {String(seconds % 60).padStart(2, '0')}
            </strong>
          ) : (
            <strong>{isDemo ? phaseLabels[phase] : livePhaseLabel(live.room, phase)}</strong>
          )}
        </div>
        <div className="host-controls">
          {phase !== 'lobby' && phase !== 'result' && (isDemo || live.isHost) ? (
            <button
              className="secondary-button compact-button"
              disabled={!isDemo && live.pending !== null}
              onClick={togglePause}
              type="button"
            >
              {paused ? '继续' : '暂停'} {paused ? '▶' : 'Ⅱ'}
            </button>
          ) : null}
        </div>
      </div>

      <nav aria-label={isDemo ? '本地演示阶段预览' : '实时对局进度'} className="phase-nav">
        {isDemo ? (
          phaseOrder.map((item, index) => (
            <button
              aria-current={phase === item ? 'step' : undefined}
              className={phase === item ? 'active' : ''}
              key={item}
              onClick={() => goToDemoPhase(item)}
              type="button"
            >
              <span>{index + 1}</span>
              {phaseLabels[item]}
            </button>
          ))
        ) : (
          <ol>
            {phaseOrder.map((item, index) => (
              <li
                aria-current={phase === item ? 'step' : undefined}
                className={phase === item ? 'active' : ''}
                key={item}
              >
                <span>{index + 1}</span>
                {phaseLabels[item]}
              </li>
            ))}
          </ol>
        )}
      </nav>

      <AnimatePresence initial={false} mode="wait">
        <m.div
          animate="enter"
          className="game-stage"
          data-testid={`room-stage-${phase}`}
          exit="exit"
          initial="initial"
          key={phase}
          transition={motionTokens.phase}
          variants={phaseVariants}
        >
          {phase === 'lobby' ? (
            <LobbyStage
              isDemo={isDemo}
              isHost={live.isHost}
              onReady={live.setReady}
              onStart={async (aiSeats) => {
                if (isDemo) {
                  goToDemoPhase('role', 'reveal');
                  return true;
                }
                return live.configureAndStart(aiSeats);
              }}
              ownReady={live.ownSeat?.ready ?? false}
              pending={live.pending}
              room={live.room}
              roomCode={roomCode}
            />
          ) : null}
          {phase === 'role' ? (
            <RoleStage
              isDemo={isDemo}
              onContinue={async () => {
                if (isDemo) {
                  goToDemoPhase('day', 'confirm');
                  return true;
                }
                return live.submitAction({
                  idempotencyKey: makeIdempotencyKey('role'),
                  type: 'acknowledge_role',
                });
              }}
              privateState={privateState}
            />
          ) : null}
          {phase === 'day' ? (
            <DayStage
              events={live.events}
              isDemo={isDemo}
              onAction={async (action) => {
                if (isDemo) return true;
                return live.submitAction({
                  ...action,
                  idempotencyKey: makeIdempotencyKey(action.type),
                });
              }}
              onNight={() => goToDemoPhase('night', 'confirm')}
              onSend={live.sendChat}
              players={roomPlayers}
              privateState={privateState}
              room={live.room}
            />
          ) : null}
          {phase === 'night' ? (
            <NightStage
              isDemo={isDemo}
              onAction={async (action) => {
                if (isDemo) {
                  window.setTimeout(() => goToDemoPhase('result', 'victory'), 800);
                  return true;
                }
                return live.submitAction({
                  ...action,
                  idempotencyKey: makeIdempotencyKey(action.type),
                });
              }}
              players={roomPlayers}
              privateState={privateState}
              room={live.room}
            />
          ) : null}
          {phase === 'result' ? (
            <ResultStage
              events={live.events}
              isDemo={isDemo}
              onRestart={() => goToDemoPhase('lobby', 'tap')}
              players={roomPlayers}
              room={live.room}
            />
          ) : null}
        </m.div>
      </AnimatePresence>
    </main>
  );
}

function LobbyStage({
  isDemo,
  isHost,
  onReady,
  onStart,
  ownReady,
  pending,
  room,
  roomCode,
}: {
  isDemo: boolean;
  isHost: boolean;
  onReady: (ready: boolean) => Promise<boolean>;
  onStart: (seats: readonly AiSeatInput[]) => Promise<boolean>;
  ownReady: boolean;
  pending: string | null;
  room: LiveRoomState | undefined;
  roomCode: string;
}) {
  const { preferences } = useUiPreferences();
  const [draftModels, setDraftModels] = useState<Record<number, string>>({});
  const [draftPersonalities, setDraftPersonalities] = useState<Record<number, AiPersonalityId>>({});
  const [copied, setCopied] = useState(false);
  const preset = room?.preset ?? 9;
  const actualPlayers = isDemo ? demoPlayers : playersFromRoom(room);

  const seatList = useMemo(() => {
    if (isDemo) return actualPlayers;
    const bySeat = new Map(actualPlayers.map((player) => [player.seat, player]));
    return Array.from({ length: preset }, (_, index): PlayerSummary => {
      const seat = index + 1;
      const actual = bySeat.get(seat);
      if (actual) return actual;
      const defaultModel = activeAiModels[index % activeAiModels.length] ?? activeAiModels[0];
      const selectedLabel = draftModels[seat] ?? defaultModel.label;
      return {
        seat,
        name: `${selectedLabel} · ${seat}`,
        kind: 'ai',
        ready: true,
        alive: true,
        ai: {
          provider: selectedLabel,
          model: selectedLabel,
          personality: '逻辑型',
        },
      };
    });
  }, [actualPlayers, draftModels, isDemo, preset]);

  const updateModel = (seat: number, model: string) => {
    if (isDemo) return;
    setDraftModels((current) => ({ ...current, [seat]: model }));
  };

  const updatePersonality = (seat: number, personality: AiPersonalityId) => {
    if (isDemo) return;
    setDraftPersonalities((current) => ({ ...current, [seat]: personality }));
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_200);
    } catch {
      setCopied(false);
    }
    playUiTone('tap', preferences);
  };

  const start = () => {
    const aiSeats: AiSeatInput[] = seatList.flatMap((player) => {
      if (player.kind === 'human') return [];
      const selected =
        activeAiModels.find((model) => model.label === draftModels[player.seat]) ??
        aiModelForPlayer(player) ??
        activeAiModels[(player.seat - 1) % activeAiModels.length] ??
        activeAiModels[0];
      return [
        {
          seatNumber: player.seat,
          providerId: selected.providerId,
          modelId: selected.modelId,
          personality: draftPersonalities[player.seat] ?? 'logical',
        },
      ];
    });
    void onStart(aiSeats);
  };

  const humanCount = seatList.filter((player) => player.kind === 'human').length;
  const aiCount = seatList.length - humanCount;

  return (
    <section className="lobby-layout">
      <div className="lobby-main ornate-panel">
        <div className="section-heading">
          <div>
            <p className="panel-kicker">等待月升</p>
            <h1>{preset} 人标准局</h1>
            <p>{presetDescription(preset)}</p>
          </div>
          <button className="room-code" onClick={copyCode} type="button">
            <span>房间码</span>
            <strong>{roomCode}</strong>
            <Icons.copy size={17} />
            {copied ? <i>已复制</i> : null}
          </button>
        </div>

        <div className="seat-grid">
          {seatList.map((player, index) => (
            <m.article
              animate={{ opacity: 1, y: 0 }}
              className={`seat-card ${player.kind === 'human' ? 'human' : 'ai'}`}
              initial={{ opacity: 0, y: 12 }}
              key={`${player.seat}-${player.kind}`}
              layout
              transition={{ ...motionTokens.spring, delay: index * 0.025 }}
            >
              <PlayerPortrait player={player} />
              <div className="seat-info">
                <span>
                  {player.seat} 号 ·{' '}
                  {player.kind === 'human' ? '真人' : player.kind === 'takeover' ? 'AI 接管' : 'AI'}
                </span>
                <strong>{player.name}</strong>
                {player.ai ? (
                  <label className="mini-select">
                    <span className="sr-only">为 {player.seat} 号选择模型</span>
                    <select
                      autoComplete="off"
                      disabled={isDemo || player.kind === 'takeover'}
                      name={`seat-${player.seat}-model`}
                      onChange={(event) => updateModel(player.seat, event.target.value)}
                      value={
                        draftModels[player.seat] ??
                        aiModelForPlayer(player)?.label ??
                        activeAiModels[0].label
                      }
                    >
                      {activeAiModels.map((model) => (
                        <option key={model.label} value={model.label}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                    <Icons.chevron size={16} />
                  </label>
                ) : (
                  <span className="ready-label">{player.ready ? '已准备' : '等待准备'}</span>
                )}
                {player.ai && !isDemo && player.kind !== 'takeover' ? (
                  <label className="mini-select mini-select--personality">
                    <span className="sr-only">为 {player.seat} 号选择性格</span>
                    <select
                      autoComplete="off"
                      name={`seat-${player.seat}-personality`}
                      onChange={(event) =>
                        updatePersonality(player.seat, event.target.value as AiPersonalityId)
                      }
                      value={draftPersonalities[player.seat] ?? 'logical'}
                    >
                      {aiPersonalities.map((personality) => (
                        <option key={personality.id} value={personality.id}>
                          {personality.label}
                        </option>
                      ))}
                    </select>
                    <Icons.chevron size={16} />
                  </label>
                ) : null}
              </div>
              <span
                aria-label={player.ready ? '已准备' : '未准备'}
                className="ready-indicator"
                role="img"
                title={player.ready ? '已准备' : '未准备'}
              />
            </m.article>
          ))}
        </div>
      </div>

      <aside className="lobby-sidebar">
        <section className="ornate-panel room-summary">
          <p className="panel-kicker">本局配置</p>
          <h2>月隐村 · 标准规则</h2>
          <dl>
            <div>
              <dt>人数</dt>
              <dd>
                {seatList.length} / {preset}
              </dd>
            </div>
            <div>
              <dt>真人</dt>
              <dd>{humanCount} 人</dd>
            </div>
            <div>
              <dt>AI 补位</dt>
              <dd>{aiCount} 席</dd>
            </div>
            <div>
              <dt>发言时长</dt>
              <dd>60 秒</dd>
            </div>
            <div>
              <dt>胜利条件</dt>
              <dd>屠边</dd>
            </div>
          </dl>
        </section>
        {isDemo || isHost ? (
          <button
            className="primary-button primary-button--large"
            disabled={pending !== null}
            onClick={start}
            type="button"
          >
            <span>
              {pending === 'start'
                ? '正在配置并开局…'
                : isDemo
                  ? '所有人已准备 · 开始演示'
                  : '补齐 AI 并开始实时对局'}
            </span>
            <Icons.arrow />
          </button>
        ) : (
          <button
            className="primary-button primary-button--large"
            disabled={pending !== null}
            onClick={() => void onReady(!ownReady)}
            type="button"
          >
            <span>{pending === 'ready' ? '正在同步…' : ownReady ? '取消准备' : '我已准备'}</span>
            <Icons.arrow />
          </button>
        )}
        <p className="secure-note">
          <Icons.shield size={16} />
          {isDemo ? '演示身份只存在当前浏览器' : '身份由服务器独立分配，私密状态只发给当前会话'}
        </p>
      </aside>
    </section>
  );
}

function RoleStage({
  isDemo,
  onContinue,
  privateState,
}: {
  isDemo: boolean;
  onContinue: () => Promise<boolean>;
  privateState: LivePrivatePlayerState | undefined;
}) {
  const { preferences } = useUiPreferences();
  const [revealed, setRevealed] = useState(false);
  const playerState = hasPrivatePlayerState(privateState) ? privateState : undefined;
  const role = isDemo ? '预言家' : playerState ? roleLabels[playerState.role] : undefined;
  const guidance = role ? roleGuidance[role] : undefined;
  const canAcknowledge =
    isDemo || (playerState?.legalActions.includes('acknowledge_role') ?? false);
  const [submitting, setSubmitting] = useState(false);

  const reveal = () => {
    if (!role) return;
    setRevealed(true);
    playUiTone('reveal', preferences);
    haptic('reveal', preferences);
  };

  return (
    <section className="role-stage">
      <div className="role-copy">
        <p className="eyebrow">
          <span />
          命运已经落定
          <span />
        </p>
        <h1>{!role ? '正在接收私密身份' : revealed ? '你的身份是' : '查看你的身份'}</h1>
        <p>
          {!role
            ? '服务器尚未下发当前玩家的私密状态。'
            : revealed
              ? '请记住你的使命，隐藏好真实身份。'
              : '身份牌仅你可见，翻开后请谨慎保管秘密。'}
        </p>
      </div>

      <button
        aria-label={revealed && role ? `${role}身份牌` : '翻开身份牌'}
        className={`role-card-wrap ${revealed ? 'revealed' : ''}`}
        disabled={revealed || !role}
        onClick={reveal}
        type="button"
      >
        <m.div
          animate={{ rotateY: revealed ? 180 : 0 }}
          className="role-card"
          transition={{ type: 'spring', stiffness: 190, damping: 24 }}
        >
          <div className="role-card-face role-card-back">
            <div className="role-sigil">
              <Icons.wolf size={72} />
            </div>
            <span>{role ? '轻触翻开' : '等待服务器'}</span>
          </div>
          <div className="role-card-face role-card-front">
            <div className="seer-orb">
              <span />
            </div>
            <p>你的阵营身份</p>
            <h2>{role ?? '未知'}</h2>
            <div className="role-divider">
              <i />
              <Icons.moon size={16} />
              <i />
            </div>
            <strong>{guidance?.ability ?? '等待私密状态'}</strong>
            <small>{guidance?.advice ?? '连接恢复后将自动更新'}</small>
            <div className="card-shine" aria-hidden="true" />
          </div>
        </m.div>
      </button>

      {revealed ? (
        <m.button
          animate={{ opacity: 1, y: 0 }}
          className="primary-button"
          initial={{ opacity: 0, y: 8 }}
          disabled={!canAcknowledge || submitting}
          onClick={() => {
            setSubmitting(true);
            void onContinue().then((accepted) => {
              if (!accepted) setSubmitting(false);
            });
          }}
          type="button"
        >
          {submitting || !canAcknowledge ? '身份确认已提交 · 等待其他玩家' : '我已记住 · 提交确认'}{' '}
          <Icons.arrow />
        </m.button>
      ) : (
        <p className="privacy-tip">
          <Icons.shield size={16} />
          请确保身边没有其他玩家窥视
        </p>
      )}
    </section>
  );
}

function DayStage(props: {
  events: readonly LiveGameEvent[];
  isDemo: boolean;
  onAction: (action: SubmitGameAction) => Promise<boolean>;
  onNight: () => void;
  onSend: (message: string) => Promise<boolean>;
  players: readonly PlayerSummary[];
  privateState: LivePrivatePlayerState | undefined;
  room: LiveRoomState | undefined;
}) {
  const surface = props.isDemo ? 'discussion' : daySurfaceForPhase(props.room?.phase);

  if (surface === 'voting') {
    return <VoteStage {...props} />;
  }
  if (surface === 'last-words') {
    return <LastWordsStage {...props} />;
  }
  if (surface === 'dawn') {
    return <DawnStage players={props.players} room={props.room} />;
  }
  if (surface === 'hunter-shot') {
    return (
      <NightStage
        isDemo={false}
        onAction={props.onAction}
        players={props.players}
        privateState={props.privateState}
        room={props.room}
      />
    );
  }
  return <DiscussionStage {...props} />;
}

function DiscussionStage({
  events,
  isDemo,
  onAction,
  onNight,
  onSend,
  players,
  privateState,
  room,
}: {
  events: readonly LiveGameEvent[];
  isDemo: boolean;
  onAction: (action: SubmitGameAction) => Promise<boolean>;
  onNight: () => void;
  onSend: (message: string) => Promise<boolean>;
  players: readonly PlayerSummary[];
  privateState: LivePrivatePlayerState | undefined;
  room: LiveRoomState | undefined;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const playerState = hasPrivatePlayerState(privateState) ? privateState : undefined;
  const canVote = playerState?.legalActions.includes('day_vote') ?? false;
  const canFinishSpeech = playerState?.legalActions.includes('finish_speech') ?? false;
  const legalTargetIds = useMemo(
    () => new Set(playerState?.legalTargetIds ?? []),
    [playerState?.legalTargetIds],
  );
  const currentActorId = room?.game?.currentActorIds[0];
  const currentActor = players.find(
    (player) => room?.seats.find((seat) => seat.number === player.seat)?.id === currentActorId,
  );

  useEffect(() => {
    if (isDemo || selected === null) return;
    const selectedId = room?.seats.find((seat) => seat.number === selected)?.id;
    if (!canVote || !selectedId || !legalTargetIds.has(selectedId)) {
      setSelected(null);
    }
  }, [canVote, isDemo, legalTargetIds, room?.seats, selected]);

  const submitDayAction = async () => {
    if (canFinishSpeech && !canVote) {
      await onAction({ type: 'finish_speech' });
      return;
    }
    const target = players.find((player) => player.seat === selected);
    const targetId = room?.seats.find((seat) => seat.number === target?.seat)?.id;
    if (!canVote || !targetId) return;
    await onAction({ type: 'day_vote', targetId });
  };

  return (
    <section
      className="discussion-layout discussion-layout--speaking"
      data-phase-detail="discussion"
    >
      <h1 className="sr-only">白天讨论与放逐投票</h1>
      <div className="table-panel">
        <div className="round-table">
          <div className="table-center">
            <Icons.wolf size={52} />
            <span>{room?.phase === 'voting' ? '正在投票' : '正在发言'}</span>
            <strong>
              {currentActor
                ? `${currentActor.seat} 号 · ${currentActor.name}`
                : isDemo
                  ? '3 号 · 临川'
                  : '等待服务器指派'}
            </strong>
          </div>
          {players.map((player, index) => {
            const candidateId = room?.seats.find((seat) => seat.number === player.seat)?.id;
            const selectable = isDemo
              ? player.alive
              : canVote &&
                player.alive &&
                candidateId !== undefined &&
                legalTargetIds.has(candidateId);
            const unavailableVoteTarget = !isDemo && canVote && !selectable;
            const seatClassName = `table-seat table-seat-${index + 1} ${
              currentActor?.seat === player.seat || (isDemo && player.seat === 3) ? 'speaking' : ''
            } ${!player.alive ? 'dead' : ''} ${
              selected === player.seat ? 'selected' : ''
            } ${unavailableVoteTarget ? 'unavailable' : ''}`;
            const seatContents = (
              <>
                <PlayerPortrait player={player} />
                <span className="seat-number">{player.seat}</span>
                <strong>{player.name.split(' · ')[0]}</strong>
                {player.kind !== 'human' ? <small>AI</small> : null}
              </>
            );
            return selectable ? (
              <button
                aria-label={`${player.seat} 号玩家 ${player.name}`}
                className={seatClassName}
                key={player.seat}
                onClick={() => setSelected(player.seat)}
                type="button"
              >
                {seatContents}
              </button>
            ) : (
              <article
                aria-label={`${player.seat} 号玩家 ${player.name}`}
                className={seatClassName}
                key={player.seat}
              >
                {seatContents}
              </article>
            );
          })}
        </div>
        <div className="table-actions">
          <button
            className="secondary-button"
            disabled={
              isDemo
                ? selected === null
                : (!canFinishSpeech && !canVote) || (canVote && selected === null)
            }
            onClick={() => void submitDayAction()}
            type="button"
          >
            {isDemo
              ? selected
                ? `投票给 ${selected} 号`
                : '选择一名玩家'
              : canFinishSpeech && !canVote
                ? '完成本轮发言'
                : canVote && selected
                  ? `确认投票给 ${selected} 号`
                  : canVote
                    ? '选择投票目标'
                    : '等待你的行动阶段'}
          </button>
          {isDemo ? (
            <button className="ghost-button" onClick={onNight} type="button">
              预览夜间阶段 <Icons.moon size={17} />
            </button>
          ) : null}
        </div>
      </div>

      <DayChatPanel
        canFinishSpeech={canFinishSpeech}
        events={events}
        isDemo={isDemo}
        onSend={onSend}
        room={room}
      />
    </section>
  );
}

function VoteStage({
  onAction,
  players,
  privateState,
  room,
}: {
  events: readonly LiveGameEvent[];
  isDemo: boolean;
  onAction: (action: SubmitGameAction) => Promise<boolean>;
  onNight: () => void;
  onSend: (message: string) => Promise<boolean>;
  players: readonly PlayerSummary[];
  privateState: LivePrivatePlayerState | undefined;
  room: LiveRoomState | undefined;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const playerState = hasPrivatePlayerState(privateState) ? privateState : undefined;
  const canVote = playerState?.legalActions.includes('day_vote') ?? false;
  const legalTargetIds = useMemo(
    () => new Set(playerState?.legalTargetIds ?? []),
    [playerState?.legalTargetIds],
  );
  const publicCandidateIds = useMemo(
    () => new Set(room?.game?.voteCandidates ?? []),
    [room?.game?.voteCandidates],
  );
  const hasRunoffCandidates = publicCandidateIds.size > 0;
  const candidates = players.filter((player) => {
    const playerId = room?.seats.find((seat) => seat.number === player.seat)?.id;
    return (
      player.alive &&
      playerId !== undefined &&
      (!hasRunoffCandidates || publicCandidateIds.has(playerId))
    );
  });

  useEffect(() => {
    if (selected === null) return;
    const targetId = room?.seats.find((seat) => seat.number === selected)?.id;
    if (!canVote || !targetId || !legalTargetIds.has(targetId)) setSelected(null);
  }, [canVote, legalTargetIds, room?.seats, selected]);

  const submit = async (targetId: string | null) => {
    if (!canVote || submitting) return;
    setSubmitting(true);
    const accepted = await onAction({ type: 'day_vote', targetId });
    if (!accepted) setSubmitting(false);
  };

  const selectedId = room?.seats.find((seat) => seat.number === selected)?.id;

  return (
    <section className="vote-stage" data-phase-detail="voting">
      <header className="stage-section-heading">
        <div>
          <p className="panel-kicker">放逐投票</p>
          <h1>{room?.game?.voteRound === 2 ? '平票加赛，请再次选择' : '选择你认为最可疑的玩家'}</h1>
          <p>每位存活玩家可投一票；结果只会在服务器完成本轮结算后公开。</p>
        </div>
        <span className="phase-pill">第 {room?.game?.voteRound ?? 1} 轮</span>
      </header>

      <div className="vote-layout">
        <div className="vote-grid" aria-label="放逐候选人" role="group">
          {candidates.map((player, index) => {
            const playerId = room?.seats.find((seat) => seat.number === player.seat)?.id;
            const selectable =
              canVote && playerId !== undefined && legalTargetIds.has(playerId) && !submitting;
            return (
              <m.button
                animate={{ opacity: 1, y: 0 }}
                aria-pressed={selected === player.seat}
                className={`vote-candidate target-card ${selected === player.seat ? 'selected' : ''}`}
                disabled={!selectable}
                initial={{ opacity: 0, y: 10 }}
                key={player.seat}
                onClick={() => setSelected(player.seat)}
                transition={{ ...motionTokens.spring, delay: index * 0.025 }}
                type="button"
                whileTap={{ scale: 0.97 }}
              >
                <PlayerPortrait player={player} />
                <span>{player.seat} 号</span>
                <strong>{player.name.split(' · ')[0]}</strong>
                <small>{selectable ? '可投票' : '不可选择'}</small>
              </m.button>
            );
          })}
        </div>

        <aside className="vote-summary ornate-panel">
          <p className="panel-kicker">本轮选择</p>
          <h2>{selected === null ? '尚未选择候选人' : `已选择 ${selected} 号玩家`}</h2>
          <p>投票提交后不可撤回。未公开的实时票数不会显示。</p>
          <button
            className="primary-button"
            disabled={!canVote || !selectedId || submitting}
            onClick={() => void submit(selectedId ?? null)}
            type="button"
          >
            {submitting
              ? '投票已提交 · 等待结算'
              : selected
                ? `确认投给 ${selected} 号`
                : '请选择玩家'}
          </button>
          <button
            className="ghost-button"
            disabled={!canVote || submitting}
            onClick={() => void submit(null)}
            type="button"
          >
            本轮弃票
          </button>
        </aside>
      </div>
    </section>
  );
}

function LastWordsStage({
  events,
  onAction,
  onSend,
  players,
  privateState,
  room,
}: {
  events: readonly LiveGameEvent[];
  isDemo: boolean;
  onAction: (action: SubmitGameAction) => Promise<boolean>;
  onNight: () => void;
  onSend: (message: string) => Promise<boolean>;
  players: readonly PlayerSummary[];
  privateState: LivePrivatePlayerState | undefined;
  room: LiveRoomState | undefined;
}) {
  const playerState = hasPrivatePlayerState(privateState) ? privateState : undefined;
  const canFinishSpeech = playerState?.legalActions.includes('finish_speech') ?? false;
  const currentActorId = room?.game?.currentActorIds[0];
  const currentSeat = room?.seats.find((seat) => seat.id === currentActorId);
  const currentPlayer = players.find((player) => player.seat === currentSeat?.number);

  return (
    <section className="last-words-stage" data-phase-detail="last-words">
      <div className="dawn-announcement ornate-panel">
        <span className="dawn-icon">
          <Icons.sun size={28} />
        </span>
        <p className="panel-kicker">遗言阶段</p>
        <h1>
          {currentPlayer
            ? `${currentPlayer.seat} 号 · ${currentPlayer.name.split(' · ')[0]} 正在发言`
            : '等待服务器指定遗言玩家'}
        </h1>
        <p>遗言会进入公开频道，所有存活玩家均可阅读。</p>
        {canFinishSpeech ? (
          <button
            className="secondary-button"
            onClick={() => void onAction({ type: 'finish_speech' })}
            type="button"
          >
            完成遗言
          </button>
        ) : null}
      </div>
      <DayChatPanel
        canFinishSpeech={canFinishSpeech}
        events={events}
        isDemo={false}
        onSend={onSend}
        room={room}
      />
    </section>
  );
}

function DawnStage({
  players,
  room,
}: {
  players: readonly PlayerSummary[];
  room: LiveRoomState | undefined;
}) {
  const round = room?.game?.round ?? 1;
  const deaths = room?.game?.deaths.filter((death) => death.round === round) ?? [];
  const deadPlayers = deaths.flatMap((death) => {
    const seat = room?.seats.find((item) => item.id === death.playerId);
    const player = players.find((item) => item.seat === seat?.number);
    return player ? [{ death, player }] : [];
  });
  const isResolution = room?.phase === 'resolution';

  return (
    <section className="dawn-stage" data-phase-detail={isResolution ? 'resolution' : 'dawn'}>
      <div className="dawn-announcement ornate-panel">
        <span className="dawn-icon">
          <Icons.sun size={32} />
        </span>
        <p className="panel-kicker">{isResolution ? '回合结算' : `第 ${round} 天 · 黎明`}</p>
        <h1>
          {deadPlayers.length === 0
            ? isResolution
              ? '正在结算本轮公开结果'
              : '昨夜平安，无人死亡'
            : `${deadPlayers.map(({ player }) => `${player.seat} 号`).join('、')} 玩家出局`}
        </h1>
        <p>
          {isResolution
            ? '服务器正在判定胜负并准备下一个夜晚。'
            : '死亡原因仅在规则允许公开时显示，隐藏信息仍由服务器保密。'}
        </p>
      </div>
      {deadPlayers.length > 0 ? (
        <div className="dawn-player-list" aria-label="本轮出局玩家">
          {deadPlayers.map(({ death, player }) => (
            <article className="dawn-player-card" key={death.playerId}>
              <PlayerPortrait player={player} />
              <span>{player.seat} 号</span>
              <strong>{player.name.split(' · ')[0]}</strong>
              <small>{death.cause === 'vote' ? '被放逐' : '昨夜出局'}</small>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DayChatPanel({
  canFinishSpeech,
  events,
  isDemo,
  onSend,
  room,
}: {
  canFinishSpeech: boolean;
  events: readonly LiveGameEvent[];
  isDemo: boolean;
  onSend: (message: string) => Promise<boolean>;
  room: LiveRoomState | undefined;
}) {
  const { preferences } = useUiPreferences();
  const [demoMessages, setDemoMessages] = useState(initialMessages);
  const [message, setMessage] = useState('');
  const speech = useSpeechTranscription(!isDemo);
  const liveMessages = useMemo<ChatMessage[]>(
    () => chatMessagesFromEvents(events, room),
    [events, room],
  );
  const messages = isDemo ? demoMessages : liveMessages;

  useEffect(() => {
    if (speech.transcript) setMessage(speech.transcript);
  }, [speech.transcript, speech.transcriptRevision]);

  const send = async () => {
    const text = message.trim();
    if (!text) return;
    if (isDemo) {
      setDemoMessages((current) => [
        ...current.slice(-199),
        {
          id: `local-${Date.now()}`,
          seat: 1,
          author: '山岚',
          text,
        },
      ]);
      setMessage('');
      playUiTone('tap', preferences);
      return;
    }
    const accepted = await onSend(text);
    if (accepted) {
      setMessage('');
      playUiTone('tap', preferences);
    }
  };

  return (
    <aside className="chat-panel ornate-panel">
      <div className="chat-heading">
        <div>
          <p className="panel-kicker">公开频道</p>
          <h2>发言记录</h2>
        </div>
        <span className="live-badge">
          <i aria-hidden="true" />
          {isDemo ? '演示' : '实时'}
        </span>
      </div>
      <MessageFeed isDemo={isDemo} messages={messages} />
      <div className="chat-composer">
        <div className="composer-input">
          <input
            aria-label="公开发言内容"
            autoComplete="off"
            data-testid="chat-input"
            disabled={!isDemo && !canFinishSpeech}
            enterKeyHint="send"
            maxLength={240}
            name="chatMessage"
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                void send();
              }
            }}
            placeholder={isDemo || canFinishSpeech ? '输入公开发言内容…' : '当前不是你的发言阶段…'}
            value={message}
          />
          <button
            aria-label={speech.recording ? '结束录音' : '开始语音输入'}
            className={speech.recording ? 'recording' : ''}
            data-testid="voice-input-toggle"
            disabled={speech.transcribing || (!isDemo && !canFinishSpeech)}
            onClick={() => void speech.toggle()}
            type="button"
          >
            <Icons.mic />
          </button>
        </div>
        <m.button
          className="primary-button send-button"
          data-testid="chat-send"
          disabled={!message.trim() || (!isDemo && !canFinishSpeech)}
          onClick={() => void send()}
          type="button"
          whileTap={{ scale: 0.96 }}
        >
          发送
        </m.button>
      </div>
      {speech.status ? (
        <p aria-live="polite" className="voice-status">
          {speech.status}
        </p>
      ) : null}
    </aside>
  );
}

const MessageFeed = memo(function MessageFeed({
  isDemo,
  messages,
}: {
  isDemo: boolean;
  messages: readonly ChatMessage[];
}) {
  return (
    <div aria-live="polite" aria-relevant="additions text" className="message-list" role="log">
      {messages.length === 0 ? <p className="empty-feed">尚无公开发言</p> : null}
      {messages.map((item) => (
        <m.article
          animate={{ opacity: 1, y: 0 }}
          className={`message ${item.tone === 'system' ? 'system-message' : ''}`}
          initial={{ opacity: 0, y: 7 }}
          key={item.id}
          layout="position"
        >
          {item.seat ? (
            <span className="message-seat">{item.seat}</span>
          ) : (
            <span className="message-seal">
              <Icons.wolf size={15} />
            </span>
          )}
          <div>
            <strong>{item.author}</strong>
            <p>{item.text}</p>
          </div>
        </m.article>
      ))}
      {isDemo ? (
        <div className="thinking-message">
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" /> 6 号 AI 正在组织发言…
        </div>
      ) : null}
    </div>
  );
});

function NightStage({
  isDemo,
  onAction,
  players,
  privateState,
  room,
}: {
  isDemo: boolean;
  onAction: (action: SubmitGameAction) => Promise<boolean>;
  players: readonly PlayerSummary[];
  privateState: LivePrivatePlayerState | undefined;
  room: LiveRoomState | undefined;
}) {
  const { preferences } = useUiPreferences();
  const [target, setTarget] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const playerState = hasPrivatePlayerState(privateState) ? privateState : undefined;
  const actionType = isDemo
    ? 'seer_check'
    : playerState?.legalActions.find(
        (action) =>
          action === 'seer_check' ||
          action === 'werewolf_vote' ||
          action === 'guard' ||
          action === 'witch' ||
          action === 'hunter_shot',
      );
  const legalTargetIds = new Set(playerState?.legalTargetIds ?? []);
  const legalTargets = isDemo
    ? players.filter((player) => player.seat !== 1 && player.alive)
    : players.filter((player) => {
        const candidateId = room?.seats.find((seat) => seat.number === player.seat)?.id;
        return player.alive && candidateId !== undefined && legalTargetIds.has(candidateId);
      });
  const role = isDemo ? '预言家' : playerState ? roleLabels[playerState.role] : '等待身份';
  const actionCopy = nightActionCopy(actionType);
  const witchVictim =
    actionType === 'witch' && playerState?.witch?.werewolfVictimId
      ? room?.seats.find((seat) => seat.id === playerState.witch?.werewolfVictimId)
      : undefined;
  const canHeal =
    actionType === 'witch' &&
    playerState?.witch?.healAvailable === true &&
    witchVictim !== undefined &&
    (playerState.witch.werewolfVictimId !== playerState.playerId || room?.game?.round === 1);
  const isHunterShot = actionType === 'hunter_shot';

  const submitNightAction = async (action: SubmitGameAction) => {
    setConfirmed(true);
    playUiTone('confirm', preferences);
    haptic('confirm', preferences);
    const accepted = await onAction(action);
    if (!accepted) setConfirmed(false);
  };

  const confirm = async () => {
    if (target === null || !actionType) return;
    const targetId = isDemo
      ? String(target)
      : room?.seats.find((seat) => seat.number === target)?.id;
    if (!targetId) return;
    let action: SubmitGameAction;
    if (actionType === 'seer_check') {
      action = { type: 'seer_check', targetId };
    } else if (actionType === 'witch') {
      action = {
        type: 'witch',
        useHeal: false,
        poisonTargetId: targetId,
      };
    } else {
      action = { type: actionType, targetId };
    }
    await submitNightAction(action);
  };

  const skip = () => {
    if (!actionType || actionType === 'seer_check') return;
    const action: SubmitGameAction =
      actionType === 'witch'
        ? { type: 'witch', useHeal: false, poisonTargetId: null }
        : { type: actionType, targetId: null };
    void submitNightAction(action);
  };

  const heal = () => {
    if (!canHeal) return;
    void submitNightAction({
      type: 'witch',
      useHeal: true,
      poisonTargetId: null,
    });
  };

  return (
    <section
      className={`night-stage ${isHunterShot ? 'hunter-shot-stage' : ''}`}
      data-phase-detail={isHunterShot ? 'hunter-shot' : 'night-action'}
    >
      <div className="night-heading">
        <span className="night-icon">
          {isHunterShot ? <Icons.sun size={32} /> : <Icons.moon size={32} />}
        </span>
        <p className="panel-kicker">{isHunterShot ? `${role} · 出局技能` : `${role} · 夜间行动`}</p>
        <h1>{actionCopy.heading}</h1>
        <p>{actionCopy.description}</p>
      </div>

      <div className="target-grid">
        {legalTargets.length === 0 ? (
          <p className="empty-feed">
            {actionType ? '当前没有合法目标，等待服务器推进阶段。' : '当前不是你的行动阶段。'}
          </p>
        ) : null}
        {legalTargets.map((player, index) => (
          <m.button
            animate={{ opacity: 1, y: 0 }}
            aria-pressed={target === player.seat}
            className={`target-card ${target === player.seat ? 'selected' : ''}`}
            initial={{ opacity: 0, y: 12 }}
            key={player.seat}
            onClick={() => setTarget(player.seat)}
            transition={{ ...motionTokens.spring, delay: index * 0.025 }}
            type="button"
            whileTap={{ scale: 0.965 }}
          >
            <PlayerPortrait player={player} />
            <span>{player.seat} 号</span>
            <strong>{player.name.split(' · ')[0]}</strong>
            <i>{target === player.seat ? '已选择' : '合法目标'}</i>
          </m.button>
        ))}
      </div>

      <div className="night-confirm">
        <div>
          <Icons.shield size={18} />
          <span>
            {isHunterShot
              ? '猎人目标会在服务器确认行动后公开结算，提交前请仔细判断'
              : isDemo
                ? '演示行动只在当前浏览器生效'
                : '行动通过私密 Socket 事件提交，公开状态不会泄露选择'}
          </span>
        </div>
        <div className="night-action-buttons">
          <button
            className="primary-button"
            disabled={target === null || confirmed || !actionType}
            onClick={() => void confirm()}
            type="button"
          >
            {confirmed
              ? '行动已提交…'
              : target
                ? `确认${actionCopy.verb} ${target} 号`
                : actionType
                  ? '请先选择目标'
                  : '等待行动阶段'}
          </button>
          {canHeal ? (
            <button className="secondary-button" disabled={confirmed} onClick={heal} type="button">
              使用解药救 {witchVictim.number} 号
            </button>
          ) : null}
          {!isDemo && actionType && actionType !== 'seer_check' ? (
            <button className="ghost-button" disabled={confirmed} onClick={skip} type="button">
              放弃本次行动
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function nightActionCopy(
  action: 'seer_check' | 'werewolf_vote' | 'guard' | 'witch' | 'hunter_shot' | undefined,
): { heading: string; description: string; verb: string } {
  if (action === 'werewolf_vote') {
    return {
      heading: '选择今晚的袭击目标',
      description: '你的选择只会与狼队及服务器共享。',
      verb: '袭击',
    };
  }
  if (action === 'guard') {
    return {
      heading: '选择今晚要守护的玩家',
      description: '不能连续两晚守护同一目标。',
      verb: '守护',
    };
  }
  if (action === 'witch') {
    return {
      heading: '决定今晚如何使用药剂',
      description: '解药、毒药或不使用药剂，三种选择只能提交一种。',
      verb: '用药于',
    };
  }
  if (action === 'hunter_shot') {
    return {
      heading: '选择要带走的玩家',
      description: '确认后无法撤销，请结合场上信息判断。',
      verb: '选择',
    };
  }
  if (action === 'seer_check') {
    return {
      heading: '选择今晚要查验的玩家',
      description: '你将得知目标属于好人阵营或狼人阵营。',
      verb: '查验',
    };
  }
  return {
    heading: '等待你的夜间行动',
    description: '服务器将在合法阶段下发私密目标列表。',
    verb: '选择',
  };
}

function ResultStage({
  events,
  isDemo,
  onRestart,
  players,
  room,
}: {
  events: readonly LiveGameEvent[];
  isDemo: boolean;
  onRestart: () => void;
  players: readonly PlayerSummary[];
  room: LiveRoomState | undefined;
}) {
  const roleCounts = useMemo(() => countRevealedRoles(players), [players]);
  const winner = isDemo ? 'good' : room?.game?.winner;
  const presentation = resultPresentation(winner);
  const timeline = isDemo
    ? ['预言家查验 4 号为狼人', '4 号玩家被放逐出局', '女巫毒杀最后一名狼人']
    : events
        .filter((event) => event.type !== 'chat.message')
        .slice(-3)
        .map((event) => publicGameEventDescription(event.type));

  return (
    <section className="result-stage">
      <m.div
        animate={{ opacity: 1, scale: 1, y: 0 }}
        aria-live="polite"
        className={`victory-emblem ${presentation.ready ? '' : 'syncing'}`}
        initial={{ opacity: 0, scale: 0.78, y: 16 }}
        role="status"
        transition={{ type: 'spring', stiffness: 270, damping: 22 }}
      >
        <span>
          {!presentation.ready ? (
            <Icons.moon size={32} />
          ) : winner === 'good' ? (
            <Icons.sun size={32} />
          ) : (
            <Icons.wolf size={32} />
          )}
        </span>
        <p>{presentation.ready ? '黎明降临' : '对局已结束'}</p>
        <h1>{presentation.title}</h1>
        <small>{presentation.description}</small>
      </m.div>

      <div className="result-layout">
        <div className="identity-board ornate-panel">
          <div className="section-heading">
            <div>
              <p className="panel-kicker">身份揭晓</p>
              <h2>{room?.preset ?? 9} 人标准局</h2>
            </div>
            <div className="camp-count">
              <span>好人 {roleCounts.good}</span>
              <span>狼人 {roleCounts.wolf}</span>
            </div>
          </div>
          <div className="identity-grid">
            {players.map((player, index) => (
              <m.article
                animate={{ opacity: 1, rotateY: 0 }}
                className={`identity-card ${
                  player.role === undefined ? 'unknown' : player.role === '狼人' ? 'wolf' : 'good'
                }`}
                initial={{ opacity: 0, rotateY: 80 }}
                key={player.seat}
                transition={{
                  ...motionTokens.spring,
                  delay: 0.16 + index * 0.045,
                }}
              >
                <PlayerPortrait player={player} />
                <span>
                  {player.seat} 号 · {player.name.split(' · ')[0]}
                </span>
                <strong>{player.role ?? '未公开'}</strong>
                <small>
                  {player.kind === 'human' ? '真人玩家' : (player.ai?.model ?? 'AI 接管')}
                </small>
              </m.article>
            ))}
          </div>
        </div>

        <aside className="result-summary ornate-panel">
          <p className="panel-kicker">关键时刻</p>
          <h2>对局时间线</h2>
          <ol className="timeline">
            {timeline.length > 0 ? (
              timeline.map((entry, index) => (
                <li key={`${entry}-${index}`}>
                  <span>事件 {index + 1}</span>
                  <p>{entry}</p>
                </li>
              ))
            ) : (
              <li>
                <span>结束</span>
                <p>服务器未提供公开事件摘要</p>
              </li>
            )}
          </ol>
          <div className="model-mvp">
            <Icons.bot size={24} />
            <div>
              <span>{isDemo ? '演示说明' : 'AI 数据'}</span>
              <strong>
                {isDemo ? '本地流程演示 · 不含真实模型统计' : '以模型管理实时统计为准'}
              </strong>
            </div>
            <b>{isDemo ? 'DEMO' : '—'}</b>
          </div>
          {isDemo ? (
            <button className="primary-button" onClick={onRestart} type="button">
              再来一局 <Icons.arrow />
            </button>
          ) : (
            <button className="primary-button" disabled type="button">
              实时再来一局接口待开放
            </button>
          )}
          <a className="ghost-button" href="/">
            返回首页
          </a>
        </aside>
      </div>
    </section>
  );
}

function PlayerPortrait({ player }: { player: PlayerSummary }) {
  const initials =
    player.kind === 'human' ? player.name.slice(0, 1) : (player.ai?.model.slice(0, 2) ?? 'AI');
  return (
    <span className={`player-portrait portrait-${player.seat}`}>
      {player.kind === 'human' ? <Icons.user size={26} /> : <Icons.bot size={24} />}
      <i>{initials}</i>
    </span>
  );
}
