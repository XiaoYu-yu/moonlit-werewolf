import type { GameErrorCode, GameResult } from '@werewolf/contracts';

export function failure(code: GameErrorCode, message: string): GameResult<never> {
  return { ok: false, error: { code, message } };
}
