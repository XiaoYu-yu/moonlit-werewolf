import { Body, Controller, Get, Param, Post, Put, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { PLAYER_COOKIE, playerTokenFromRequest } from '../../common/http.js';
import { readRoomCreateRateLimit } from '../../common/runtime-config.js';
import { RoomRuntimeService } from './room-runtime.service.js';
import {
  ConfigureAiSeatsDto,
  CreateAiObserverRoomDto,
  CreateRoomDto,
  JoinRoomDto,
} from './rooms.dto.js';
import { RoomsService } from './rooms.service.js';

@Controller('rooms')
export class RoomsController {
  constructor(
    private readonly rooms: RoomsService,
    private readonly runtime: RoomRuntimeService,
  ) {}

  @Post()
  @Throttle({ default: { limit: () => readRoomCreateRateLimit(), ttl: 60_000 } })
  create(@Body() dto: CreateRoomDto, @Res({ passthrough: true }) response: Response) {
    const result = this.rooms.create(dto.inviteCode, dto.preset, dto.nickname);
    this.setSessionCookie(response, result.session.token);
    return { room: result.room };
  }

  @Post('ai-observer')
  @Throttle({ default: { limit: () => readRoomCreateRateLimit(), ttl: 60_000 } })
  createAiObserver(
    @Body() dto: CreateAiObserverRoomDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = this.rooms.createAiObserver(dto.inviteCode, dto.preset, dto.lineup);
    this.setSessionCookie(response, result.session.token);
    this.runtime.publishSnapshot(result.room, 'game.started', undefined, result.observer);
    return { room: result.room, observer: result.observer };
  }

  @Post(':code/join')
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  join(
    @Param('code') code: string,
    @Body() dto: JoinRoomDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = this.rooms.join(code.toUpperCase(), dto.nickname);
    this.setSessionCookie(response, result.session.token);
    this.runtime.publishSnapshot(result.room, 'room.player_joined');
    return { room: result.room };
  }

  @Put(':id/ai-seats')
  configureAi(@Param('id') id: string, @Body() dto: ConfigureAiSeatsDto, @Req() request: Request) {
    const room = this.rooms.configureAi(id, playerTokenFromRequest(request), dto.seats);
    this.runtime.publishSnapshot(room, 'room.ai_seats_updated');
    return room;
  }

  @Post(':id/start')
  start(@Param('id') id: string, @Req() request: Request) {
    const room = this.rooms.start(id, playerTokenFromRequest(request));
    this.runtime.publishSnapshot(room, 'game.started');
    return room;
  }

  @Get(':code/observer')
  observer(@Param('code') code: string, @Req() request: Request) {
    return this.rooms.getObserver(code.toUpperCase(), playerTokenFromRequest(request));
  }

  private setSessionCookie(response: Response, token: string): void {
    response.cookie(PLAYER_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1_000,
      path: '/',
    });
  }
}
