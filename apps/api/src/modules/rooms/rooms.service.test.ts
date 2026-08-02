import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { AiTurnJobData, AiTurnJobResult } from '@werewolf/ai-gateway';
import type { GameAction, PrivatePlayerState, PublicChatMessage } from '@werewolf/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_AI_PROVIDER_TIMEOUT_MS } from '../../common/runtime-config.js';
import { AdminService } from '../admin/admin.service.js';
import type { AiTurnQueueService } from './ai-turn-queue.service.js';
import {
  aiTurnMaxOutputTokens,
  appendAiThoughtEntry,
  buildAiConversationContext,
  MAX_AI_MEMORY_SUMMARY_CHARS,
  MAX_AI_PROMPT_CHAT_CHARS,
  MAX_AI_PROMPT_CHAT_MESSAGES,
  MAX_AI_THOUGHT_HISTORY,
  MAX_PUBLIC_CHAT_HISTORY,
  RoomsService,
  storeAiMemorySummary,
} from './rooms.service.js';
import type { PublicRoomState } from './rooms.types.js';

function aiSeatConfigs() {
  return [2, 3, 4, 5, 6].map((seatNumber) => ({
    seatNumber,
    modelId: 'deepseek-chat',
    providerId: 'deepseek',
    personality: 'logical' as const,
  }));
}

function observerLineup() {
  return Array.from({ length: 6 }, (_, index) => {
    const providerId = index % 2 === 0 ? ('kimi' as const) : ('deepseek' as const);
    return {
      seatNumber: index + 1,
      providerId,
      personality: index % 2 === 0 ? ('logical' as const) : ('aggressive' as const),
    };
  });
}

function observerNarrative(decisionSummary: string) {
  return {
    decisionSummary,
    visibleAnalysis:
      '这是模型为认证观战者刻意撰写的可见分析：我先区分当前已公开的事实与仍待验证的判断，再结合座位发言、行动和票型说明本回合策略；这不是隐藏思维链。',
  };
}

async function advanceObserverUntilProviderCall(execute: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 30 && execute.mock.calls.length === 0; attempt += 1) {
    await vi.advanceTimersByTimeAsync(50);
  }
  if (execute.mock.calls.length === 0) {
    throw new Error('AI observer did not dispatch a provider turn');
  }
  await Promise.resolve();
  await Promise.resolve();
}

async function advanceAutomatedRoomToEnd(
  rooms: RoomsService,
  code: string,
): Promise<PublicRoomState> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    await vi.advanceTimersByTimeAsync(1_000);
    rooms.tick(Date.now() + 120_000);
    const room = rooms.getPublic(code);
    if (room.status === 'finished') return room;
  }
  throw new Error('AI observer room did not finish automatically');
}

function advanceUntilHostCanSpeak(
  rooms: RoomsService,
  room: PublicRoomState,
  token: string,
  hostSeatId: string,
): PublicRoomState {
  let current = room;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (
      (current.phase === 'last_words' || current.phase === 'discussion') &&
      current.game?.currentActorIds[0] === hostSeatId
    ) {
      return current;
    }
    current = rooms.hostControl(current.code, token, 'advance');
  }
  throw new Error('Host did not reach a speaking phase');
}

function advanceUntilAiCanSpeak(
  rooms: RoomsService,
  room: PublicRoomState,
  token: string,
): { readonly room: PublicRoomState; readonly actorId: string } {
  let current = room;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const actorId = current.game?.currentActorIds[0];
    const seat = current.seats.find((candidate) => candidate.id === actorId);
    if (
      actorId &&
      (current.phase === 'last_words' || current.phase === 'discussion') &&
      (seat?.kind === 'ai' || seat?.kind === 'ai_takeover')
    ) {
      return { room: current, actorId };
    }
    current = rooms.hostControl(current.code, token, 'advance');
  }
  throw new Error('AI did not reach a speaking phase');
}

function publicChatMessage(index: number, message = `公开发言 ${index}`): PublicChatMessage {
  return {
    id: `message-${index}`,
    type: 'chat.message',
    actorId: `actor-${index % 3}`,
    seatNumber: (index % 6) + 1,
    nickname: `玩家${index % 3}`,
    message,
    at: index,
    round: Math.floor(index / 6) + 1,
    phase: index % 2 === 0 ? 'discussion' : 'last_words',
  };
}

