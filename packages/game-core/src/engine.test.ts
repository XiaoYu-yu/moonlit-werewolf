import type {
  GameAction,
  GamePreset,
  GameResult,
  GameState,
  PlayerInput,
  Role,
} from '@werewolf/contracts';
import { describe, expect, it } from 'vitest';

import {
  advancePhase,
  createGame,
  getPresetRoles,
  getPrivateView,
  getPublicView,
  getVisibleEventLog,
  replayGame,
  startGame,
  submitAction,
} from './index.js';

function players(count: number): readonly PlayerInput[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `p${index + 1}`,
    seat: index + 1,
    name: `Player ${index + 1}`,
    kind: index === 0 ? 'human' : 'ai',
  }));
}

function unwrap(result: GameResult): GameState {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.state;
}

function create(preset: GamePreset, seed = 42): GameState {
  return unwrap(
    createGame({
      gameId: `game-${preset}`,
      preset,
      seed,
      players: players(preset),
    }),
  );
}

const roles6: Readonly<Record<string, Role>> = {
  p1: 'werewolf',
  p2: 'werewolf',
  p3: 'seer',
  p4: 'witch',
  p5: 'villager',
  p6: 'villager',
};

const roles9: Readonly<Record<string, Role>> = {
  p1: 'werewolf',
  p2: 'werewolf',
  p3: 'werewolf',
  p4: 'seer',
  p5: 'witch',
  p6: 'hunter',
  p7: 'villager',
  p8: 'villager',
  p9: 'villager',
};

const roles12: Readonly<Record<string, Role>> = {
  p1: 'werewolf',
  p2: 'werewolf',
  p3: 'werewolf',
  p4: 'werewolf',
  p5: 'seer',
  p6: 'witch',
  p7: 'hunter',
  p8: 'guard',
  p9: 'villager',
  p10: 'villager',
  p11: 'villager',
  p12: 'villager',
};

function started(preset: GamePreset, assignments: Readonly<Record<string, Role>>): GameState {
  return unwrap(startGame(create(preset), { roleAssignments: assignments }));
}

function send(state: GameState, action: GameAction): GameState {
  return unwrap(submitAction(state, action));
}

function acknowledgeAll(state: GameState): GameState {
  let current = state;
  for (const player of state.players) {
    current = send(current, { type: 'acknowledge_role', actorId: player.id });
  }
  return current;
}

function finishCurrentSpeechesUntilVoting(state: GameState): GameState {
  let current = state;
  while (current.phase.phase === 'discussion' || current.phase.phase === 'last_words') {
    const actorId = current.phase.eligibleActorIds[0];
    if (actorId === undefined) throw new Error('Speech phase had no speaker.');
    current = send(current, { type: 'finish_speech', actorId });
  }
  return current;
}

function noKillFirstNight9(): GameState {
  let state = acknowledgeAll(started(9, roles9));
  state = send(state, { type: 'werewolf_vote', actorId: 'p1', targetId: 'p7' });
  state = send(state, { type: 'werewolf_vote', actorId: 'p2', targetId: 'p8' });
  state = send(state, { type: 'werewolf_vote', actorId: 'p3', targetId: null });
  state = send(state, { type: 'seer_check', actorId: 'p4', targetId: 'p1' });
  state = send(state, {
    type: 'witch',
    actorId: 'p5',
    useHeal: false,
    poisonTargetId: null,
  });
  expect(state.phase.phase).toBe('dawn');
  state = unwrap(advancePhase(state));
  return finishCurrentSpeechesUntilVoting(state);
}

describe('configuration and deterministic setup', () => {
  it('exposes the exact 6/9/12 player role presets', () => {
    expect(getPresetRoles(6)).toEqual([
      'werewolf',
      'werewolf',
      'seer',
      'witch',
      'villager',
      'villager',
    ]);
    expect(getPresetRoles(9)).toHaveLength(9);
    expect(getPresetRoles(9).filter((role) => role === 'werewolf')).toHaveLength(3);
    expect(getPresetRoles(12)).toContain('guard');
    expect(getPresetRoles(12).filter((role) => role === 'villager')).toHaveLength(4);
  });

  it('rejects malformed rooms and role distributions', () => {
    const invalidRoom = createGame({
      gameId: 'bad',
      preset: 6,
      seed: 1,
      players: players(5),
    });
    expect(invalidRoom).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONFIGURATION' },
    });

    const invalidStart = startGame(create(6), {
      roleAssignments: { ...roles6, p6: 'seer' },
    });
    expect(invalidStart).toMatchObject({
      ok: false,
      error: { code: 'INVALID_CONFIGURATION' },
    });
  });

  it('assigns the same roles for the same seed', () => {
    const first = unwrap(startGame(create(9, 800)));
    const second = unwrap(startGame(create(9, 800)));
    expect(first.players.map((player) => player.role)).toEqual(
      second.players.map((player) => player.role),
    );
  });
});

