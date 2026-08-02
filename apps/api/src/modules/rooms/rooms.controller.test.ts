import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { PLAYER_COOKIE } from '../../common/http.js';
import { DEFAULT_ROOM_CREATE_RATE_LIMIT } from '../../common/runtime-config.js';
import type { RoomRuntimeService } from './room-runtime.service.js';
import { RoomsController } from './rooms.controller.js';
import type { RoomsService } from './rooms.service.js';

function publicRoom(overrides: Readonly<Record<string, unknown>> = {}) {
  return {
    id: 'room-id',
    code: 'ROOM01',
    mode: 'standard' as const,
    preset: 6 as const,
    status: 'lobby' as const,
    phase: 'lobby' as const,
    seats: [],
    version: 1,
    isPaused: false,
    ...overrides,
  };
}

describe('RoomsController realtime publication', () => {
  it('uses ROOM_CREATE_RATE_LIMIT for the create-room throttle metadata', () => {
    const limitResolver = Reflect.getMetadata(
      'THROTTLER:LIMITdefault',
      RoomsController.prototype.create,
    ) as (() => number) | undefined;

    expect(limitResolver).toBeTypeOf('function');
    expect(limitResolver?.()).toBe(DEFAULT_ROOM_CREATE_RATE_LIMIT);

    vi.stubEnv('ROOM_CREATE_RATE_LIMIT', '9');
    expect(limitResolver?.()).toBe(9);
    vi.unstubAllEnvs();
  });

  it('broadcasts REST joins, AI-seat changes, and game starts to connected clients', () => {
    const joinedRoom = publicRoom({ version: 2 });
    const configuredRoom = publicRoom({ version: 3 });
    const startedRoom = publicRoom({
      status: 'playing',
      phase: 'role_reveal',
      version: 4,
    });
    const rooms = {
      join: vi.fn(() => ({
        room: joinedRoom,
        session: { token: 'joined-token' },
      })),
      configureAi: vi.fn(() => configuredRoom),
      start: vi.fn(() => startedRoom),
    };
    const runtime = {
      publishSnapshot: vi.fn(),
    };
    const controller = new RoomsController(
      rooms as unknown as RoomsService,
      runtime as unknown as RoomRuntimeService,
    );
    const response = {
      cookie: vi.fn(),
    } as unknown as Response;
    const request = {
      header: vi.fn((name: string) =>
        name.toLowerCase() === 'cookie' ? `${PLAYER_COOKIE}=host-token` : undefined,
      ),
    } as unknown as Request;

    expect(controller.join('room01', { nickname: '新玩家' }, response)).toEqual({
      room: joinedRoom,
    });
    expect(controller.configureAi('room-id', { seats: [] }, request)).toBe(configuredRoom);
    expect(controller.start('room-id', request)).toBe(startedRoom);

    expect(runtime.publishSnapshot).toHaveBeenNthCalledWith(1, joinedRoom, 'room.player_joined');
    expect(runtime.publishSnapshot).toHaveBeenNthCalledWith(
      2,
      configuredRoom,
      'room.ai_seats_updated',
    );
    expect(runtime.publishSnapshot).toHaveBeenNthCalledWith(3, startedRoom, 'game.started');
  });

  it('creates and bootstraps an authenticated AI observer room', () => {
    const room = publicRoom({
      mode: 'ai_observer',
      status: 'playing',
      phase: 'role_reveal',
    });
    const observer = {
      connected: true as const,
      isObserver: true as const,
      roomId: room.id,
      gameId: 'game-id',
      mode: 'ai_observer' as const,
      round: 1,
      phase: 'role_reveal' as const,
      phaseId: 'phase-1',
      currentActorIds: [],
      roles: [],
      actions: [],
      chatHistory: [],
    };
    const rooms = {
      createAiObserver: vi.fn(() => ({
        room,
        observer,
        session: { token: 'observer-token' },
      })),
      getObserver: vi.fn(() => observer),
    };
    const runtime = { publishSnapshot: vi.fn() };
    const controller = new RoomsController(
      rooms as unknown as RoomsService,
      runtime as unknown as RoomRuntimeService,
    );
    const response = { cookie: vi.fn() } as unknown as Response;
    const request = {
      header: vi.fn((name: string) =>
        name.toLowerCase() === 'cookie' ? `${PLAYER_COOKIE}=observer-token` : undefined,
      ),
    } as unknown as Request;
    const dto = {
      inviteCode: 'MOONLIT-TEST',
      preset: 6 as const,
      lineup: Array.from({ length: 6 }, (_, index) => ({
        seatNumber: index + 1,
        providerId: index % 2 === 0 ? ('kimi' as const) : ('deepseek' as const),
        personality: 'logical' as const,
      })),
    };

    expect(controller.createAiObserver(dto, response)).toEqual({ room, observer });
    expect(response.cookie).toHaveBeenCalledWith(
      PLAYER_COOKIE,
      'observer-token',
      expect.objectContaining({ httpOnly: true, path: '/' }),
    );
    expect(runtime.publishSnapshot).toHaveBeenCalledWith(room, 'game.started', undefined, observer);
    expect(controller.observer('room01', request)).toBe(observer);
    expect(rooms.getObserver).toHaveBeenCalledWith('ROOM01', 'observer-token');
  });
});