describe('RoomsService', () => {
  let admin: AdminService;
  let rooms: RoomsService;
  let inviteCode: string;

  beforeEach(() => {
    admin = new AdminService();
    inviteCode = admin.createInvite({ label: 'test', maxUses: 10 }).code;
    rooms = new RoomsService(admin);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('creates, joins and exposes a secret-free public room snapshot', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    const joined = rooms.join(created.room.code, '玩家二');
    expect(joined.room.seats).toHaveLength(2);
    expect(JSON.stringify(joined.room)).not.toContain(created.session.token);
  });

  it('creates an AI-only room whose host observes without occupying a seat', () => {
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());

    expect(created.room).toMatchObject({
      mode: 'ai_observer',
      status: 'playing',
      phase: 'role_reveal',
    });
    expect(created.room.seats).toHaveLength(6);
    expect(created.room.seats.every((seat) => seat.kind === 'ai')).toBe(true);
    expect(created.session).toMatchObject({ kind: 'observer', isHost: true });
    expect(created.session.seatId).toBeUndefined();
    expect(created.observer).toMatchObject({
      connected: true,
      isObserver: true,
      mode: 'ai_observer',
      roomId: created.room.id,
    });
    expect(created.observer.roles).toHaveLength(6);
    expect(created.observer.roles.map((seat) => seat.modelId)).toEqual([
      'kimi-k2.6',
      'deepseek-v4-flash',
      'kimi-k2.6',
      'deepseek-v4-flash',
      'kimi-k2.6',
      'deepseek-v4-flash',
    ]);
    expect(JSON.stringify(created.room)).not.toMatch(/"role"|"eventLog"|"hostSessionId"/);
    expect(() => rooms.join(created.room.code, '闯入者')).toThrow(ConflictException);
    expect(() => rooms.getPrivate(created.room.code, created.session.token)).toThrow(
      ForbiddenException,
    );
  });

  it('automatically advances an AI-only match through actions and settlement', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '1');
    const execute = vi.fn(async (data: AiTurnJobData): Promise<AiTurnJobResult> => ({
      action: data.fallbackAction,
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
      costCents: 0,
    }));
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    const finished = await advanceAutomatedRoomToEnd(rooms, created.room.code);
    const observer = rooms.getObserver(created.room.code, created.session.token);

    expect(finished).toMatchObject({ status: 'finished', phase: 'ended' });
    expect(execute).toHaveBeenCalled();
    expect(observer).toMatchObject({ phase: 'ended', winner: expect.any(String) });
    expect(observer?.actions.some((event) => event.kind === 'action.accepted')).toBe(true);
    expect(observer?.actions.some((event) => event.kind === 'game.ended')).toBe(true);
    expect(observer?.roles.every((seat) => typeof seat.role === 'string')).toBe(true);
  });

  it('paces observer actions so a resolved fallback cannot finish before Socket bootstrap', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '500');
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());

    await Promise.resolve();
    expect(rooms.getPublic(created.room.code)).toMatchObject({
      status: 'playing',
      phase: 'role_reveal',
    });
    expect(
      rooms
        .getObserver(created.room.code, created.session.token)
        ?.actions.filter((event) => event.kind === 'action.accepted'),
    ).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(499);
    expect(
      rooms
        .getObserver(created.room.code, created.session.token)
        ?.actions.filter((event) => event.kind === 'action.accepted'),
    ).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(
      rooms
        .getObserver(created.room.code, created.session.token)
        ?.actions.filter((event) => event.kind === 'action.accepted'),
    ).toHaveLength(1);
    expect(rooms.getPublic(created.room.code).status).toBe('playing');
  });

  it('keeps a bounded reconnectable thought history', () => {
    let history = [] as Parameters<typeof appendAiThoughtEntry>[0];
    for (let index = 0; index < MAX_AI_THOUGHT_HISTORY + 7; index += 1) {
      history = appendAiThoughtEntry(history, {
        id: `thought-${index}`,
        turnId: `turn-${index}`,
        actorId: 'actor-1',
        seatNumber: 1,
        nickname: 'Kimi 1',
        providerId: 'kimi',
        modelId: 'kimi-k2.6',
        phase: 'discussion',
        round: 1,
        actionType: 'speak',
        content: index === MAX_AI_THOUGHT_HISTORY + 6 ? '摘要'.repeat(400) : `摘要 ${index}`,
        visibleAnalysis:
          index === MAX_AI_THOUGHT_HISTORY + 6 ? '分析'.repeat(700) : `可见分析 ${index}`,
        source: 'provider',
        timestamp: index,
      });
    }
    expect(history).toHaveLength(MAX_AI_THOUGHT_HISTORY);
    expect(history[0]?.id).toBe('thought-7');
    expect(history.at(-1)?.id).toBe(`thought-${MAX_AI_THOUGHT_HISTORY + 6}`);
    expect(history.at(-1)?.content).toHaveLength(600);
    expect(history.at(-1)?.visibleAnalysis).toHaveLength(1_200);
  });

  it('publishes a real provider summary privately before applying the observer action', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '50');
    const summary = '公开信息不足，但二号的选择与前一轮发言冲突，因此本回合优先选择二号。';
    const visibleAnalysis = observerNarrative(summary).visibleAnalysis;
    const execute = vi.fn(async (data: AiTurnJobData): Promise<AiTurnJobResult> => ({
      action: { ...data.fallbackAction, ...observerNarrative(summary) },
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      attempts: 1,
      // This means a backup provider succeeded, not deterministic fallback.
      usedFallback: true,
      failureReasons: [],
      providerAttempts: [
        {
          providerId: 'deepseek',
          succeeded: true,
          durationMs: 12,
          costCents: 0.1,
        },
      ],
      costCents: 0.1,
    }));
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    await advanceObserverUntilProviderCall(execute);

    const observer = rooms.getObserver(created.room.code, created.session.token);
    expect(observer?.activeDecision).toMatchObject({
      actorId: execute.mock.calls[0]?.[0].actorSeatId,
      status: 'summary_ready',
      source: 'provider',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
    expect(observer?.aiThoughtHistory.at(-1)).toMatchObject({
      turnId: observer.activeDecision?.turnId,
      content: summary,
      visibleAnalysis,
      source: 'provider',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
    });
    expect(JSON.stringify(rooms.getPublic(created.room.code))).not.toContain(summary);
    expect(JSON.stringify(rooms.getPublic(created.room.code))).not.toContain(visibleAnalysis);
    expect(JSON.stringify(rooms.getPublic(created.room.code))).not.toContain('aiThoughtHistory');

    const statuses = rooms
      .tick()
      .filter((change) => change.event === 'ai.status')
      .map((change) => change.payload);
    expect(statuses.map((status) => status?.status)).toEqual(
      expect.arrayContaining(['thinking', 'summary_ready']),
    );
    expect(JSON.stringify(statuses)).not.toContain(summary);
    expect(JSON.stringify(statuses)).not.toContain(visibleAnalysis);
    expect(JSON.stringify(statuses)).not.toContain('content');

    const acceptedBefore =
      observer?.actions.filter((event) => event.kind === 'action.accepted').length ?? 0;
    await vi.advanceTimersByTimeAsync(49);
    expect(
      rooms
        .getObserver(created.room.code, created.session.token)
        ?.actions.filter((event) => event.kind === 'action.accepted'),
    ).toHaveLength(acceptedBefore);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      rooms
        .getObserver(created.room.code, created.session.token)
        ?.actions.filter((event) => event.kind === 'action.accepted').length,
    ).toBeGreaterThan(acceptedBefore);
    expect(
      rooms
        .tick()
        .filter((change) => change.event === 'ai.status')
        .some((change) => change.payload?.status === 'completed'),
    ).toBe(true);
  });

  it('requires visible analysis before attributing an observer decision to a provider', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '50');
    const summaryWithoutAnalysis = '这条只有短结论，不能单独冒充完整的模型可见分析。';
    const execute = vi.fn(async (data: AiTurnJobData): Promise<AiTurnJobResult> => ({
      action: { ...data.fallbackAction, decisionSummary: summaryWithoutAnalysis },
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
      providerAttempts: [
        {
          providerId: 'deepseek',
          succeeded: true,
          durationMs: 12,
          costCents: 0.1,
        },
      ],
      costCents: 0.1,
    }));
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    await advanceObserverUntilProviderCall(execute);

    const observer = rooms.getObserver(created.room.code, created.session.token);
    expect(observer?.activeDecision).toMatchObject({
      status: 'fallback',
      source: 'fallback',
    });
    expect(observer?.aiThoughtHistory.at(-1)).toMatchObject({
      source: 'fallback',
      content: expect.stringContaining('规则兜底'),
    });
    expect(observer?.aiThoughtHistory.at(-1)?.visibleAnalysis).toBeUndefined();
    expect(JSON.stringify(observer)).not.toContain(summaryWithoutAnalysis);
  });

  it('gives the first live night request an exact one-of protocol and target mapping', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '1');
    const execute = vi.fn(
      (_data: AiTurnJobData) =>
        new Promise<AiTurnJobResult>(() => {
          // Capture the first real night request without applying it.
        }),
    );
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    rooms.createAiObserver(inviteCode, 6, observerLineup());
    await advanceObserverUntilProviderCall(execute);

    const job = execute.mock.calls[0]?.[0];
    expect(job?.actionType).toBe('night');
    expect(job?.requireDecisionSummary).toBe(true);
    expect(job?.requireVisibleAnalysis).toBe(true);
    expect(job?.request.maxOutputTokens).toBe(1_000);
    expect(job?.allowedSeatIds?.length).toBeGreaterThan(0);
    const userMessage = job?.request.messages.find((message) => message.role === 'user');
    const prompt = JSON.parse(userMessage?.content ?? '{}') as {
      instruction?: string;
      legalTargets?: readonly {
        targetSeatId?: string;
        seatNumber?: number;
        nickname?: string;
      }[];
      privatePlayer?: Record<string, unknown>;
      personality?: { readonly id?: string; readonly guidance?: string };
    };
    expect(prompt.instruction).toContain('"type":"night"');
    expect(prompt.instruction).toContain('visibleAnalysis');
    expect(prompt.instruction).toContain('未使用字段必须省略');
    expect(prompt.instruction).toContain('狼人袭击投票');
    expect(prompt.privatePlayer).not.toHaveProperty('legalActions');
    expect(prompt.privatePlayer).not.toHaveProperty('legalTargetIds');
    expect(prompt.legalTargets?.map((target) => target.targetSeatId)).toEqual(job?.allowedSeatIds);
    expect(prompt.instruction).toContain(
      `allowedTargetSeatIds=${JSON.stringify(job?.allowedSeatIds)}`,
    );
    expect(prompt.instruction).not.toContain('从 legalTargets 原样复制');
    expect(prompt.instruction).toContain(
      `"targetSeatId":${JSON.stringify(job?.allowedSeatIds?.[0])}`,
    );
    expect(['logical', 'aggressive']).toContain(prompt.personality?.id);
    expect(prompt.personality?.guidance).toContain(
      prompt.personality?.id === 'logical' ? '逻辑型' : '进攻型',
    );
    expect(prompt.personality?.guidance).toContain(
      prompt.personality?.id === 'logical' ? '事实、推断和暂定结论' : '敢于点名矛盾',
    );
    expect(
      prompt.legalTargets?.every(
        (target) =>
          typeof target.seatNumber === 'number' &&
          typeof target.nickname === 'string' &&
          target.nickname.length > 0,
      ),
    ).toBe(true);
  });

  it('uses adaptive speech guidance and phase-specific output ceilings', () => {
    const instructionFor = (
      rooms as unknown as {
        aiInstructionFor(
          action: GameAction,
          legalTargets: readonly [],
          requireDecisionSummary: boolean,
        ): string;
      }
    ).aiInstructionFor.bind(rooms);
    const instruction = instructionFor({ type: 'finish_speech', actorId: 'player-1' }, [], true);

    expect(instruction).toContain('40至100字');
    expect(instruction).toContain('100至260字');
    expect(instruction).toContain('260至500字');
    expect(instruction).toContain('不要为了显得认真而强行写长');
    expect(instruction).toContain('对跳、验人信息、强冲突、关键票型、遗言或生死轮');
    expect(instruction).toContain('visibleAnalysis');
    expect(instruction).toContain('120至700字');
    expect(instruction).not.toContain('简短中文公开发言');
    const standardInstruction = instructionFor(
      { type: 'finish_speech', actorId: 'player-1' },
      [],
      false,
    );
    expect(standardInstruction).not.toContain('visibleAnalysis');
    expect(standardInstruction).not.toContain('认证观战者');

    expect(aiTurnMaxOutputTokens('speak', false)).toBe(900);
    expect(aiTurnMaxOutputTokens('speak', true)).toBe(1_800);
    expect(aiTurnMaxOutputTokens('vote', true)).toBe(1_000);
    expect(aiTurnMaxOutputTokens('night', true)).toBe(1_000);
    expect(aiTurnMaxOutputTokens('vote', false)).toBe(320);
    expect(aiTurnMaxOutputTokens('night', false)).toBe(320);
  });

  it('describes every target action with an exact enum and its role-specific meaning', () => {
    const target = {
      targetSeatId: 'player-2',
      seatNumber: 2,
      nickname: '二号',
    };
    const instructionFor = (
      rooms as unknown as {
        aiInstructionFor(
          action: GameAction,
          legalTargets: readonly (typeof target)[],
          requireDecisionSummary: boolean,
          privateView?: PrivatePlayerState,
          round?: number,
        ): string;
      }
    ).aiInstructionFor.bind(rooms);
    const examples: readonly [GameAction, string][] = [
      [{ type: 'day_vote', actorId: 'player-1', targetId: 'player-2' }, '放逐投票'],
      [{ type: 'guard', actorId: 'player-1', targetId: 'player-2' }, '守卫守护'],
      [{ type: 'werewolf_vote', actorId: 'player-1', targetId: 'player-2' }, '狼人袭击投票'],
      [{ type: 'seer_check', actorId: 'player-1', targetId: 'player-2' }, '预言家查验'],
      [{ type: 'hunter_shot', actorId: 'player-1', targetId: 'player-2' }, '猎人开枪'],
    ];

    for (const [action, meaning] of examples) {
      const instruction = instructionFor(action, [target], true);
      expect(instruction).toContain(meaning);
      expect(instruction).toContain('allowedTargetSeatIds=["player-2"]');
      expect(instruction).toContain('"targetSeatId":"player-2"');
      expect(instruction).not.toContain('从 legalTargets 原样复制');
    }

    expect(instructionFor(examples[3]![0], [target], true)).not.toContain('"abstain":true');
  });

  it('does not offer a post-first-night self-heal to the witch', () => {
    const target = {
      targetSeatId: 'player-2',
      seatNumber: 2,
      nickname: '二号',
    };
    const instructionFor = (
      rooms as unknown as {
        aiInstructionFor(
          action: GameAction,
          legalTargets: readonly (typeof target)[],
          requireDecisionSummary: boolean,
          privateView?: PrivatePlayerState,
          round?: number,
        ): string;
      }
    ).aiInstructionFor.bind(rooms);
    const action: GameAction = {
      type: 'witch',
      actorId: 'witch',
      useHeal: false,
      poisonTargetId: null,
    };
    const selfTargetedView: PrivatePlayerState = {
      playerId: 'witch',
      role: 'witch',
      alignment: 'good',
      alive: true,
      legalActions: ['witch'],
      legalTargetIds: ['player-2'],
      witch: {
        healAvailable: true,
        poisonAvailable: true,
        werewolfVictimId: 'witch',
      },
    };

    expect(instructionFor(action, [target], true, selfTargetedView, 1)).toContain('"useHeal":true');
    const secondNight = instructionFor(action, [target], true, selfTargetedView, 2);
    expect(secondNight).not.toContain('"useHeal":true');
    expect(secondNight).toContain('使用毒药毒杀');

    const otherTargetedView: PrivatePlayerState = {
      ...selfTargetedView,
      witch: { ...selfTargetedView.witch!, werewolfVictimId: 'player-2' },
    };
    expect(instructionFor(action, [target], true, otherTargetedView, 2)).toContain(
      '"useHeal":true',
    );
  });

  it('labels a role-incompatible provider decision as fallback before applying it', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '1');
    const incompatibleSummary = '本回合选择弃权，不查验任何玩家。';
    let seerId = '';
    const execute = vi.fn(async (data: AiTurnJobData): Promise<AiTurnJobResult> => ({
      action:
        data.actorSeatId === seerId
          ? {
              type: 'night',
              abstain: true,
              ...observerNarrative(incompatibleSummary),
            }
          : {
              ...data.fallbackAction,
              ...observerNarrative('当前动作可按角色规则原样执行。'),
            },
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
      providerAttempts: [
        {
          providerId: 'kimi',
          succeeded: true,
          durationMs: 12,
          costCents: 0.1,
        },
      ],
      costCents: 0.1,
    }));
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    seerId =
      rooms
        .getObserver(created.room.code, created.session.token)
        ?.roles.find((role) => role.role === 'seer')?.playerId ?? '';
    expect(seerId).not.toBe('');

    let observer = rooms.getObserver(created.room.code, created.session.token);
    for (
      let attempt = 0;
      attempt < 500 && !observer?.aiThoughtHistory.some((thought) => thought.actorId === seerId);
      attempt += 1
    ) {
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      observer = rooms.getObserver(created.room.code, created.session.token);
    }

    const seerThought = observer?.aiThoughtHistory.find((thought) => thought.actorId === seerId);
    expect(seerThought).toMatchObject({
      actorId: seerId,
      source: 'fallback',
      content: expect.stringContaining('规则兜底'),
    });
    expect(JSON.stringify(observer)).not.toContain(incompatibleSummary);

    for (
      let attempt = 0;
      attempt < 100 && !observer?.actions.some((event) => event.kind === 'seer.result');
      attempt += 1
    ) {
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      observer = rooms.getObserver(created.room.code, created.session.token);
    }
    expect(observer?.actions.find((event) => event.kind === 'seer.result')?.payload).toMatchObject({
      targetId: expect.any(String),
    });
  });

  it('discards a role-incompatible standard-room result without saving its AI memory', async () => {
    vi.useFakeTimers();
    const incompatibleMemory = '错误记忆：我作为狼人使用了解药';
    const execute = vi.fn(async (_data: AiTurnJobData): Promise<AiTurnJobResult> => ({
      action: {
        type: 'night',
        useHeal: true,
        memorySummary: incompatibleMemory,
      },
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
      providerAttempts: [
        {
          providerId: 'deepseek',
          succeeded: true,
          durationMs: 12,
          costCents: 0.1,
        },
      ],
      costCents: 0.1,
    }));
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.create(inviteCode, 6, '房主');
    rooms.configureAi(created.room.id, created.session.token, aiSeatConfigs());
    rooms.setReady(created.room.code, created.session.token, true);
    rooms.start(created.room.id, created.session.token);

    rooms.hostControl(created.room.code, created.session.token, 'advance');
    expect(execute).toHaveBeenCalled();
    const initialWolfActorIds = [...new Set(execute.mock.calls.map(([job]) => job.actorSeatId))];
    expect(initialWolfActorIds.length).toBeGreaterThan(0);

    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1);

    const contextFor = (
      rooms as unknown as {
        conversationContextFor(
          roomId: string,
          actorId: string,
        ): {
          readonly memorySummary?: string;
        };
      }
    ).conversationContextFor.bind(rooms);
    for (const actorId of initialWolfActorIds) {
      expect(contextFor(created.room.id, actorId).memorySummary).toBeUndefined();
    }
    expect(JSON.stringify(rooms.getPublic(created.room.code))).not.toContain(incompatibleMemory);
  });

  it('does not attribute a provider result with inapplicable control fields', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '50');
    const contradictorySummary = '这个摘要附带了当前动作不适用的发言字段。';
    const execute = vi.fn(async (data: AiTurnJobData): Promise<AiTurnJobResult> => ({
      action: {
        ...data.fallbackAction,
        message: '不应被夜间动作接受',
        ...observerNarrative(contradictorySummary),
      },
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
      providerAttempts: [
        {
          providerId: 'kimi',
          succeeded: true,
          durationMs: 12,
          costCents: 0.1,
        },
      ],
      costCents: 0.1,
    }));
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    await advanceObserverUntilProviderCall(execute);

    const observer = rooms.getObserver(created.room.code, created.session.token);
    expect(execute.mock.calls[0]?.[0].actionType).toBe('night');
    expect(observer?.activeDecision).toMatchObject({
      status: 'fallback',
      source: 'fallback',
    });
    expect(JSON.stringify(observer)).not.toContain(contradictorySummary);
  });

  it('labels missing provider summaries as explicit deterministic fallback', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '50');
    const execute = vi.fn(async (data: AiTurnJobData): Promise<AiTurnJobResult> => ({
      action: data.fallbackAction,
      attempts: 0,
      usedFallback: true,
      failureReasons: ['provider unavailable'],
      costCents: 0,
    }));
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    await advanceObserverUntilProviderCall(execute);

    const observer = rooms.getObserver(created.room.code, created.session.token);
    expect(observer?.activeDecision).toMatchObject({
      status: 'fallback',
      source: 'fallback',
    });
    expect(observer?.aiThoughtHistory.at(-1)).toMatchObject({
      source: 'fallback',
      content: expect.stringContaining('规则兜底'),
    });
    expect(observer?.aiThoughtHistory.at(-1)?.content).toContain('不代表模型推理');
  });

  it('rejects provider attribution when successful attempt telemetry is missing', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '50');
    const unverifiedSummary = '这是没有成功请求证据的摘要，不能归因给模型。';
    const execute = vi.fn(async (data: AiTurnJobData): Promise<AiTurnJobResult> => ({
      action: { ...data.fallbackAction, ...observerNarrative(unverifiedSummary) },
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
      costCents: 0.1,
    }));
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    await advanceObserverUntilProviderCall(execute);

    const observer = rooms.getObserver(created.room.code, created.session.token);
    expect(observer?.activeDecision).toMatchObject({
      status: 'fallback',
      source: 'fallback',
    });
    expect(observer?.aiThoughtHistory.at(-1)).toMatchObject({
      source: 'fallback',
      content: expect.stringContaining('实际来源：确定性规则兜底'),
    });
    expect(observer?.aiThoughtHistory.at(-1)?.content).toContain('座位计划配置');
    expect(JSON.stringify(observer)).not.toContain(unverifiedSummary);
  });

  it('freezes a resolved observer turn while paused and resumes it without another provider call', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '50');
    let resolveTurn: ((result: AiTurnJobResult) => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<AiTurnJobResult>((resolve) => {
          resolveTurn = resolve;
        }),
    );
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    await advanceObserverUntilProviderCall(execute);
    const thinking = rooms.getObserver(created.room.code, created.session.token)?.activeDecision;
    const firstActorId = execute.mock.calls[0]?.[0].actorSeatId;
    expect(thinking).toMatchObject({ actorId: firstActorId, status: 'thinking' });

    rooms.hostControl(created.room.code, created.session.token, 'pause');
    await vi.advanceTimersByTimeAsync(5_000);
    rooms.hostControl(created.room.code, created.session.token, 'pause');
    resolveTurn?.({
      action: {
        ...execute.mock.calls[0]![0].fallbackAction,
        ...observerNarrative('暂停前已完成模型请求，恢复后沿用同一回合结果。'),
      },
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
      providerAttempts: [
        {
          providerId: 'kimi',
          succeeded: true,
          durationMs: 12,
          costCents: 0.1,
        },
      ],
      costCents: 0.1,
    });
    await Promise.resolve();
    await Promise.resolve();

    const resolved = rooms.getObserver(created.room.code, created.session.token);
    expect(resolved?.activeDecision).toMatchObject({
      turnId: thinking?.turnId,
      status: 'summary_ready',
    });
    expect(resolved?.activeDecision?.applyAt).toBeUndefined();
    const acceptedWhilePaused =
      resolved?.actions.filter((event) => event.kind === 'action.accepted').length ?? 0;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(
      rooms
        .getObserver(created.room.code, created.session.token)
        ?.actions.filter((event) => event.kind === 'action.accepted'),
    ).toHaveLength(acceptedWhilePaused);
    expect(execute).toHaveBeenCalledTimes(1);

    rooms.hostControl(created.room.code, created.session.token, 'resume');
    const resumed = rooms.getObserver(created.room.code, created.session.token);
    expect(resumed?.activeDecision).toMatchObject({ turnId: thinking?.turnId });
    expect(resumed?.activeDecision?.applyAt).toBeGreaterThan(Date.now());
    await vi.advanceTimersByTimeAsync(49);
    expect(
      rooms
        .getObserver(created.room.code, created.session.token)
        ?.actions.filter((event) => event.kind === 'action.accepted'),
    ).toHaveLength(acceptedWhilePaused);
    await vi.advanceTimersByTimeAsync(1);
    expect(
      rooms
        .getObserver(created.room.code, created.session.token)
        ?.actions.filter((event) => event.kind === 'action.accepted').length,
    ).toBeGreaterThan(acceptedWhilePaused);
    expect(execute.mock.calls.filter(([job]) => job.actorSeatId === firstActorId)).toHaveLength(1);
  });

  it('does not let an observer phase timer skip a pending slow AI decision', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '50');
    const execute = vi.fn(
      () =>
        new Promise<AiTurnJobResult>(() => {
          // Keep the first meaningful decision in flight past the phase timer.
        }),
    );
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    await advanceObserverUntilProviderCall(execute);
    const before = rooms.getObserver(created.room.code, created.session.token);
    expect(before?.activeDecision?.status).toBe('thinking');

    rooms.tick(Date.now() + 10 * 60_000);
    const after = rooms.getObserver(created.room.code, created.session.token);
    expect(after?.phaseId).toBe(before?.phaseId);
    expect(after?.activeDecision?.turnId).toBe(before?.activeDecision?.turnId);
  });

  it('drops a late provider result after the host advances to a different turn', async () => {
    vi.useFakeTimers();
    vi.stubEnv('AI_OBSERVER_ACTION_DELAY_MS', '50');
    let resolveFirst: ((result: AiTurnJobResult) => void) | undefined;
    const execute = vi.fn(
      () =>
        new Promise<AiTurnJobResult>((resolve) => {
          if (!resolveFirst) resolveFirst = resolve;
        }),
    );
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.createAiObserver(inviteCode, 6, observerLineup());
    await advanceObserverUntilProviderCall(execute);
    const stale = rooms.getObserver(created.room.code, created.session.token)?.activeDecision;
    expect(stale?.status).toBe('thinking');

    rooms.hostControl(created.room.code, created.session.token, 'advance');
    expect(
      rooms.getObserver(created.room.code, created.session.token)?.activeDecision?.turnId,
    ).not.toBe(stale?.turnId);
    resolveFirst?.({
      action: {
        ...execute.mock.calls[0]![0].fallbackAction,
        ...observerNarrative('这条来自已取消旧阶段，绝不能发布。'),
      },
      providerId: 'kimi',
      modelId: 'kimi-k2.6',
      attempts: 1,
      usedFallback: false,
      failureReasons: [],
      costCents: 0.1,
    });
    await Promise.resolve();
    await Promise.resolve();

    const observer = rooms.getObserver(created.room.code, created.session.token);
    expect(observer?.aiThoughtHistory.some((entry) => entry.turnId === stale?.turnId)).toBe(false);
    expect(JSON.stringify(observer)).not.toContain('这条来自已取消旧阶段');
  });

  it('rejects inactive providers in normal and observer AI lineups', () => {
    const normal = rooms.create(inviteCode, 6, '房主');
    expect(() =>
      rooms.configureAi(normal.room.id, normal.session.token, [
        {
          seatNumber: 2,
          modelId: 'qwen-plus',
          providerId: 'qwen',
          personality: 'logical',
        },
      ]),
    ).toThrow(BadRequestException);
    expect(() =>
      rooms.createAiObserver(inviteCode, 6, [
        ...observerLineup().slice(0, 5),
        {
          seatNumber: 6,
          providerId: 'glm' as 'deepseek',
          personality: 'logical',
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it('never grants omniscient observer state to a normal room host', () => {
    const created = rooms.create(inviteCode, 6, '普通房主');
    expect(() => rooms.getObserver(created.room.code, created.session.token)).toThrow(
      ForbiddenException,
    );
  });

  it('authenticates only known player sessions for non-room-scoped services', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    expect(() => rooms.assertPlayerSession(created.session.token)).not.toThrow();
    expect(() => rooms.assertPlayerSession(undefined)).toThrow(ForbiddenException);
    expect(() => rooms.assertPlayerSession('unknown-token')).toThrow(ForbiddenException);
  });

  it('fills AI seats and starts only when humans are ready', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    const configs = [2, 3, 4, 5, 6].map((seatNumber) => ({
      seatNumber,
      modelId: 'deepseek-chat',
      providerId: 'deepseek',
      personality: 'logical' as const,
    }));
    rooms.configureAi(created.room.id, created.session.token, configs);
    expect(() => rooms.start(created.room.id, created.session.token)).toThrow(BadRequestException);
    rooms.setReady(created.room.code, created.session.token, true);
    expect(rooms.start(created.room.id, created.session.token)).toMatchObject({
      status: 'playing',
      phase: 'role_reveal',
    });
  });

  it('deduplicates actions and takes over a disconnected seat after 60 seconds', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    const configs = [2, 3, 4, 5, 6].map((seatNumber) => ({
      seatNumber,
      modelId: 'model',
      providerId: 'deepseek',
      personality: 'cautious' as const,
    }));
    rooms.configureAi(created.room.id, created.session.token, configs);
    rooms.setReady(created.room.code, created.session.token, true);
    rooms.start(created.room.id, created.session.token);
    const first = rooms.submitAction(created.room.code, created.session.token, {
      idempotencyKey: 'action-0001',
      type: 'acknowledge_role',
    });
    const duplicate = rooms.submitAction(created.room.code, created.session.token, {
      idempotencyKey: 'action-0001',
      type: 'acknowledge_role',
    });
    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);

    rooms.markDisconnected(created.session.token);
    const changes = rooms.tick(Date.now() + 61_000);
    expect(changes.some((change) => change.event === 'ai.takeover')).toBe(true);
    expect(rooms.getPublic(created.room.code).seats[0]?.kind).toBe('ai_takeover');
  });

  it('defers a night reconnect until the next safe public phase boundary', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    rooms.configureAi(
      created.room.id,
      created.session.token,
      [2, 3, 4, 5, 6].map((seatNumber) => ({
        seatNumber,
        modelId: 'model',
        providerId: 'deepseek',
        personality: 'cautious' as const,
      })),
    );
    rooms.setReady(created.room.code, created.session.token, true);
    rooms.start(created.room.id, created.session.token);
    rooms.markDisconnected(created.session.token);
    rooms.tick(Date.now() + 61_000);
    expect(rooms.getPublic(created.room.code).seats[0]).toMatchObject({
      kind: 'ai_takeover',
      connected: false,
    });

    let phaseView = rooms.hostControl(created.room.code, created.session.token, 'advance');
    expect(phaseView.phase).toBe('night');
    const reconnected = rooms.heartbeat(created.room.code, created.session.token);
    expect(reconnected.seats[0]).toMatchObject({
      kind: 'ai_takeover',
      connected: true,
    });
    expect(JSON.stringify(reconnected)).not.toContain('pendingHumanRecovery');
    expect(
      JSON.stringify(rooms.getPrivate(created.room.code, created.session.token)),
    ).not.toContain('pendingHumanRecovery');
    expect(() =>
      rooms.submitAction(created.room.code, created.session.token, {
        idempotencyKey: 'reconnected-night-action',
        type: 'acknowledge_role',
      }),
    ).toThrow(ConflictException);

    while (phaseView.phase === 'night') {
      phaseView = rooms.hostControl(created.room.code, created.session.token, 'advance');
      if (phaseView.phase === 'night') {
        expect(phaseView.seats[0]?.kind).toBe('ai_takeover');
      }
    }
    expect(phaseView.phase).toBe('dawn');
    expect(phaseView.seats[0]).toMatchObject({
      kind: 'human',
      connected: true,
    });
  });

  it('keeps roles, role-team knowledge, event logs and session tokens out of public state', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    const participants = [
      created,
      ...['玩家二', '玩家三', '玩家四', '玩家五', '玩家六'].map((nickname) =>
        rooms.join(created.room.code, nickname),
      ),
    ];
    for (const participant of participants) {
      rooms.setReady(created.room.code, participant.session.token, true);
    }

    const started = rooms.start(created.room.id, created.session.token);
    const serialized = JSON.stringify(started);
    expect(serialized).not.toMatch(
      /"role"|"revealedRole"|"werewolfTeamIds"|"seerChecks"|"eventLog"|"hostSessionId"/,
    );
    for (const participant of participants) {
      expect(serialized).not.toContain(participant.session.token);
    }

    const privateViews = participants.map((participant) => {
      const view = rooms.getPrivate(created.room.code, participant.session.token);
      expect(view?.playerId).toBe(participant.session.seatId);
      expect(view?.role).toBeTruthy();
      expect(JSON.stringify(view)).not.toMatch(
        /aiThoughtHistory|decisionSummary|visibleAnalysis|activeDecision/,
      );
      return view;
    });
    const wolves = privateViews.filter((view) => view?.role === 'werewolf');
    expect(wolves).toHaveLength(2);
    expect(wolves.every((view) => view?.werewolfTeamIds?.length === 2)).toBe(true);
    expect(
      privateViews
        .filter((view) => view?.role !== 'werewolf')
        .every((view) => view?.werewolfTeamIds === undefined),
    ).toBe(true);
  });

  it('coarsens all secret night sub-phases without exposing timers or version deltas', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    rooms.configureAi(
      created.room.id,
      created.session.token,
      [2, 3, 4, 5, 6].map((seatNumber) => ({
        seatNumber,
        modelId: 'model',
        providerId: 'deepseek',
        personality: 'logical' as const,
      })),
    );
    rooms.setReady(created.room.code, created.session.token, true);
    rooms.start(created.room.id, created.session.token);

    const wolves = rooms.hostControl(created.room.code, created.session.token, 'advance');
    const seer = rooms.hostControl(created.room.code, created.session.token, 'advance');
    const witch = rooms.hostControl(created.room.code, created.session.token, 'advance');
    const nightViews = [wolves, seer, witch];

    expect(nightViews.every((view) => view.phase === 'night')).toBe(true);
    expect(nightViews.every((view) => view.game?.phase === 'night')).toBe(true);
    expect(nightViews.every((view) => view.game?.phaseId === '1:night')).toBe(true);
    expect(nightViews.every((view) => view.phaseEndsAt === undefined)).toBe(true);
    expect(new Set(nightViews.map((view) => view.version)).size).toBe(1);
    expect(JSON.stringify(nightViews)).not.toMatch(/night_(?:guard|werewolves|seer|witch)/);

    const dawn = rooms.hostControl(created.room.code, created.session.token, 'advance');
    expect(dawn.phase).toBe('dawn');
    expect(dawn.version).toBe(witch.version + 1);
  });

  it('adds an authoritative sender and rejects chat outside a speaking phase', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    expect(
      rooms.createChatEvent(created.room.code, created.session.token, '  大家好  '),
    ).toMatchObject({
      type: 'chat.message',
      actorId: created.session.seatId,
      seatNumber: 1,
      nickname: '房主',
      message: '大家好',
    });
    rooms.configureAi(
      created.room.id,
      created.session.token,
      [2, 3, 4, 5, 6].map((seatNumber) => ({
        seatNumber,
        modelId: 'model',
        providerId: 'deepseek',
        personality: 'logical' as const,
      })),
    );
    rooms.setReady(created.room.code, created.session.token, true);
    rooms.start(created.room.id, created.session.token);
    expect(() =>
      rooms.createChatEvent(created.room.code, created.session.token, '越权发言'),
    ).toThrow(ConflictException);
  });

  it('persists a human speech before building the next AI prompt', () => {
    const execute = vi.fn(
      (_data: AiTurnJobData) =>
        new Promise<AiTurnJobResult>(() => {
          // Keep earlier AI turns pending so the host can deterministically force phases in this test.
        }),
    );
    rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
    const created = rooms.create(inviteCode, 6, '房主');
    rooms.configureAi(created.room.id, created.session.token, aiSeatConfigs());
    rooms.setReady(created.room.code, created.session.token, true);
    const speaking = advanceUntilHostCanSpeak(
      rooms,
      rooms.start(created.room.id, created.session.token),
      created.session.token,
      created.session.seatId,
    );

    const chat = rooms.createChatEvent(
      created.room.code,
      created.session.token,
      '我认为二号的逻辑需要复盘',
    );
    expect(rooms.getPublic(created.room.code).chatHistory.at(-1)).toEqual(chat);
    rooms.submitAction(created.room.code, created.session.token, {
      idempotencyKey: 'finish-human-speech',
      type: 'finish_speech',
    });

    const speakJob = [...execute.mock.calls]
      .reverse()
      .map(([job]) => job)
      .find((job) => job.actionType === 'speak');
    expect(speakJob).toBeDefined();
    const userMessage = speakJob?.request.messages.find((message) => message.role === 'user');
    const prompt = JSON.parse(userMessage?.content ?? '{}') as {
      publicDiscussionHistory?: readonly { message?: string; phase?: string; round?: number }[];
    };
    expect(prompt.publicDiscussionHistory?.at(-1)).toMatchObject({
      message: '我认为二号的逻辑需要复盘',
      phase: speaking.phase,
      round: speaking.game?.round,
    });
  });

  it.each([
    ['12000', 12_000],
    ['1000000e0', DEFAULT_AI_PROVIDER_TIMEOUT_MS],
  ])(
    'uses the shared canonical provider timeout reader for AI requests: %s',
    (configuredTimeout, expectedTimeout) => {
      vi.stubEnv('AI_PROVIDER_TIMEOUT_MS', configuredTimeout);
      const execute = vi.fn(
        (_data: AiTurnJobData) =>
          new Promise<AiTurnJobResult>(() => {
            // Keep AI turns pending while the host advances the deterministic test room.
          }),
      );
      rooms = new RoomsService(admin, { execute } as unknown as AiTurnQueueService);
      const created = rooms.create(inviteCode, 6, '房主');
      rooms.configureAi(created.room.id, created.session.token, aiSeatConfigs());
      rooms.setReady(created.room.code, created.session.token, true);
      advanceUntilAiCanSpeak(
        rooms,
        rooms.start(created.room.id, created.session.token),
        created.session.token,
      );

      expect(execute).toHaveBeenCalled();
      expect(execute.mock.calls.every(([job]) => job.request.timeoutMs === expectedTimeout)).toBe(
        true,
      );
    },
  );

  it('stores AI speech and its private summary without exposing the summary publicly', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    rooms.configureAi(created.room.id, created.session.token, aiSeatConfigs());
    rooms.setReady(created.room.code, created.session.token, true);
    const speaking = advanceUntilAiCanSpeak(
      rooms,
      rooms.start(created.room.id, created.session.token),
      created.session.token,
    );
    const phaseId = speaking.room.game?.phaseId;
    if (!phaseId) throw new Error('Speaking phase did not expose a phase id');

    const privateSummary = '仅供当前 AI：我已公开质疑三号';
    (
      rooms as unknown as {
        applyAiTurn(application: {
          readonly pendingKey: string;
          readonly turnId: string;
          readonly roomId: string;
          readonly gameId: string;
          readonly expectedPhaseId: string;
          readonly actorId: string;
          readonly actionType: 'speak';
          readonly result: AiTurnJobResult;
          readonly startedAt: number;
          readonly scheduledAt: number;
        }): void;
      }
    ).applyAiTurn({
      pendingKey: 'test-speech',
      turnId: 'test-speech',
      roomId: speaking.room.id,
      gameId: speaking.room.game?.gameId ?? '',
      expectedPhaseId: phaseId,
      actorId: speaking.actorId,
      actionType: 'speak',
      result: {
        action: {
          type: 'speak',
          message: '三号前后说法不一致，我建议重点听他的下一轮发言。',
          memorySummary: privateSummary,
        },
        attempts: 1,
        usedFallback: false,
        failureReasons: [],
        costCents: 1,
      },
      startedAt: Date.now(),
      scheduledAt: Date.now(),
    });

    const snapshot = rooms.getPublic(created.room.code);
    const savedSpeech = snapshot.chatHistory.at(-1);
    expect(savedSpeech).toMatchObject({
      actorId: speaking.actorId,
      message: '三号前后说法不一致，我建议重点听他的下一轮发言。',
      round: speaking.room.game?.round,
      phase: speaking.room.phase,
    });
    const aiChange = rooms.tick().find((change) => change.event === 'ai.action');
    expect(aiChange?.payload).toMatchObject({
      id: savedSpeech?.id,
      actorId: speaking.actorId,
      message: savedSpeech?.message,
    });
    expect(JSON.stringify(snapshot)).not.toContain(privateSummary);
    expect(JSON.stringify(aiChange)).not.toContain(privateSummary);
    expect(JSON.stringify(snapshot)).not.toContain('aiMemorySummaries');
    const contextFor = (
      rooms as unknown as {
        conversationContextFor(
          roomId: string,
          actorId: string,
        ): {
          readonly memorySummary?: string;
        };
      }
    ).conversationContextFor.bind(rooms);
    expect(contextFor(speaking.room.id, speaking.actorId).memorySummary).toBe(privateSummary);
    const otherAiSeat = snapshot.seats.find(
      (seat) => seat.kind === 'ai' && seat.id !== speaking.actorId,
    );
    if (!otherAiSeat) throw new Error('Expected another AI seat');
    expect(contextFor(speaking.room.id, otherAiSeat.id).memorySummary).toBeUndefined();
  });

  it('isolates and bounds actor-private AI memory and public prompt context', () => {
    const actorASummary = `A-${'甲'.repeat(MAX_AI_MEMORY_SUMMARY_CHARS + 200)}`;
    const actorBSummary = 'B-绝不能进入 A 的上下文';
    let summaries = storeAiMemorySummary({}, 'actor-a', actorASummary);
    summaries = storeAiMemorySummary(summaries, 'actor-b', actorBSummary);
    expect(summaries['actor-a']).toHaveLength(MAX_AI_MEMORY_SUMMARY_CHARS);
    expect(summaries['actor-b']).toBe(actorBSummary);

    const history = Array.from({ length: 45 }, (_, index) =>
      publicChatMessage(index, `${index}-${'公开'.repeat(250)}`),
    );
    const context = buildAiConversationContext(
      { chatHistory: history, aiMemorySummaries: summaries },
      'actor-a',
    );
    expect(context.memorySummary).toBe(summaries['actor-a']);
    expect(JSON.stringify(context)).not.toContain(actorBSummary);
    expect(context.publicDiscussionHistory.length).toBeLessThanOrEqual(MAX_AI_PROMPT_CHAT_MESSAGES);
    expect(JSON.stringify(context.publicDiscussionHistory).length).toBeLessThanOrEqual(
      MAX_AI_PROMPT_CHAT_CHARS,
    );
    expect(context.publicDiscussionHistory.at(-1)?.id).toBe('message-44');
  });

  it('keeps only the latest bounded public chat messages in reconnect snapshots', () => {
    const created = rooms.create(inviteCode, 6, '房主');
    for (let index = 0; index < MAX_PUBLIC_CHAT_HISTORY + 7; index += 1) {
      rooms.createChatEvent(created.room.code, created.session.token, `消息 ${index}`);
    }
    const snapshot = rooms.getPublic(created.room.code);
    expect(snapshot.chatHistory).toHaveLength(MAX_PUBLIC_CHAT_HISTORY);
    expect(snapshot.chatHistory[0]?.message).toBe('消息 7');
    expect(snapshot.chatHistory.at(-1)?.message).toBe(`消息 ${MAX_PUBLIC_CHAT_HISTORY + 6}`);
  });
});
