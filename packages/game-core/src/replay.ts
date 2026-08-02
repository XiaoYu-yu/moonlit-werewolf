import type {
  CreateGameOptions,
  GameAction,
  GameEvent,
  GameResult,
  GameState,
  Role,
} from '@werewolf/contracts';

import { advancePhase, createGame, startGame, submitAction } from './engine.js';
import { failure } from './errors.js';

function asRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

export function replayGame(eventLog: readonly GameEvent[]): GameResult {
  const created = eventLog.find((event) => event.kind === 'game.created');
  const options = asRecord(created?.payload.options) as CreateGameOptions | undefined;
  if (options === undefined) {
    return failure('INVALID_EVENT_LOG', 'The event log does not contain game creation options.');
  }
  const initial = createGame(options);
  if (!initial.ok) return initial;
  let state: GameState = initial.state;

  for (const event of eventLog) {
    if (event.kind === 'game.started') {
      const assignments = asRecord(event.payload.roleAssignments) as
        Readonly<Record<string, Role>> | undefined;
      if (assignments === undefined) {
        return failure('INVALID_EVENT_LOG', 'The start event has no role assignments.');
      }
      const next = startGame(state, { roleAssignments: assignments });
      if (!next.ok) return failure('INVALID_EVENT_LOG', next.error.message);
      state = next.state;
    } else if (event.kind === 'action.accepted') {
      const action = asRecord(event.payload.action) as GameAction | undefined;
      if (action === undefined) {
        return failure('INVALID_EVENT_LOG', 'An accepted action event is malformed.');
      }
      const next = submitAction(state, action);
      if (!next.ok) return failure('INVALID_EVENT_LOG', next.error.message);
      state = next.state;
    } else if (event.kind === 'phase.force_advanced' && event.payload.mode === 'passive') {
      const next = advancePhase(state, 'timeout');
      if (!next.ok) return failure('INVALID_EVENT_LOG', next.error.message);
      state = next.state;
    }
  }
  const finalPhaseChange = [...eventLog].reverse().find((event) => event.kind === 'phase.changed');
  const phaseId =
    typeof finalPhaseChange?.payload.phaseId === 'string'
      ? finalPhaseChange.payload.phaseId
      : state.phase.id;
  const canonical: GameState = {
    ...state,
    phase: { ...state.phase, id: phaseId },
    sequence: eventLog.at(-1)?.sequence ?? 0,
    eventLog: [...eventLog],
  };
  return { ok: true, state: canonical, events: canonical.eventLog };
}
