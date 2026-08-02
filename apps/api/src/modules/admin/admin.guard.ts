import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { isIP } from 'node:net';
import { safeEqualText } from '../../common/http.js';

const DEVELOPMENT_ADMIN_KEY = 'dev-admin-key';

function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (!remoteAddress) return false;
  if (remoteAddress === '::1') return true;

  const ipv4Address = remoteAddress.startsWith('::ffff:')
    ? remoteAddress.slice('::ffff:'.length)
    : remoteAddress;
  return isIP(ipv4Address) === 4 && ipv4Address.startsWith('127.');
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected =
      process.env.ADMIN_API_KEY ??
      (process.env.NODE_ENV === 'production' ? undefined : DEVELOPMENT_ADMIN_KEY);
    if (!expected) {
      throw new ServiceUnavailableException('Admin API is not configured');
    }
    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.header('x-admin-key') ?? '';
    if (!safeEqualText(supplied, expected)) {
      throw new UnauthorizedException('Invalid admin credentials');
    }
    if (expected === DEVELOPMENT_ADMIN_KEY && !isLoopbackAddress(request.socket.remoteAddress)) {
      throw new UnauthorizedException('Invalid admin credentials');
    }
    return true;
  }
}
