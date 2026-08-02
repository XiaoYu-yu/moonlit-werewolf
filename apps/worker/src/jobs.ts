import type {
  AiTurnJobData as SharedAiTurnJobData,
  AiTurnJobResult as SharedAiTurnJobResult,
  TranscriptionResult,
} from '@werewolf/ai-gateway';
import { AI_TURN_QUEUE_NAME } from '@werewolf/ai-gateway';

export const QUEUES = {
  ai: AI_TURN_QUEUE_NAME,
  transcription: 'werewolf-transcription',
  persistence: 'werewolf-persistence',
} as const;

export type AiTurnJobData = SharedAiTurnJobData;

export interface TranscriptionJobData {
  readonly providerId: string;
  readonly audioBase64: string;
  readonly mimeType: string;
  readonly filename: string;
  readonly language?: string;
  readonly transcriptionId: string;
}

export interface PersistEventJobData {
  readonly matchId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly idempotencyKey: string;
}

export type AiTurnJobResult = SharedAiTurnJobResult;
export type TranscriptionJobResult = TranscriptionResult;
export interface PersistEventJobResult {
  readonly accepted: boolean;
  readonly idempotencyKey: string;
}
