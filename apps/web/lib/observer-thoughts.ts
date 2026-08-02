import type { GamePhase, ObserverPrivateState } from '@werewolf/contracts';

export type AiThoughtSource = 'provider' | 'fallback';
export type AiLifecycleState = 'thinking' | 'summary_ready' | 'completed' | 'fallback';

export interface ObserverAiThought {
  readonly id: string;
  readonly turnId: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly phase: GamePhase;
  readonly round: number;
  readonly content: string;
  readonly visibleAnalysis?: string;
  readonly source: AiThoughtSource;
  readonly timestamp: number;
  readonly actionType: ActiveDecisionActionType;
}

export type ActiveDecisionActionType = 'speak' | 'vote' | 'night';
export type ActiveDecisionState = 'thinking' | 'summary_ready' | 'fallback';

export interface ActiveAiDecision {
  readonly turnId: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly phase: GamePhase;
  readonly round: number;
  readonly actionType: ActiveDecisionActionType;
  readonly status: ActiveDecisionState;
  readonly source?: AiThoughtSource;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly summaryReadyAt?: number;
  readonly applyAt?: number;
}

export interface AiLifecycleStatus {
  readonly roomId: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly phase: GamePhase;
  readonly round: number;
  readonly status: AiLifecycleState;
  readonly source: AiThoughtSource;
  readonly actionType?: string;
}

export interface ObserverRoomCorrelation {
  readonly roomId: string;
  readonly gameId: string | undefined;
  readonly roomMode: 'standard' | 'ai_observer' | undefined;
}

export const MAX_RENDERED_OBSERVER_THOUGHTS = 80;
export const OBSERVER_FALLBACK_GUIDANCE =
  '可能原因包括额度耗尽、请求超时、供应商错误、模型未启用，或返回格式与行动不合法。请到模型控制台查看状态和用量；兜底内容不会冒充模型输出。';
const MAX_SUMMARY_LENGTH = 600;
const MAX_VISIBLE_ANALYSIS_LENGTH = 1_200;
const MAX_SHORT_FIELD_LENGTH = 120;

