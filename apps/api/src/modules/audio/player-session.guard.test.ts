import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { RoomsService } from '../rooms/rooms.service.js';
import { PlayerSessionGuard } from './player-session.guard.js';

function contextWithHeaders(headers: Readonly<Record<string, string>>): ExecutionContext {
  const request = {
    header: (name: string) => headers[name.toLowerCase()],
  } as Request;
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}

describe('PlayerSessionGuard', () => {
  it('authenticates the HttpOnly player cookie through RoomsService', () => {
    const assertPlayerSession = vi.fn();
    const guard = new PlayerSessionGuard({
      assertPlayerSession,
    } as unknown as RoomsService);

    expect(
      guard.canActivate(contextWithHeaders({ cookie: 'other=x; ww_session=valid%2Dtoken' })),
    ).toBe(true);
    expect(assertPlayerSession).toHaveBeenCalledWith('valid-token');
  });

  it('does not accept the legacy player token header in place of the cookie', () => {
    const assertPlayerSession = vi.fn((token: string | undefined) => {
      if (!token) throw new ForbiddenException('Invalid player session');
    });
    const guard = new PlayerSessionGuard({
      assertPlayerSession,
    } as unknown as RoomsService);

    expect(() =>
      guard.canActivate(contextWithHeaders({ 'x-player-token': 'header-token' })),
    ).toThrow(ForbiddenException);
    expect(assertPlayerSession).toHaveBeenCalledWith(undefined);
  });
});
