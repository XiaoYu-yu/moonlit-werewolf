import type {
  GameAction,
  GameEvent,
  GamePhase,
  GameState,
  PrivatePlayerState,
  PublicDeath,
  PublicGamePhase,
  PublicRoomState,
} from '@werewolf/contracts';

import { chooseFallbackAction } from './engine.js';
import { getAlignment } from './presets.js';

function toPublicPhase(phase: GamePhase): PublicGamePhase {
  switch (phase) {
    case 'night_guard':
    case 'night_werewolves':
    case 'night_seer':
    case 'night_witch':
      return 'night';
    default:
      return phase;
  }
}

export function getPublicView(state: GameState): PublicRoomState {
  const ended = state.phase.phase === 'ended';
  const publicPhase = toPublicPhase(state.phase.phase);
  const actorIdsArePublic = [
    'role_reveal',
    'last_words',
    'discussion',
    'voting',
    'hunter_shot',
  ].includes(state.phase.phase);
  const deaths: PublicDeath[] = state.players
    .filter((player) => player.death !== undefined)
    .map((player) => {
      const death = player.death;
      if (death === undefined) throw new Error('Unreachable death mapping.');
      const publicCause = death.cause === 'vote' || death.cause === 'hunter';
      return {
        playerId: player.id,
        round: death.round,
        ...(publicCause ? { cause: death.cause } : {}),
      };
    });
  return {
    gameId: state.gameId,
    preset: state.preset,
    round: state.round,
    phase: publicPhase,
    phaseId: publicPhase === 'night' ? `${state.round}:night` : state.phase.id,
    players: state.players.map((player) => ({
      id: player.id,
      seat: player.seat,
      name: player.name,
      kind: player.kind,
      alive: player.alive,
      ...(ended && player.role !== undefined ? { revealedRole: player.role } : {}),
    })),
    deaths,
    currentActorIds: actorIdsArePublic ? state.phase.eligibleActorIds : [],
    ...(state.phase.voteRound === undefined ? {} : { voteRound: state.phase.voteRound }),
    ...(state.phase.candidates === undefined ? {} : { voteCandidates: state.phase.candidates }),
    ...(state.winner === undefined ? {} : { winner: state.winner }),
  };
}

function legalTargetsFromFallbackShape(state: GameState, playerId: string): readonly string[] {
  const actor = state.players.find((player) => player.id === playerId);
  if (actor === undefined || !state.phase.eligibleActorIds.includes(playerId)) return [];
  const living = state.players.filter((player) => player.alive);
  switch (state.phase.phase) {
    case 'night_guard':
      return living
        .filter((player) => player.id !== state.resources.guardLastTargetId)
        .map((player) => player.id);
    case 'night_werewolves':
      return living.filter((player) => player.role !== 'werewolf').map((player) => player.id);
    case 'night_seer':
      return living.filter((player) => player.id !== playerId).map((player) => player.id);
    case 'night_witch':
      return state.resources.witchPoisonAvailable
        ? living.filter((player) => player.id !== playerId).map((player) => player.id)
        : [];
    case 'voting':
      return living
        .filter(
          (player) =>
            player.id !== playerId &&
            (state.phase.candidates === undefined || state.phase.candidates.includes(player.id)),
        )
        .map((player) => player.id);
    case 'hunter_shot':
      return living.filter((player) => player.id !== playerId).map((player) => player.id);
    default:
      return [];
  }
}

export function getPrivateView(state: GameState, playerId: string): PrivatePlayerState | undefined {
  const player = state.players.find((candidate) => candidate.id === playerId);
  if (player?.role === undefined) return undefined;
  const fallback = chooseFallbackAction(state, playerId);
  const legalActions: GameAction['type'][] = fallback === undefined ? [] : [fallback.type];
  return {
    playerId,
    role: player.role,
    alignment: getAlignment(player.role),
    alive: player.alive,
    legalActions,
    legalTargetIds: legalTargetsFromFallbackShape(state, playerId),
    ...(player.role === 'werewolf'
      ? {
          werewolfTeamIds: state.players
            .filter((candidate) => candidate.role === 'werewolf')
            .map((candidate) => candidate.id),
        }
      : {}),
    ...(player.role === 'seer' ? { seerChecks: state.resources.seerChecks[playerId] ?? [] } : {}),
    ...(player.role === 'witch'
      ? {
          witch: {
            healAvailable: state.resources.witchHealAvailable,
            poisonAvailable: state.resources.witchPoisonAvailable,
            ...(state.phase.phase === 'night_witch' && state.night.werewolfTargetId !== undefined
              ? { werewolfVictimId: state.night.werewolfTargetId }
              : {}),
          },
        }
      : {}),
    ...(player.role === 'guard'
      ? {
          guard: {
            ...(state.resources.guardLastTargetId === undefined
              ? {}
              : { lastTargetId: state.resources.guardLastTargetId }),
          },
        }
      : {}),
  };
}

export function canPlayerSeeEvent(event: GameEvent, playerId?: string): boolean {
  switch (event.visibility.kind) {
    case 'public':
      return true;
    case 'server':
      return false;
    case 'players':
      return playerId !== undefined && event.visibility.playerIds.includes(playerId);
  }
}

export function getVisibleEventLog(state: GameState, playerId?: string): readonly GameEvent[] {
  return state.eventLog.filter((event) => canPlayerSeeEvent(event, playerId));
}
