import type { GamePhase, PublicChatMessage } from '@werewolf/contracts';

import type { LiveGameEvent } from './live-api';

export interface ObserverDiscussionSpeech {
  readonly kind: 'speech';
  readonly id: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly message: string;
  readonly at: number;
  readonly round: number;
  readonly phase: GamePhase;
  readonly ordinal: number;
}

export interface ObserverDiscussionRoundDivider {
  readonly kind: 'round';
  readonly id: string;
  readonly round: number;
}

export type ObserverDiscussionItem = ObserverDiscussionRoundDivider | ObserverDiscussionSpeech;

interface IndexedSpeech extends Omit<ObserverDiscussionSpeech, 'kind' | 'ordinal'> {
  readonly sourceIndex: number;
}

const speakingPhases = new Set<GamePhase>(['last_words', 'discussion']);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object';
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function finiteTimestamp(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function speakingPhase(value: unknown): GamePhase | undefined {
  return typeof value === 'string' && speakingPhases.has(value as GamePhase)
    ? (value as GamePhase)
    : undefined;
}

function normalizeSpeech(
  input: unknown,
  sourceIndex: number,
  fallbackRound: number,
): IndexedSpeech | undefined {
  if (!isRecord(input)) return undefined;
  const type = input.type;
  if (type !== 'chat.message' && !(type === 'ai.action' && typeof input.message === 'string')) {
    return undefined;
  }

  const actorId = nonEmptyString(input.actorId);
  const message = nonEmptyString(input.message);
  const seatNumber = positiveInteger(input.seatNumber ?? input.seat);
  const nickname = nonEmptyString(input.nickname ?? input.author);
  if (!actorId || !message || !seatNumber || !nickname) return undefined;

  const at = finiteTimestamp(input.at) ?? sourceIndex + 1;
  const round = positiveInteger(input.round) ?? fallbackRound;
  const phase = speakingPhase(input.phase) ?? 'discussion';
  const id =
    nonEmptyString(input.id) ?? `speech-${actorId}-${at}-${message.slice(0, 32)}-${sourceIndex}`;

  return {
    id,
    actorId,
    seatNumber,
    nickname,
    message,
    at,
    round,
    phase,
    sourceIndex,
  };
}

/**
 * Reconnect snapshots and realtime events may contain the same authoritative
 * speech. Prefer the latest copy by id, then restore chronological table order.
 */
export function buildObserverDiscussion(
  chatHistory: readonly PublicChatMessage[] | undefined,
  events: readonly LiveGameEvent[],
  fallbackRound = 1,
): readonly ObserverDiscussionItem[] {
  const byId = new Map<string, IndexedSpeech>();
  const candidates: readonly unknown[] = [...(chatHistory ?? []), ...events];
  candidates.forEach((candidate, sourceIndex) => {
    const speech = normalizeSpeech(candidate, sourceIndex, fallbackRound);
    if (speech) byId.set(speech.id, speech);
  });

  const speeches = [...byId.values()].sort(
    (left, right) => left.at - right.at || left.sourceIndex - right.sourceIndex,
  );
  const items: ObserverDiscussionItem[] = [];
  let currentRound: number | undefined;
  let currentSpeakingGroup = '';
  let ordinal = 0;
  const actorOrdinals = new Map<string, number>();

  for (const speech of speeches) {
    if (speech.round !== currentRound) {
      currentRound = speech.round;
      currentSpeakingGroup = '';
      ordinal = 0;
      actorOrdinals.clear();
      items.push({
        kind: 'round',
        id: `round-${speech.round}`,
        round: speech.round,
      });
    }

    const speakingGroup = `${speech.round}:${speech.phase}`;
    if (speakingGroup !== currentSpeakingGroup) {
      currentSpeakingGroup = speakingGroup;
      ordinal = 0;
      actorOrdinals.clear();
    }
    let actorOrdinal = actorOrdinals.get(speech.actorId);
    if (actorOrdinal === undefined) {
      ordinal += 1;
      actorOrdinal = ordinal;
      actorOrdinals.set(speech.actorId, actorOrdinal);
    }

    const { sourceIndex: _sourceIndex, ...publicSpeech } = speech;
    items.push({ kind: 'speech', ordinal: actorOrdinal, ...publicSpeech });
  }

  return items;
}
