import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { playerCookieTokenFromRequest } from '../../common/http.js';
import { RoomsService } from '../rooms/rooms.service.js';

@Injectable()
export class PlayerSessionGuard implements CanActivate {
  constructor(private readonly rooms: RoomsService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.rooms.assertPlayerSession(playerCookieTokenFromRequest(request));
    return true;
  }
}
