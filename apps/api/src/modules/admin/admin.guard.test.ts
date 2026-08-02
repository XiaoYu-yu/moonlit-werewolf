import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdminGuard } from './admin.guard.js';

function requestContext(remoteAddress: string | undefined, suppliedKey: string): ExecutionContext {
  const request = {
    header: vi.fn((name: string) => (name === 'x-admin-key' ? suppliedKey : undefined)),
    socket: { remoteAddress },
  } as unknown as Request;

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard development key network boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(['127.0.0.1', '127.8.4.2', '::1', '::ffff:127.0.0.1'])(
    'allows the default development key from loopback %s',
    (remoteAddress) => {
      vi.stubEnv('NODE_ENV', 'development');

      expect(new AdminGuard().canActivate(requestContext(remoteAddress, 'dev-admin-key'))).toBe(
        true,
      );
    },
  );

  it.each(['192.168.1.20', '10.0.0.8', '::ffff:192.168.1.20', undefined])(
    'rejects the default development key from non-loopback %s',
    (remoteAddress) => {
      vi.stubEnv('NODE_ENV', 'development');

      expect(() =>
        new AdminGuard().canActivate(requestContext(remoteAddress, 'dev-admin-key')),
      ).toThrow(UnauthorizedException);
    },
  );

  it('also restricts an explicitly configured public development key to loopback', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ADMIN_API_KEY', 'dev-admin-key');

    expect(() =>
      new AdminGuard().canActivate(requestContext('192.168.1.20', 'dev-admin-key')),
    ).toThrow(UnauthorizedException);
  });

  it('continues to allow a custom administrator key from a non-loopback peer', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('ADMIN_API_KEY', 'local-custom-admin-secret');

    expect(
      new AdminGuard().canActivate(requestContext('192.168.1.20', 'local-custom-admin-secret')),
    ).toBe(true);
  });
});
