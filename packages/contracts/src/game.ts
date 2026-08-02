import type { AiSeatConfig } from './ai.js';

export const GAME_PRESET_SIZES = [6, 9, 12] as const;
export type GamePreset = (typeof GAME_PRESET_SIZES)[number];

export const ROLES = ['werewolf', 'villager', 'seer', 'witch', 'hunter', 'guard'] as const;
export type Role = (typeof ROLES)[number];
export type Alignment = 'werewolves' | 'good';
export type Winner = Alignment;

export const GAME_PHASES = [
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
] as const;
export type GamePhase = (typeof GAME_PHASES)[number];

/**
 * Public clients receive one coarse night phase. Exact role sub-phases remain
 * server-authoritative so their presence or timing cannot reveal living roles.
 */
export const PUBLIC_GAME_PHASES = [
  'lobby',
  'role_reveal',
  'night',
  'dawn',
  'last_words',
  'discussion',
  'voting',
  'hunter_shot',
  'resolution',
  'ended',
] as const;
export type PublicGamePhase = (typeof PUBLIC_GAME_PHASES)[number];

export type PlayerKind = 'human' | 'ai' | 'ai_takeover';
export type DeathCause = 'werewolves' | 'witch_poison' | 'vote' | 'hunter';
export type PhaseAdvanceReason = 'completed' | 'timeout' | 'host';

export interface GamePlayer {
  readonly id: string;
  readonly seat: number;
  readonly name: string;
  readonly kind: PlayerKind;
  readonly role?: Role;
  readonly alive: boolean;
  readonly ai?: AiSeatConfig;
  readonly death?: {
    readonly round: number;
    readonly cause: DeathCause;
  };
}

export interface SeerCheck {
  readonly round: number;
  readonly targetId: string;
  readonly alignment: Alignment;
}

export interface PhaseContext {
  readonly id: string;
  readonly phase: GamePhase;
  readonly eligibleActorIds: readonly string[];
  readonly submissions: Readonly<Record<string, GameAction>>;
  readonly voteRound?: 1 | 2;
  readonly candidates?: readonly string[];
  readonly speakerQueue?: readonly string[];
  readonly resumePhase?: GamePhase;
}

export interface NightState {
  readonly guardedTargetId?: string;
  readonly werewolfTargetId?: string;
  readonly healedTargetId?: string;
  readonly poisonedTargetId?: string;
}

export interface RoleResources {
  readonly witchHealAvailable: boolean;
  readonly witchPoisonAvailable: boolean;
  readonly guardLastTargetId?: string;
  readonly seerChecks: Readonly<Record<string, readonly SeerCheck[]>>;
}

export interface GameState {
  readonly version: 1;
  readonly gameId: string;
  readonly preset: GamePreset;
  readonly seed: number;
  readonly round: number;
  readonly phase: PhaseContext;
  readonly players: readonly GamePlayer[];
  readonly night: NightState;
  readonly resources: RoleResources;
  readonly pendingDeaths: readonly string[];
  readonly pendingDeathCauses: Readonly<Record<string, DeathCause>>;
  readonly winner?: Winner;
  readonly sequence: number;
  readonly eventLog: readonly GameEvent[];
}

export interface PlayerInput {
  readonly id: string;
  readonly seat: number;
  readonly name: string;
  readonly kind: PlayerKind;
  readonly ai?: AiSeatConfig;
}

export interface CreateGameOptions {
  readonly gameId: string;
  readonly preset: GamePreset;
  readonly seed: number;
  readonly players: readonly PlayerInput[];
}

export interface StartGameOptions {
  /**
   * Server-only override intended for restored games and deterministic tests.
   * When omitted, roles are shuffled from the preset using the game's seed.
   */
  readonly roleAssignments?: Readonly<Record<string, Role>>;
}

export interface AcknowledgeRoleAction {
  readonly type: 'acknowledge_role';
  readonly actorId: string;
}

export interface GuardAction {
  readonly type: 'guard';
  readonly actorId: string;
  readonly targetId: string | null;
}

export interface WerewolfVoteAction {
  readonly type: 'werewolf_vote';
  readonly actorId: string;
  readonly targetId: string | null;
}

export interface SeerCheckAction {
  readonly type: 'seer_check';
  readonly actorId: string;
  readonly targetId: string;
}

export interface WitchAction {
  readonly type: 'witch';
  readonly actorId: string;
  readonly useHeal: boolean;
  readonly poisonTargetId: string | null;
}

export interface FinishSpeechAction {
  readonly type: 'finish_speech';
  readonly actorId: string;
}

export interface DayVoteAction {
  readonly type: 'day_vote';
  readonly actorId: string;
  readonly targetId: string | null;
}

export interface HunterShotAction {
  readonly type: 'hunter_shot';
  readonly actorId: string;
  readonly targetId: string | null;
}

export type GameAction =
  | AcknowledgeRoleAction
  | GuardAction
  | WerewolfVoteAction
  | SeerCheckAction
  | WitchAction
  | FinishSpeechAction
  | DayVoteAction
  | HunterShotAction;

export type GameEventVisibility =
  | { readonly kind: 'public' }
  | { readonly kind: 'server' }
  | { readonly kind: 'players'; readonly playerIds: readonly string[] };

export type GameEventKind =
  | 'game.created'
  | 'game.started'
  | 'action.accepted'
  | 'phase.force_advanced'
  | 'phase.changed'
  | 'seer.result'
  | 'night.resolved'
  | 'dawn.revealed'
  | 'vote.resolved'
  | 'player.died'
  | 'game.ended';

export interface GameEvent {
  readonly sequence: number;
  readonly kind: GameEventKind;
  readonly visibility: GameEventVisibility;
  readonly round: number;
  readonly phase: GamePhase;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type GameErrorCode =
  | 'INVALID_CONFIGURATION'
  | 'GAME_ALREADY_STARTED'
  | 'GAME_ENDED'
  | 'WRONG_PHASE'
  | 'UNKNOWN_ACTOR'
  | 'ACTOR_NOT_ELIGIBLE'
  | 'DUPLICATE_ACTION'
  | 'INVALID_TARGET'
  | 'ROLE_FORBIDDEN'
  | 'RESOURCE_UNAVAILABLE'
  | 'INVALID_EVENT_LOG';

export interface GameEngineError {
  readonly code: GameErrorCode;
  readonly message: string;
}

export type GameResult<T = GameState> =
  | { readonly ok: true; readonly state: T; readonly events: readonly GameEvent[] }
  | { readonly ok: false; readonly error: GameEngineError };