describe('actions, phase authority and privacy', () => {
  it('rejects wrong-phase, invalid-target, duplicate, and ineligible actions', () => {
    let state = started(6, roles6);
    expect(
      submitAction(state, { type: 'seer_check', actorId: 'p3', targetId: 'p1' }),
    ).toMatchObject({ ok: false, error: { code: 'WRONG_PHASE' } });

    state = send(state, { type: 'acknowledge_role', actorId: 'p1' });
    expect(submitAction(state, { type: 'acknowledge_role', actorId: 'p1' })).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_ACTION' },
    });

    state = acknowledgeAll(unwrap(startGame(create(6, 99), { roleAssignments: roles6 })));
    expect(
      submitAction(state, { type: 'werewolf_vote', actorId: 'p1', targetId: 'p2' }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_TARGET' } });
    expect(
      submitAction(state, { type: 'werewolf_vote', actorId: 'p5', targetId: 'p1' }),
    ).toMatchObject({ ok: false, error: { code: 'ACTOR_NOT_ELIGIBLE' } });
  });

  it('keeps roles and secret events out of the public view', () => {
    let state = acknowledgeAll(started(6, roles6));
    state = send(state, { type: 'werewolf_vote', actorId: 'p1', targetId: 'p5' });
    state = send(state, { type: 'werewolf_vote', actorId: 'p2', targetId: 'p5' });
    state = send(state, { type: 'seer_check', actorId: 'p3', targetId: 'p1' });

    expect(getPublicView(state).players.every((player) => player.revealedRole === undefined)).toBe(
      true,
    );
    expect(getVisibleEventLog(state).some((event) => event.kind === 'seer.result')).toBe(false);
    expect(getVisibleEventLog(state, 'p3').some((event) => event.kind === 'seer.result')).toBe(
      true,
    );
    expect(getPublicView(state).currentActorIds).toEqual([]);
    expect(
      getVisibleEventLog(state).some(
        (event) =>
          event.kind === 'phase.changed' && Object.hasOwn(event.payload, 'eligibleActorIds'),
      ),
    ).toBe(false);
    expect(getPrivateView(state, 'p3')?.seerChecks).toEqual([
      { round: 1, targetId: 'p1', alignment: 'werewolves' },
    ]);
    expect(getPrivateView(state, 'p1')?.werewolfTeamIds).toEqual(['p1', 'p2']);
  });

  it('makes dead-role night schedules indistinguishable in the public view', () => {
    const eliminatedIds = new Set(['p5', 'p6', 'p8']);
    const base = started(12, roles12);
    const commonPlayers = base.players.map((player) =>
      eliminatedIds.has(player.id)
        ? {
            ...player,
            alive: false,
            death: { round: 1, cause: 'werewolves' as const },
          }
        : player,
    );
    const skippedSpecialRoles: GameState = {
      ...base,
      round: 2,
      players: commonPlayers,
      phase: {
        id: '2:night_werewolves:secret',
        phase: 'night_werewolves',
        eligibleActorIds: ['p1', 'p2', 'p3', 'p4'],
        submissions: {},
      },
    };
    const livingGuard: GameState = {
      ...skippedSpecialRoles,
      players: commonPlayers.map((player) =>
        player.id === 'p8'
          ? { ...player, role: 'villager' as const }
          : player.id === 'p9'
            ? { ...player, role: 'guard' as const }
            : player,
      ),
      phase: {
        id: '2:night_guard:secret',
        phase: 'night_guard',
        eligibleActorIds: ['p9'],
        submissions: {},
      },
    };

    expect(getPublicView(skippedSpecialRoles)).toEqual(getPublicView(livingGuard));
    expect(getPublicView(skippedSpecialRoles)).toMatchObject({
      phase: 'night',
      phaseId: '2:night',
      currentActorIds: [],
    });
  });
});