const phases = new Set<GamePhase>([
  'lobby',
  'role_reveal',
  'night_guard',
  'night_werewolves',
  'night_seer',
  'night_witch',
  'dawn',
  'last_words',
  'discussion',
  'voting',
  'hunter_shot',
  'resolution',
  'ended',
]);
const lifecycleStates = new Set<AiLifecycleState>([
  'thinking',
  'summary_ready',
  'completed',
  'fallback',
]);
const thoughtSources = new Set<AiThoughtSource>(['provider', 'fallback']);
const activeDecisionActions = new Set<ActiveDecisionActionType>(['speak', 'vote', 'night']);
const activeDecisionStates = new Set<ActiveDecisionState>([
  'thinking',
  'summary_ready',
  'fallback',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

function boundedString(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maximumLength);
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function positiveTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isGamePhase(value: unknown): value is GamePhase {
  return typeof value === 'string' && phases.has(value as GamePhase);
}

function isThoughtSource(value: unknown): value is AiThoughtSource {
  return typeof value === 'string' && thoughtSources.has(value as AiThoughtSource);
}

export function normalizeObserverPrivateStateForRoom(
  input: unknown,
  correlation: ObserverRoomCorrelation,
): ObserverPrivateState | undefined {
  if (
    !isRecord(input) ||
    correlation.roomMode !== 'ai_observer' ||
    boundedString(correlation.roomId, MAX_SHORT_FIELD_LENGTH) === undefined ||
    boundedString(correlation.gameId, MAX_SHORT_FIELD_LENGTH) === undefined
  ) {
    return undefined;
  }

  const roomId = boundedString(input.roomId, MAX_SHORT_FIELD_LENGTH);
  const gameId = boundedString(input.gameId, MAX_SHORT_FIELD_LENGTH);
  const phaseId = boundedString(input.phaseId, MAX_SHORT_FIELD_LENGTH);
  if (
    input.connected !== true ||
    input.isObserver !== true ||
    input.mode !== 'ai_observer' ||
    roomId !== correlation.roomId ||
    gameId !== correlation.gameId ||
    phaseId === undefined ||
    positiveInteger(input.round) === undefined ||
    !isGamePhase(input.phase) ||
    !Array.isArray(input.currentActorIds) ||
    !Array.isArray(input.aiThoughtHistory) ||
    !Array.isArray(input.roles) ||
    !Array.isArray(input.actions) ||
    !Array.isArray(input.chatHistory)
  ) {
    return undefined;
  }

  return input as unknown as ObserverPrivateState;
}

export function normalizeAiLifecycleStatus(input: unknown): AiLifecycleStatus | undefined {
  if (!isRecord(input)) return undefined;

  const roomId = boundedString(input.roomId, MAX_SHORT_FIELD_LENGTH);
  const actorId = boundedString(input.actorId, MAX_SHORT_FIELD_LENGTH);
  const seatNumber = positiveInteger(input.seatNumber);
  const round = positiveInteger(input.round);
  const source = isThoughtSource(input.source) ? input.source : undefined;
  const status =
    typeof input.status === 'string' && lifecycleStates.has(input.status as AiLifecycleState)
      ? (input.status as AiLifecycleState)
      : undefined;

  if (
    roomId === undefined ||
    actorId === undefined ||
    seatNumber === undefined ||
    round === undefined ||
    !isGamePhase(input.phase) ||
    source === undefined ||
    status === undefined
  ) {
    return undefined;
  }

  const actionType = boundedString(input.actionType, MAX_SHORT_FIELD_LENGTH);
  return {
    roomId,
    actorId,
    seatNumber,
    phase: input.phase,
    round,
    status,
    source,
    ...(actionType ? { actionType } : {}),
  };
}

export function normalizeActiveAiDecision(input: unknown): ActiveAiDecision | undefined {
  if (!isRecord(input)) return undefined;

  const turnId = boundedString(input.turnId, MAX_SHORT_FIELD_LENGTH);
  const actorId = boundedString(input.actorId, MAX_SHORT_FIELD_LENGTH);
  const nickname = boundedString(input.nickname, MAX_SHORT_FIELD_LENGTH);
  const providerId = boundedString(input.providerId, MAX_SHORT_FIELD_LENGTH);
  const modelId = boundedString(input.modelId, MAX_SHORT_FIELD_LENGTH);
  const seatNumber = positiveInteger(input.seatNumber);
  const round = positiveInteger(input.round);
  const startedAt = positiveTimestamp(input.startedAt);
  const updatedAt = positiveTimestamp(input.updatedAt);
  const source = isThoughtSource(input.source) ? input.source : undefined;
  const actionType =
    typeof input.actionType === 'string' &&
    activeDecisionActions.has(input.actionType as ActiveDecisionActionType)
      ? (input.actionType as ActiveDecisionActionType)
      : undefined;
  const status =
    typeof input.status === 'string' &&
    activeDecisionStates.has(input.status as ActiveDecisionState)
      ? (input.status as ActiveDecisionState)
      : undefined;

  if (
    turnId === undefined ||
    actorId === undefined ||
    nickname === undefined ||
    providerId === undefined ||
    modelId === undefined ||
    seatNumber === undefined ||
    round === undefined ||
    startedAt === undefined ||
    updatedAt === undefined ||
    !isGamePhase(input.phase) ||
    actionType === undefined ||
    status === undefined
  ) {
    return undefined;
  }

  const summaryReadyAt = positiveTimestamp(input.summaryReadyAt);
  const applyAt = positiveTimestamp(input.applyAt);
  return {
    turnId,
    actorId,
    seatNumber,
    nickname,
    providerId,
    modelId,
    phase: input.phase,
    round,
    actionType,
    status,
    ...(source ? { source } : {}),
    startedAt,
    updatedAt,
    ...(summaryReadyAt ? { summaryReadyAt } : {}),
    ...(applyAt ? { applyAt } : {}),
  };
}

function normalizeObserverThought(input: unknown): ObserverAiThought | undefined {
  if (!isRecord(input)) return undefined;

  const id = boundedString(input.id, MAX_SHORT_FIELD_LENGTH);
  const turnId = boundedString(input.turnId, MAX_SHORT_FIELD_LENGTH);
  const actorId = boundedString(input.actorId, MAX_SHORT_FIELD_LENGTH);
  const nickname = boundedString(input.nickname, MAX_SHORT_FIELD_LENGTH);
  const providerId = boundedString(input.providerId, MAX_SHORT_FIELD_LENGTH);
  const modelId = boundedString(input.modelId, MAX_SHORT_FIELD_LENGTH);
  const content = boundedString(input.content, MAX_SUMMARY_LENGTH);
  const visibleAnalysis = boundedString(input.visibleAnalysis, MAX_VISIBLE_ANALYSIS_LENGTH);
  const actionType =
    typeof input.actionType === 'string' &&
    activeDecisionActions.has(input.actionType as ActiveDecisionActionType)
      ? (input.actionType as ActiveDecisionActionType)
      : undefined;
  const seatNumber = positiveInteger(input.seatNumber);
  const round = positiveInteger(input.round);
  const timestamp = positiveTimestamp(input.timestamp);
  const source = isThoughtSource(input.source) ? input.source : undefined;

  if (
    id === undefined ||
    turnId === undefined ||
    actorId === undefined ||
    nickname === undefined ||
    providerId === undefined ||
    modelId === undefined ||
    content === undefined ||
    actionType === undefined ||
    seatNumber === undefined ||
    round === undefined ||
    timestamp === undefined ||
    !isGamePhase(input.phase) ||
    source === undefined
  ) {
    return undefined;
  }

  return {
    id,
    turnId,
    actorId,
    seatNumber,
    nickname,
    providerId,
    modelId,
    phase: input.phase,
    round,
    content,
    ...(visibleAnalysis ? { visibleAnalysis } : {}),
    source,
    timestamp,
    actionType,
  };
}

export function normalizeObserverThoughtHistory(input: unknown): readonly ObserverAiThought[] {
  if (!Array.isArray(input)) return [];

  const byId = new Map<string, ObserverAiThought>();
  for (const candidate of input) {
    const thought = normalizeObserverThought(candidate);
    if (thought) byId.set(thought.id, thought);
  }

  return [...byId.values()].slice(-MAX_RENDERED_OBSERVER_THOUGHTS);
}

export function observerThoughtsForActor(
  thoughts: readonly ObserverAiThought[],
  actorId: string,
): readonly ObserverAiThought[] {
  return thoughts
    .filter((thought) => thought.actorId === actorId)
    .toSorted((left, right) => left.timestamp - right.timestamp);
}
