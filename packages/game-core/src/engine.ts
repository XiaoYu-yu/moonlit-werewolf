import type {
  CreateGameOptions,
  DeathCause,
  GameAction,
  GameEvent,
  GameEventKind,
  GameEventVisibility,
  GamePhase,
  GamePlayer,
  GameResult,
  GameState,
  PhaseAdvanceReason,
  PhaseContext,
  Role,
  StartGameOptions,
  Winner,
} from '@werewolf/contracts';

import { failure } from './errors.js';
import { getAlignment, getPresetRoles, isGodRole } from './presets.js';
import { shuffleRoles } from './random.js';

interface EventDraft {
  readonly kind: GameEventKind;
  readonly visibility: GameEventVisibility;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly phase?: GamePhase;
  readonly round?: number;
}

interface StateEvents {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

interface PhaseOptions {
  readonly voteRound?: 1 | 2;
  readonly candidates?: readonly string[];
  readonly speakerQueue?: readonly string[];
  readonly resumePhase?: GamePhase;
}

const PUBLIC: GameEventVisibility = { kind: 'public' };
const SERVER: GameEventVisibility = { kind: 'server' };

function appendEvents(state: GameState, drafts: readonly EventDraft[]): StateEvents {
  let sequence = state.sequence;
  const events = drafts.map((draft): GameEvent => {
    sequence += 1;
    return {
      sequence,
      kind: draft.kind,
      visibility: draft.visibility,
      round: draft.round ?? state.round,
      phase: draft.phase ?? state.phase.phase,
      payload: draft.payload ?? {},
    };
  });
  return {
    state: {
      ...state,
      sequence,
      eventLog: [...state.eventLog, ...events],
    },
    events,
  };
}

function result(value: StateEvents): GameResult {
  return { ok: true, state: value.state, events: value.events };
}

function phaseContext(
  state: GameState,
  phase: GamePhase,
  eligibleActorIds: readonly string[],
  options: PhaseOptions = {},
): PhaseContext {
  return {
    id: `${state.round}:${phase}:${state.sequence + 1}`,
    phase,
    eligibleActorIds,
    submissions: {},
    ...(options.voteRound === undefined ? {} : { voteRound: options.voteRound }),
    ...(options.candidates === undefined ? {} : { candidates: options.candidates }),
    ...(options.speakerQueue === undefined ? {} : { speakerQueue: options.speakerQueue }),
    ...(options.resumePhase === undefined ? {} : { resumePhase: options.resumePhase }),
  };
}

function changePhase(
  state: GameState,
  phase: GamePhase,
  eligibleActorIds: readonly string[],
  options: PhaseOptions = {},
): StateEvents {
  const changed: GameState = {
    ...state,
    phase: phaseContext(state, phase, eligibleActorIds, options),
  };
  return appendEvents(changed, [
    {
      kind: 'phase.changed',
      visibility: PUBLIC,
      phase,
      payload: {
        phase,
        phaseId: changed.phase.id,
        ...(options.voteRound === undefined ? {} : { voteRound: options.voteRound }),
        ...(options.candidates === undefined ? {} : { candidates: options.candidates }),
      },
    },
  ]);
}

function mergeEvents(first: StateEvents, next: StateEvents): StateEvents {
  return { state: next.state, events: [...first.events, ...next.events] };
}

function livingPlayers(state: GameState): readonly GamePlayer[] {
  return state.players.filter((player) => player.alive);
}

function livingRole(state: GameState, role: Role): readonly GamePlayer[] {
  return state.players.filter((player) => player.alive && player.role === role);
}

function playerById(state: GameState, playerId: string): GamePlayer | undefined {
  return state.players.find((player) => player.id === playerId);
}

function sortedIds(players: readonly GamePlayer[]): readonly string[] {
  return [...players].sort((left, right) => left.seat - right.seat).map((player) => player.id);
}

function expectedActionType(phase: GamePhase): GameAction['type'] | undefined {
  switch (phase) {
    case 'role_reveal':
      return 'acknowledge_role';
    case 'night_guard':
      return 'guard';
    case 'night_werewolves':
      return 'werewolf_vote';
    case 'night_seer':
      return 'seer_check';
    case 'night_witch':
      return 'witch';
    case 'last_words':
    case 'discussion':
      return 'finish_speech';
    case 'voting':
      return 'day_vote';
    case 'hunter_shot':
      return 'hunter_shot';
    default:
      return undefined;
  }
}

function validateConfiguration(options: CreateGameOptions): string | undefined {
  if (options.players.length !== options.preset) {
    return `Preset ${options.preset} requires exactly ${options.preset} players.`;
  }
  const ids = new Set(options.players.map((player) => player.id));
  const seats = new Set(options.players.map((player) => player.seat));
  if (ids.size !== options.players.length || seats.size !== options.players.length) {
    return 'Player ids and seat numbers must be unique.';
  }
  if (
    options.players.some(
      (player) =>
        player.id.trim().length === 0 ||
        player.name.trim().length === 0 ||
        !Number.isInteger(player.seat) ||
        player.seat < 1 ||
        player.seat > options.preset,
    )
  ) {
    return 'Players require a non-empty id/name and an in-range integer seat.';
  }
  return undefined;
}

export function createGame(options: CreateGameOptions): GameResult {
  const configurationError = validateConfiguration(options);
  if (configurationError !== undefined) {
    return failure('INVALID_CONFIGURATION', configurationError);
  }
  const players: readonly GamePlayer[] = [...options.players]
    .sort((left, right) => left.seat - right.seat)
    .map((player) => ({
      id: player.id,
      seat: player.seat,
      name: player.name,
      kind: player.kind,
      alive: true,
      ...(player.ai === undefined ? {} : { ai: player.ai }),
    }));
  const initial: GameState = {
    version: 1,
    gameId: options.gameId,
    preset: options.preset,
    seed: options.seed,
    round: 0,
    phase: {
      id: '0:lobby:0',
      phase: 'lobby',
      eligibleActorIds: [],
      submissions: {},
    },
    players,
    night: {},
    resources: {
      witchHealAvailable: true,
      witchPoisonAvailable: true,
      seerChecks: {},
    },
    pendingDeaths: [],
    pendingDeathCauses: {},
    sequence: 0,
    eventLog: [],
  };
  return result(
    appendEvents(initial, [
      {
        kind: 'game.created',
        visibility: SERVER,
        payload: {
          options: {
            gameId: options.gameId,
            preset: options.preset,
            seed: options.seed,
            players: options.players,
          },
        },
      },
    ]),
  );
}

function validateAssignments(
  state: GameState,
  assignments: Readonly<Record<string, Role>>,
): string | undefined {
  if (Object.keys(assignments).length !== state.players.length) {
    return 'Every player must have exactly one role assignment.';
  }
  if (state.players.some((player) => assignments[player.id] === undefined)) {
    return 'A role assignment references a missing player.';
  }
  const expected = [...getPresetRoles(state.preset)].sort();
  const actual = Object.values(assignments).sort();
  if (expected.length !== actual.length || expected.some((role, index) => role !== actual[index])) {
    return 'Role assignments must exactly match the selected preset.';
  }
  return undefined;
}

export function startGame(state: GameState, options: StartGameOptions = {}): GameResult {
  if (state.phase.phase !== 'lobby') {
    return failure('GAME_ALREADY_STARTED', 'The game has already started.');
  }
  const assignment =
    options.roleAssignments ??
    Object.fromEntries(
      state.players.map((player, index) => [
        player.id,
        shuffleRoles(getPresetRoles(state.preset), state.seed)[index] as Role,
      ]),
    );
  const assignmentError = validateAssignments(state, assignment);
  if (assignmentError !== undefined) {
    return failure('INVALID_CONFIGURATION', assignmentError);
  }
  const started: GameState = {
    ...state,
    round: 1,
    players: state.players.map((player) => ({
      ...player,
      role: assignment[player.id] as Role,
    })),
  };
  const command = appendEvents(started, [
    {
      kind: 'game.started',
      visibility: SERVER,
      round: 1,
      payload: { roleAssignments: assignment },
    },
  ]);
  const changed = changePhase(command.state, 'role_reveal', sortedIds(command.state.players));
  return result(mergeEvents(command, changed));
}

function validateTargetAlive(state: GameState, targetId: string): boolean {
  return playerById(state, targetId)?.alive === true;
}

function validateAction(state: GameState, action: GameAction): GameResult<never> | undefined {
  if (state.phase.phase === 'ended') {
    return failure('GAME_ENDED', 'The game is already over.');
  }
  const expected = expectedActionType(state.phase.phase);
  if (expected === undefined || expected !== action.type) {
    return failure(
      'WRONG_PHASE',
      `Action ${action.type} is not allowed during ${state.phase.phase}.`,
    );
  }
  const actor = playerById(state, action.actorId);
  if (actor === undefined) {
    return failure('UNKNOWN_ACTOR', `Unknown player ${action.actorId}.`);
  }
  if (!state.phase.eligibleActorIds.includes(action.actorId)) {
    return failure('ACTOR_NOT_ELIGIBLE', 'This player is not eligible to act now.');
  }
  if (state.phase.submissions[action.actorId] !== undefined) {
    return failure('DUPLICATE_ACTION', 'This player has already acted in the current phase.');
  }

  switch (action.type) {
    case 'acknowledge_role':
    case 'finish_speech':
      return undefined;
    case 'guard': {
      if (actor.role !== 'guard') {
        return failure('ROLE_FORBIDDEN', 'Only the guard may guard a player.');
      }
      if (action.targetId === null) return undefined;
      if (!validateTargetAlive(state, action.targetId)) {
        return failure('INVALID_TARGET', 'The guard target must be alive.');
      }
      if (state.resources.guardLastTargetId === action.targetId) {
        return failure(
          'INVALID_TARGET',
          'The guard cannot protect the same player twice in a row.',
        );
      }
      return undefined;
    }
    case 'werewolf_vote': {
      if (actor.role !== 'werewolf') {
        return failure('ROLE_FORBIDDEN', 'Only a werewolf may submit a night vote.');
      }
      if (action.targetId === null) return undefined;
      const target = playerById(state, action.targetId);
      if (target?.alive !== true || target.role === 'werewolf') {
        return failure('INVALID_TARGET', 'Werewolves must target a living non-werewolf.');
      }
      return undefined;
    }
    case 'seer_check':
      if (actor.role !== 'seer') {
        return failure('ROLE_FORBIDDEN', 'Only the seer may inspect a player.');
      }
      if (action.targetId === action.actorId || !validateTargetAlive(state, action.targetId)) {
        return failure('INVALID_TARGET', 'The seer must inspect another living player.');
      }
      return undefined;
    case 'witch': {
      if (actor.role !== 'witch') {
        return failure('ROLE_FORBIDDEN', 'Only the witch may use potions.');
      }
      if (action.useHeal && action.poisonTargetId !== null) {
        return failure('INVALID_TARGET', 'The witch cannot use both potions in one night.');
      }
      if (action.useHeal) {
        if (!state.resources.witchHealAvailable || state.night.werewolfTargetId === undefined) {
          return failure('RESOURCE_UNAVAILABLE', 'The healing potion cannot be used now.');
        }
        if (state.night.werewolfTargetId === actor.id && state.round !== 1) {
          return failure('INVALID_TARGET', 'The witch may only save herself on the first night.');
        }
      }
      if (action.poisonTargetId !== null) {
        if (!state.resources.witchPoisonAvailable) {
          return failure('RESOURCE_UNAVAILABLE', 'The poison potion has already been used.');
        }
        if (
          action.poisonTargetId === actor.id ||
          !validateTargetAlive(state, action.poisonTargetId)
        ) {
          return failure('INVALID_TARGET', 'The witch must poison another living player.');
        }
      }
      return undefined;
    }
    case 'day_vote': {
      if (
        action.targetId !== null &&
        (!validateTargetAlive(state, action.targetId) ||
          action.targetId === actor.id ||
          (state.phase.candidates !== undefined &&
            !state.phase.candidates.includes(action.targetId)))
      ) {
        return failure('INVALID_TARGET', 'The vote target is not eligible.');
      }
      return undefined;
    }
    case 'hunter_shot':
      if (actor.role !== 'hunter') {
        return failure('ROLE_FORBIDDEN', 'Only the hunter may shoot.');
      }
      if (
        action.targetId !== null &&
        (action.targetId === actor.id || !validateTargetAlive(state, action.targetId))
      ) {
        return failure('INVALID_TARGET', 'The hunter must target another living player.');
      }
      return undefined;
  }
}

function plurality(targetIds: readonly (string | null)[]): {
  readonly winner?: string;
  readonly tied: readonly string[];
} {
  const counts = new Map<string, number>();
  for (const targetId of targetIds) {
    if (targetId !== null) counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  if (counts.size === 0) return { tied: [] };
  const maximum = Math.max(...counts.values());
  const tied = [...counts.entries()]
    .filter(([, count]) => count === maximum)
    .map(([targetId]) => targetId)
    .sort();
  return tied.length === 1 ? { winner: tied[0] as string, tied } : { tied };
}

function enterNight(
  state: GameState,
  from: 'guard' | 'werewolves' | 'seer' | 'witch',
): StateEvents {
  const order: readonly {
    readonly key: typeof from;
    readonly phase: GamePhase;
    readonly role: Role;
  }[] = [
    { key: 'guard', phase: 'night_guard', role: 'guard' },
    { key: 'werewolves', phase: 'night_werewolves', role: 'werewolf' },
    { key: 'seer', phase: 'night_seer', role: 'seer' },
    { key: 'witch', phase: 'night_witch', role: 'witch' },
  ];
  const start = order.findIndex((entry) => entry.key === from);
  for (let index = start; index < order.length; index += 1) {
    const entry = order[index];
    if (entry === undefined) continue;
    const actors = sortedIds(livingRole(state, entry.role));
    if (actors.length > 0) return changePhase(state, entry.phase, actors);
  }
  return resolveNight(state);
}

function applyDeaths(state: GameState, deaths: Readonly<Record<string, DeathCause>>): GameState {
  return {
    ...state,
    players: state.players.map((player) => {
      const cause = deaths[player.id];
      return cause === undefined
        ? player
        : { ...player, alive: false, death: { round: state.round, cause } };
    }),
    pendingDeaths: Object.keys(deaths),
    pendingDeathCauses: deaths,
  };
}

function resolveNight(state: GameState): StateEvents {
  const deaths: Record<string, DeathCause> = {};
  const victim = state.night.werewolfTargetId;
  if (victim !== undefined) {
    const guarded = state.night.guardedTargetId === victim;
    const healed = state.night.healedTargetId === victim;
    if ((!guarded && !healed) || (guarded && healed)) deaths[victim] = 'werewolves';
  }
  if (state.night.poisonedTargetId !== undefined) {
    deaths[state.night.poisonedTargetId] = 'witch_poison';
  }
  const resolved = applyDeaths(state, deaths);
  const nightEvent = appendEvents(resolved, [
    {
      kind: 'night.resolved',
      visibility: SERVER,
      payload: { deaths },
    },
  ]);
  const dawn = changePhase(nightEvent.state, 'dawn', []);
  return mergeEvents(nightEvent, dawn);
}

function winnerFor(state: GameState): Winner | undefined {
  const alive = livingPlayers(state);
  const wolves = alive.filter((player) => player.role === 'werewolf');
  if (wolves.length === 0) return 'good';
  const villagers = alive.filter((player) => player.role === 'villager');
  const gods = alive.filter((player) => player.role !== undefined && isGodRole(player.role));
  if (villagers.length === 0 || gods.length === 0) return 'werewolves';
  return undefined;
}

function endIfWon(state: GameState): StateEvents | undefined {
  const winner = winnerFor(state);
  if (winner === undefined) return undefined;
  const ended: GameState = { ...state, winner };
  const changed = changePhase(ended, 'ended', []);
  const event = appendEvents(changed.state, [
    {
      kind: 'game.ended',
      visibility: PUBLIC,
      phase: 'ended',
      payload: { winner },
    },
  ]);
  return mergeEvents(changed, event);
}

function hunterEligibleFromPending(state: GameState): readonly string[] {
  return state.pendingDeaths.filter((playerId) => {
    const player = playerById(state, playerId);
    return player?.role === 'hunter' && state.pendingDeathCauses[playerId] !== 'witch_poison';
  });
}

function enterLastWords(state: GameState, resumePhase: GamePhase): StateEvents {
  const queue = [...state.pendingDeaths];
  if (queue.length === 0) {
    return resumeAfterSpeeches(state, resumePhase);
  }
  return changePhase(state, 'last_words', [queue[0] as string], {
    speakerQueue: queue,
    resumePhase,
  });
}

function enterDiscussion(state: GameState): StateEvents {
  const queue = sortedIds(livingPlayers(state));
  if (queue.length === 0) return changePhase(state, 'voting', [], { voteRound: 1 });
  return changePhase(state, 'discussion', [queue[0] as string], {
    speakerQueue: queue,
  });
}

function resumeAfterSpeeches(state: GameState, resumePhase: GamePhase): StateEvents {
  if (resumePhase === 'discussion') {
    return enterDiscussion({ ...state, pendingDeaths: [], pendingDeathCauses: {} });
  }
  return changePhase({ ...state, pendingDeaths: [], pendingDeathCauses: {} }, 'resolution', []);
}

function enterVoting(
  state: GameState,
  voteRound: 1 | 2,
  candidates?: readonly string[],
): StateEvents {
  const voters = sortedIds(livingPlayers(state));
  return changePhase(state, 'voting', voters, {
    voteRound,
    ...(candidates === undefined ? {} : { candidates }),
  });
}

function resolveVote(state: GameState): StateEvents {
  const actions = Object.values(state.phase.submissions).filter(
    (action): action is Extract<GameAction, { type: 'day_vote' }> => action.type === 'day_vote',
  );
  const resolution = plurality(actions.map((action) => action.targetId));
  const voteRound = state.phase.voteRound ?? 1;
  const voteEvent = appendEvents(state, [
    {
      kind: 'vote.resolved',
      visibility: PUBLIC,
      payload: {
        voteRound,
        ...(resolution.winner === undefined ? {} : { eliminatedId: resolution.winner }),
        tiedIds: resolution.tied,
      },
    },
  ]);
  if (resolution.winner === undefined) {
    if (voteRound === 1 && resolution.tied.length > 1) {
      const runoff = enterVoting(voteEvent.state, 2, resolution.tied);
      return mergeEvents(voteEvent, runoff);
    }
    const resolutionPhase = changePhase(voteEvent.state, 'resolution', []);
    return mergeEvents(voteEvent, resolutionPhase);
  }

  const killed = applyDeaths(voteEvent.state, { [resolution.winner]: 'vote' });
  const deathEvent = appendEvents(killed, [
    {
      kind: 'player.died',
      visibility: PUBLIC,
      payload: { playerId: resolution.winner, cause: 'vote' },
    },
  ]);
  const hunterIds = hunterEligibleFromPending(deathEvent.state);
  if (hunterIds.length > 0) {
    const hunter = changePhase(deathEvent.state, 'hunter_shot', hunterIds, {
      resumePhase: 'resolution',
    });
    return mergeEvents(mergeEvents(voteEvent, deathEvent), hunter);
  }
  const won = endIfWon(deathEvent.state);
  if (won !== undefined) return mergeEvents(mergeEvents(voteEvent, deathEvent), won);
  const speeches = enterLastWords(deathEvent.state, 'resolution');
  return mergeEvents(mergeEvents(voteEvent, deathEvent), speeches);
}

function settleCompletedPhase(state: GameState): StateEvents {
  switch (state.phase.phase) {
    case 'role_reveal':
      return enterNight(state, 'guard');
    case 'night_guard':
      return enterNight(state, 'werewolves');
    case 'night_werewolves': {
      const actions = Object.values(state.phase.submissions).filter(
        (action): action is Extract<GameAction, { type: 'werewolf_vote' }> =>
          action.type === 'werewolf_vote',
      );
      const selected = plurality(actions.map((action) => action.targetId)).winner;
      const updated: GameState = {
        ...state,
        night:
          selected === undefined
            ? { ...state.night }
            : { ...state.night, werewolfTargetId: selected },
      };
      return enterNight(updated, 'seer');
    }
    case 'night_seer':
      return enterNight(state, 'witch');
    case 'night_witch':
      return resolveNight(state);
    case 'last_words':
    case 'discussion': {
      const queue = state.phase.speakerQueue?.slice(1) ?? [];
      if (queue.length > 0) {
        return changePhase(state, state.phase.phase, [queue[0] as string], {
          speakerQueue: queue,
          ...(state.phase.resumePhase === undefined
            ? {}
            : { resumePhase: state.phase.resumePhase }),
        });
      }
      if (state.phase.phase === 'discussion') return enterVoting(state, 1);
      return resumeAfterSpeeches(state, state.phase.resumePhase ?? 'resolution');
    }
    case 'voting':
      return resolveVote(state);
    case 'hunter_shot': {
      const action = Object.values(state.phase.submissions).find(
        (entry): entry is Extract<GameAction, { type: 'hunter_shot' }> =>
          entry.type === 'hunter_shot',
      );
      let afterShot = state;
      let shotEvent: StateEvents | undefined;
      if (action?.targetId !== null && action?.targetId !== undefined) {
        afterShot = applyDeaths(state, {
          ...state.pendingDeathCauses,
          [action.targetId]: 'hunter',
        });
        shotEvent = appendEvents(afterShot, [
          {
            kind: 'player.died',
            visibility: PUBLIC,
            payload: { playerId: action.targetId, cause: 'hunter' },
          },
        ]);
        afterShot = shotEvent.state;
      }
      const won = endIfWon(afterShot);
      if (won !== undefined) {
        return shotEvent === undefined ? won : mergeEvents(shotEvent, won);
      }
      const words = enterLastWords(afterShot, state.phase.resumePhase ?? 'resolution');
      return shotEvent === undefined ? words : mergeEvents(shotEvent, words);
    }
    default:
      return { state, events: [] };
  }
}

function isPhaseComplete(state: GameState): boolean {
  return (
    state.phase.eligibleActorIds.length > 0 &&
    state.phase.eligibleActorIds.every((actorId) => state.phase.submissions[actorId] !== undefined)
  );
}

function applyAcceptedAction(state: GameState, action: GameAction): StateEvents {
  let updated: GameState = {
    ...state,
    phase: {
      ...state.phase,
      submissions: { ...state.phase.submissions, [action.actorId]: action },
    },
  };
  const extraEvents: EventDraft[] = [];

  switch (action.type) {
    case 'guard':
      updated = {
        ...updated,
        night:
          action.targetId === null
            ? { ...updated.night }
            : { ...updated.night, guardedTargetId: action.targetId },
        resources:
          action.targetId === null
            ? {
                witchHealAvailable: updated.resources.witchHealAvailable,
                witchPoisonAvailable: updated.resources.witchPoisonAvailable,
                seerChecks: updated.resources.seerChecks,
              }
            : {
                ...updated.resources,
                guardLastTargetId: action.targetId,
              },
      };
      break;
    case 'seer_check': {
      const target = playerById(updated, action.targetId) as GamePlayer & { role: Role };
      const checks = updated.resources.seerChecks[action.actorId] ?? [];
      const check = {
        round: updated.round,
        targetId: target.id,
        alignment: getAlignment(target.role),
      };
      updated = {
        ...updated,
        resources: {
          ...updated.resources,
          seerChecks: {
            ...updated.resources.seerChecks,
            [action.actorId]: [...checks, check],
          },
        },
      };
      extraEvents.push({
        kind: 'seer.result',
        visibility: { kind: 'players', playerIds: [action.actorId] },
        payload: check,
      });
      break;
    }
    case 'witch':
      updated = {
        ...updated,
        night: {
          ...updated.night,
          ...(action.useHeal && updated.night.werewolfTargetId !== undefined
            ? { healedTargetId: updated.night.werewolfTargetId }
            : {}),
          ...(action.poisonTargetId === null ? {} : { poisonedTargetId: action.poisonTargetId }),
        },
        resources: {
          ...updated.resources,
          witchHealAvailable: action.useHeal ? false : updated.resources.witchHealAvailable,
          witchPoisonAvailable:
            action.poisonTargetId === null ? updated.resources.witchPoisonAvailable : false,
        },
      };
      break;
    default:
      break;
  }

  return appendEvents(updated, [
    {
      kind: 'action.accepted',
      visibility: SERVER,
      payload: { action },
    },
    ...extraEvents,
  ]);
}

export function submitAction(state: GameState, action: GameAction): GameResult {
  const invalid = validateAction(state, action);
  if (invalid !== undefined) return invalid;
  const accepted = applyAcceptedAction(state, action);
  if (!isPhaseComplete(accepted.state)) return result(accepted);
  const settled = settleCompletedPhase(accepted.state);
  return result(mergeEvents(accepted, settled));
}

function passiveAdvance(state: GameState): StateEvents {
  switch (state.phase.phase) {
    case 'dawn': {
      const revealed = appendEvents(state, [
        {
          kind: 'dawn.revealed',
          visibility: PUBLIC,
          payload: { deadPlayerIds: state.pendingDeaths },
        },
      ]);
      const hunterIds = hunterEligibleFromPending(revealed.state);
      if (hunterIds.length > 0) {
        const hunter = changePhase(revealed.state, 'hunter_shot', hunterIds, {
          resumePhase: 'discussion',
        });
        return mergeEvents(revealed, hunter);
      }
      const won = endIfWon(revealed.state);
      if (won !== undefined) return mergeEvents(revealed, won);
      const words = enterLastWords(revealed.state, 'discussion');
      return mergeEvents(revealed, words);
    }
    case 'resolution': {
      const won = endIfWon(state);
      if (won !== undefined) return won;
      const nextRound: GameState = {
        ...state,
        round: state.round + 1,
        night: {},
        pendingDeaths: [],
        pendingDeathCauses: {},
      };
      return enterNight(nextRound, 'guard');
    }
    default:
      return { state, events: [] };
  }
}

export function chooseFallbackAction(state: GameState, actorId: string): GameAction | undefined {
  if (
    !state.phase.eligibleActorIds.includes(actorId) ||
    state.phase.submissions[actorId] !== undefined
  ) {
    return undefined;
  }
  const actor = playerById(state, actorId);
  if (actor === undefined) return undefined;
  const bySeat = (ids: readonly string[]): string | undefined =>
    ids
      .map((id) => playerById(state, id))
      .filter((player): player is GamePlayer => player !== undefined)
      .sort((left, right) => left.seat - right.seat)[0]?.id;

  switch (state.phase.phase) {
    case 'role_reveal':
      return { type: 'acknowledge_role', actorId };
    case 'night_guard': {
      const targets = livingPlayers(state)
        .filter((player) => player.id !== state.resources.guardLastTargetId)
        .map((player) => player.id);
      return { type: 'guard', actorId, targetId: bySeat(targets) ?? null };
    }
    case 'night_werewolves': {
      const targets = livingPlayers(state)
        .filter((player) => player.role !== 'werewolf')
        .map((player) => player.id);
      return { type: 'werewolf_vote', actorId, targetId: bySeat(targets) ?? null };
    }
    case 'night_seer': {
      const targets = livingPlayers(state)
        .filter((player) => player.id !== actorId)
        .map((player) => player.id);
      const targetId = bySeat(targets);
      return targetId === undefined ? undefined : { type: 'seer_check', actorId, targetId };
    }
    case 'night_witch':
      return { type: 'witch', actorId, useHeal: false, poisonTargetId: null };
    case 'last_words':
    case 'discussion':
      return { type: 'finish_speech', actorId };
    case 'voting': {
      const targets = livingPlayers(state)
        .filter(
          (player) =>
            player.id !== actorId &&
            (state.phase.candidates === undefined || state.phase.candidates.includes(player.id)),
        )
        .map((player) => player.id);
      return { type: 'day_vote', actorId, targetId: bySeat(targets) ?? null };
    }
    case 'hunter_shot':
      return { type: 'hunter_shot', actorId, targetId: null };
    default:
      return undefined;
  }
}

export function advancePhase(state: GameState, reason: PhaseAdvanceReason = 'timeout'): GameResult {
  if (state.phase.phase === 'ended') {
    return failure('GAME_ENDED', 'The game is already over.');
  }
  const expected = expectedActionType(state.phase.phase);
  const marker = appendEvents(state, [
    {
      kind: 'phase.force_advanced',
      visibility: SERVER,
      payload: { reason, mode: expected === undefined ? 'passive' : 'fallbacks' },
    },
  ]);
  if (expected === undefined) {
    const advanced = passiveAdvance(marker.state);
    if (advanced.events.length === 0) {
      return failure('WRONG_PHASE', `Phase ${state.phase.phase} cannot be advanced.`);
    }
    return result(mergeEvents(marker, advanced));
  }

  let current = marker.state;
  let events = [...marker.events];
  const originalPhaseId = state.phase.id;
  while (current.phase.id === originalPhaseId) {
    const missing = current.phase.eligibleActorIds.find(
      (actorId) => current.phase.submissions[actorId] === undefined,
    );
    if (missing === undefined) break;
    const fallback = chooseFallbackAction(current, missing);
    if (fallback === undefined) {
      return failure('INVALID_CONFIGURATION', `No legal fallback exists for ${missing}.`);
    }
    const submitted = submitAction(current, fallback);
    if (!submitted.ok) return submitted;
    current = submitted.state;
    events = [...events, ...submitted.events];
  }
  return { ok: true, state: current, events };
}

export const resolvePhaseWithFallbacks = advancePhase;
