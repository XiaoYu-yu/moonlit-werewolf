import type {
  Alignment,
  DeathCause,
  GameAction,
  GameEvent,
  GamePhase,
  GamePreset,
  PlayerKind,
  PublicGamePhase,
  Role,
  SeerCheck,
  Winner,
} from './game.js';
import type { AiPersonality, PlayableAiProviderId } from './ai.js';

export const ROOM_MODES = ['standard', 'ai_observer'] as const;
export type RoomMode = (typeof ROOM_MODES)[number];

export const OBSERVER_PRIVATE_STATE_EVENT = 'observer.private_state' as const;

export const AI_DECISION_ACTION_TYPES = ['speak', 'vote', 'night'] as const;
export type AiDecisionActionType = (typeof AI_DECISION_ACTION_TYPES)[number];

export const AI_DECISION_LIFECYCLE_STATUSES = [
  'thinking',
  'summary_ready',
  'completed',
  'fallback',
] as const;
export type AiDecisionLifecycleStatus = (typeof AI_DECISION_LIFECYCLE_STATUSES)[number];

export type AiDecisionSource = 'provider' | 'fallback';

/**
 * Non-secret lifecycle metadata. `ai.status` may use this shape, but the
 * decision summary itself must remain exclusive to `ObserverPrivateState`.
 */
export interface AiDecisionStatus {
  readonly turnId: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly providerId: PlayableAiProviderId;
  readonly modelId: string;
  readonly phase: GamePhase;
  readonly round: number;
  readonly actionType: AiDecisionActionType;
  readonly status: AiDecisionLifecycleStatus;
  readonly source?: AiDecisionSource;
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly summaryReadyAt?: number;
  readonly applyAt?: number;
}

export type AiActiveDecision = Omit<AiDecisionStatus, 'status'> & {
  readonly status: 'thinking' | 'summary_ready' | 'fallback';
};

/**
 * A short provider-authored final decision summary, not hidden chain-of-thought.
 * Entries with source=fallback explicitly describe deterministic rule fallback.
 */
export interface AiThoughtEntry {
  readonly id: string;
  readonly turnId: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly providerId: PlayableAiProviderId;
  readonly modelId: string;
  readonly phase: GamePhase;
  readonly round: number;
  readonly actionType: AiDecisionActionType;
  /**
   * Provider-authored analysis deliberately written for the authenticated
   * observer. This is not a hidden chain-of-thought or raw reasoning trace.
   * Fallback entries omit it instead of impersonating model analysis.
   */
  readonly visibleAnalysis?: string;
  readonly content: string;
  readonly source: AiDecisionSource;
  readonly timestamp: number;
}

export interface AiObserverLineupSeat {
  readonly seatNumber: number;
  readonly providerId: PlayableAiProviderId;
  readonly modelId?: string;
  readonly personality: AiPersonality;
  readonly nickname?: string;
}

export interface CreateAiObserverRoomRequest {
  readonly inviteCode: string;
  readonly preset: GamePreset;
  readonly lineup: readonly AiObserverLineupSeat[];
}

export interface PublicChatMessage {
  readonly id: string;
  readonly type: 'chat.message';
  readonly actorId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly message: string;
  readonly at: number;
  readonly round: number;
  readonly phase: PublicGamePhase;
}

export interface PublicPlayerState {
  readonly id: string;
  readonly seat: number;
  readonly name: string;
  readonly kind: PlayerKind;
  readonly alive: boolean;
  readonly revealedRole?: Role;
}

export interface PublicDeath {
  readonly playerId: string;
  readonly round: number;
  /**
   * Causes are intentionally disclosed only when the rules make them public
   * (for example, a daytime vote).
   */
  readonly cause?: DeathCause;
}

export interface PublicRoomState {
  readonly gameId: string;
  readonly preset: GamePreset;
  readonly round: number;
  readonly phase: PublicGamePhase;
  readonly phaseId: string;
  readonly players: readonly PublicPlayerState[];
  readonly deaths: readonly PublicDeath[];
  readonly currentActorIds: readonly string[];
  readonly voteRound?: 1 | 2;
  readonly voteCandidates?: readonly string[];
  readonly winner?: Winner;
}

export interface PrivatePlayerState {
  readonly playerId: string;
  readonly role: Role;
  readonly alignment: Alignment;
  readonly alive: boolean;
  readonly legalActions: readonly GameAction['type'][];
  readonly legalTargetIds: readonly string[];
  readonly werewolfTeamIds?: readonly string[];
  readonly seerChecks?: readonly SeerCheck[];
  readonly witch?: {
    readonly healAvailable: boolean;
    readonly poisonAvailable: boolean;
    readonly werewolfVictimId?: string;
  };
  readonly guard?: {
    readonly lastTargetId?: string;
  };
}

export interface ObserverPlayerState {
  readonly playerId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly role: Role;
  readonly alive: boolean;
  readonly providerId: PlayableAiProviderId;
  readonly modelId: string;
  readonly personality: AiPersonality;
  readonly death?: {
    readonly round: number;
    readonly cause: DeathCause;
  };
}

/**
 * Omniscient state is emitted only to the authenticated host of an explicitly
 * AI-only observer room. It must never be substituted for a normal player's
 * private view.
 */
export interface ObserverPrivateState {
  readonly connected: true;
  readonly isObserver: true;
  readonly roomId: string;
  readonly gameId: string;
  readonly mode: 'ai_observer';
  readonly round: number;
  readonly phase: GamePhase;
  readonly phaseId: string;
  readonly phaseEndsAt?: number;
  readonly currentActorIds: readonly string[];
  readonly activeDecision?: AiActiveDecision;
  readonly aiThoughtHistory: readonly AiThoughtEntry[];
  readonly roles: readonly ObserverPlayerState[];
  readonly actions: readonly GameEvent[];
  readonly chatHistory: readonly PublicChatMessage[];
  readonly winner?: Winner;
}
