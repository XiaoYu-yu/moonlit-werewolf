import type {
  AiActiveDecision,
  AiPersonality,
  AiThoughtEntry,
  GamePhase,
  GameState,
  PublicChatMessage,
  PublicGamePhase,
  PublicRoomState as EnginePublicRoomState,
  RoomMode,
} from '@werewolf/contracts';

export type GamePreset = 6 | 9 | 12;
export type RoomStatus = 'lobby' | 'playing' | 'finished';
export type RuntimePhase = GamePhase;
export type SeatKind = 'human' | 'ai' | 'ai_takeover';

export interface AiSeatConfig {
  readonly modelId: string;
  readonly providerId: string;
  readonly personality: AiPersonality;
}

export interface SeatState {
  readonly id: string;
  readonly number: number;
  readonly kind: SeatKind;
  readonly nickname: string;
  readonly ready: boolean;
  readonly connected: boolean;
  readonly ai?: AiSeatConfig;
  readonly disconnectedAt?: number | undefined;
  readonly pendingHumanRecovery?: boolean | undefined;
}

export interface RoomState {
  readonly id: string;
  readonly code: string;
  readonly mode: RoomMode;
  readonly preset: GamePreset;
  readonly status: RoomStatus;
  readonly phase: RuntimePhase;
  readonly hostSessionId: string;
  readonly seats: readonly SeatState[];
  readonly version: number;
  readonly phaseEndsAt?: number | undefined;
  readonly pausedAt?: number | undefined;
  readonly createdAt: string;
  readonly game?: GameState;
  readonly chatHistory: readonly PublicChatMessage[];
  readonly aiMemorySummaries: Readonly<Record<string, string>>;
  readonly aiThoughtHistory: readonly AiThoughtEntry[];
  readonly activeAiDecision?: AiActiveDecision | undefined;
}

export interface PlayerSession {
  readonly id: string;
  readonly roomId: string;
  readonly seatId?: string;
  readonly token: string;
  readonly isHost: boolean;
  readonly kind: 'player' | 'observer';
  readonly lastSeenAt: number;
}

export interface PublicRoomState {
  readonly id: string;
  readonly code: string;
  readonly mode: RoomMode;
  readonly preset: GamePreset;
  readonly status: RoomStatus;
  readonly phase: PublicGamePhase;
  readonly seats: readonly Omit<SeatState, 'disconnectedAt' | 'pendingHumanRecovery'>[];
  readonly version: number;
  readonly phaseEndsAt?: number;
  readonly isPaused: boolean;
  readonly game?: EnginePublicRoomState;
  readonly chatHistory: readonly PublicChatMessage[];
}

export type ClientEventName =
  | 'room.join'
  | 'seat.ready'
  | 'chat.send'
  | 'game.action.submit'
  | 'host.control'
  | 'presence.heartbeat';

export type ServerEventName =
  | 'room.snapshot'
  | 'player.private_state'
  | 'observer.private_state'
  | 'game.event'
  | 'phase.timer'
  | 'ai.status'
  | 'error';