describe('night role interactions', () => {
  it('makes a same-night guard plus heal kill the werewolf victim', () => {
    let state = acknowledgeAll(started(12, roles12));
    state = send(state, { type: 'guard', actorId: 'p8', targetId: 'p9' });
    for (const wolf of ['p1', 'p2', 'p3', 'p4']) {
      state = send(state, { type: 'werewolf_vote', actorId: wolf, targetId: 'p9' });
    }
    state = send(state, { type: 'seer_check', actorId: 'p5', targetId: 'p1' });
    state = send(state, {
      type: 'witch',
      actorId: 'p6',
      useHeal: true,
      poisonTargetId: null,
    });
    expect(state.phase.phase).toBe('dawn');
    expect(state.players.find((player) => player.id === 'p9')?.alive).toBe(false);
    expect(state.players.find((player) => player.id === 'p9')?.death?.cause).toBe('werewolves');
  });

  it('does not let a poison-killed hunter shoot', () => {
    let state = acknowledgeAll(started(9, roles9));
    for (const wolf of ['p1', 'p2', 'p3']) {
      state = send(state, { type: 'werewolf_vote', actorId: wolf, targetId: 'p7' });
    }
    state = send(state, { type: 'seer_check', actorId: 'p4', targetId: 'p1' });
    state = send(state, {
      type: 'witch',
      actorId: 'p5',
      useHeal: false,
      poisonTargetId: 'p6',
    });
    state = unwrap(advancePhase(state));
    expect(state.phase.phase).toBe('last_words');
    expect(state.phase.eligibleActorIds[0]).toBe('p7');
    expect(state.pendingDeaths).toEqual(['p7', 'p6']);
  });

  it('resolves a tied werewolf vote as an empty kill', () => {
    let state = acknowledgeAll(started(9, roles9));
    state = send(state, { type: 'werewolf_vote', actorId: 'p1', targetId: 'p7' });
    state = send(state, { type: 'werewolf_vote', actorId: 'p2', targetId: 'p8' });
    state = send(state, { type: 'werewolf_vote', actorId: 'p3', targetId: null });
    state = send(state, { type: 'seer_check', actorId: 'p4', targetId: 'p1' });
    state = send(state, {
      type: 'witch',
      actorId: 'p5',
      useHeal: false,
      poisonTargetId: null,
    });
    expect(state.pendingDeaths).toEqual([]);
    expect(state.players.every((player) => player.alive)).toBe(true);
  });

  it('enforces guard consecutive-target and witch self-save restrictions', () => {
    let state = acknowledgeAll(started(12, roles12));
    state = send(state, { type: 'guard', actorId: 'p8', targetId: 'p9' });
    state = {
      ...state,
      round: 2,
      phase: {
        id: '2:night_guard:test',
        phase: 'night_guard',
        eligibleActorIds: ['p8'],
        submissions: {},
      },
    };
    expect(submitAction(state, { type: 'guard', actorId: 'p8', targetId: 'p9' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TARGET' },
    });

    const skipped = send(state, { type: 'guard', actorId: 'p8', targetId: null });
    const followingNight: GameState = {
      ...skipped,
      round: 3,
      phase: {
        id: '3:night_guard:test',
        phase: 'night_guard',
        eligibleActorIds: ['p8'],
        submissions: {},
      },
    };
    expect(
      submitAction(followingNight, { type: 'guard', actorId: 'p8', targetId: 'p9' }),
    ).toMatchObject({ ok: true });

    const witchTurn: GameState = {
      ...state,
      night: { werewolfTargetId: 'p6' },
      phase: {
        id: '2:night_witch:test',
        phase: 'night_witch',
        eligibleActorIds: ['p6'],
        submissions: {},
      },
    };
    expect(
      submitAction(witchTurn, {
        type: 'witch',
        actorId: 'p6',
        useHeal: true,
        poisonTargetId: null,
      }),
    ).toMatchObject({ ok: false, error: { code: 'INVALID_TARGET' } });
  });
});

describe('day voting and victory', () => {
  it('runs one restricted runoff and eliminates nobody on a second tie', () => {
    let state = noKillFirstNight9();
    expect(state.phase.phase).toBe('voting');
    const firstVotes: Readonly<Record<string, string | null>> = {
      p1: 'p7',
      p2: 'p7',
      p3: 'p7',
      p4: 'p8',
      p5: 'p8',
      p6: 'p8',
      p7: null,
      p8: null,
      p9: null,
    };
    for (const [actorId, targetId] of Object.entries(firstVotes)) {
      state = send(state, { type: 'day_vote', actorId, targetId });
    }
    expect(state.phase.phase).toBe('voting');
    expect(state.phase.voteRound).toBe(2);
    expect(state.phase.candidates).toEqual(['p7', 'p8']);
    expect(submitAction(state, { type: 'day_vote', actorId: 'p1', targetId: 'p9' })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_TARGET' },
    });

    const runoff: Readonly<Record<string, string | null>> = {
      p1: 'p7',
      p2: 'p7',
      p3: 'p8',
      p4: 'p8',
      p5: null,
      p6: null,
      p7: null,
      p8: null,
      p9: null,
    };
    for (const [actorId, targetId] of Object.entries(runoff)) {
      state = send(state, { type: 'day_vote', actorId, targetId });
    }
    expect(state.phase.phase).toBe('resolution');
    expect(state.players.every((player) => player.alive)).toBe(true);
  });

  it('declares good victorious when the final werewolf is voted out', () => {
    let state = noKillFirstNight9();
    state = {
      ...state,
      players: state.players.map((player) =>
        player.id === 'p2' || player.id === 'p3'
          ? {
              ...player,
              alive: false,
              death: { round: 1, cause: 'hunter' as const },
            }
          : player,
      ),
    };
    for (const actor of state.phase.eligibleActorIds) {
      state = send(state, {
        type: 'day_vote',
        actorId: actor,
        targetId: actor === 'p1' ? null : 'p1',
      });
    }
    expect(state.phase.phase).toBe('ended');
    expect(state.winner).toBe('good');
    expect(getPublicView(state).players.every((player) => player.revealedRole !== undefined)).toBe(
      true,
    );
  });

  it('declares werewolves victorious when either good role edge is gone', () => {
    let state = acknowledgeAll(started(6, roles6));
    state = {
      ...state,
      players: state.players.map((player) =>
        player.role === 'villager'
          ? {
              ...player,
              alive: false,
              death: { round: 1, cause: 'werewolves' as const },
            }
          : player,
      ),
      pendingDeaths: ['p5', 'p6'],
      pendingDeathCauses: { p5: 'werewolves', p6: 'werewolves' },
      phase: {
        id: 'test-dawn',
        phase: 'dawn',
        eligibleActorIds: [],
        submissions: {},
      },
    };
    state = unwrap(advancePhase(state));
    expect(state.phase.phase).toBe('ended');
    expect(state.winner).toBe('werewolves');
  });
});

