import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

export const PLAYER_COOKIE = 'ww_session';

export function parseCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

export function playerTokenFromRequest(request: Request): string | undefined {
  const header = request.header('x-player-token');
  return header || parseCookie(request.header('cookie'), PLAYER_COOKIE);
}

export function playerCookieTokenFromRequest(request: Request): string | undefined {
  return parseCookie(request.header('cookie'), PLAYER_COOKIE);
}

export function safeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}