describe('fallbacks and replay', () => {
  it('uses deterministic legal fallbacks to prevent a timed-out phase from blocking', () => {
    const initial = started(6, roles6);
    const first = unwrap(advancePhase(initial, 'timeout'));
    const second = unwrap(advancePhase(started(6, roles6), 'timeout'));
    expect(first.phase.phase).toBe('night_werewolves');
    expect(first.eventLog.filter((event) => event.kind === 'action.accepted')).toEqual(
      second.eventLog.filter((event) => event.kind === 'action.accepted'),
    );
  });

  it('replays command events to the same authoritative state', () => {
    let state = acknowledgeAll(started(6, roles6));
    state = send(state, { type: 'werewolf_vote', actorId: 'p1', targetId: 'p5' });
    state = send(state, { type: 'werewolf_vote', actorId: 'p2', targetId: 'p5' });
    state = send(state, { type: 'seer_check', actorId: 'p3', targetId: 'p1' });
    state = send(state, {
      type: 'witch',
      actorId: 'p4',
      useHeal: true,
      poisonTargetId: null,
    });
    state = unwrap(advancePhase(state));

    const replayed = unwrap(replayGame(state.eventLog));
    expect(replayed).toEqual(state);
  });

  it('rejects an event log with no creation record', () => {
    expect(replayGame([])).toMatchObject({
      ok: false,
      error: { code: 'INVALID_EVENT_LOG' },
    });
  });
});
