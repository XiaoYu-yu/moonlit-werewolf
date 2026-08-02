import type { Namespace, Socket } from 'socket.io';
import { describe, expect, it, vi } from 'vitest';
import { PLAYER_COOKIE } from '../../common/http.js';
import { AdminService } from '../admin/admin.service.js';
import { RoomRuntimeService } from './room-runtime.service.js';
import { RoomsGateway } from './rooms.gateway.js';
import { RoomsService } from './rooms.service.js';

interface TestSocket {
  readonly id: string;
  readonly handshake: {
    readonly auth: Record<string, unknown>;
    readonly headers: { readonly cookie: string };
  };
  readonly rooms: Set<string>;
  readonly emit: ReturnType<typeof vi.fn>;
}

describe('RoomsGateway private-state publishing', () => {
  it('keeps a player online until the last socket for the same session disconnects', () => {
    const admin = new AdminService();
    const invite = admin.createInvite({ label: 'presence-test', maxUses: 1 });
    const rooms = new RoomsService(admin);
    const created = rooms.create(invite.code, 6, '多端玩家');
    const namespaceEmit = vi.fn();
    const sockets = new Map<string, TestSocket>();
    const namespace = {
      sockets,
      to: vi.fn(() => ({ emit: namespaceEmit })),
    } as unknown as Namespace;
    const runtime = new RoomRuntimeService(rooms);
    const gateway = new RoomsGateway(rooms, runtime);
    gateway.server = namespace;
    gateway.afterInit(namespace);

    const makeSocket = (id: string): TestSocket => ({
      id,
      handshake: {
        auth: {},
        headers: { cookie: `${PLAYER_COOKIE}=${created.session.token}` },
      },
      rooms: new Set([created.room.code]),
      emit: vi.fn(),
    });
    const first = makeSocket('socket-first-tab');
    const second = makeSocket('socket-second-tab');
    sockets.set(first.id, first);
    sockets.set(second.id, second);
    gateway.handleConnection(first as unknown as Socket);
    gateway.handleConnection(second as unknown as Socket);

    gateway.handleDisconnect(first as unknown as Socket);
    expect(rooms.getPublic(created.room.code).seats[0]?.connected).toBe(true);
    expect(namespaceEmit).not.toHaveBeenCalled();

    gateway.handleDisconnect(second as unknown as Socket);
    expect(rooms.getPublic(created.room.code).seats[0]?.connected).toBe(false);
    expect(
      namespaceEmit.mock.calls.some(
        ([eventName, payload]) =>
          eventName === 'game.event' && payload?.type === 'presence.disconnected',
      ),
    ).toBe(true);
  });

  it('refreshes each socket with only its own private state and emits a phase timer', () => {
    const admin = new AdminService();
    const invite = admin.createInvite({ label: 'gateway-test', maxUses: 10 });
    const rooms = new RoomsService(admin);
    const created = rooms.create(invite.code, 6, '房主');
    const participants = [
      created,
      ...['二号', '三号', '四号', '五号', '六号'].map((nickname) =>
        rooms.join(created.room.code, nickname),
      ),
    ];
    for (const participant of participants) {
      rooms.setReady(created.room.code, participant.session.token, true);
    }
    const started = rooms.start(created.room.id, created.session.token);

    const namespaceEmit = vi.fn();
    const sockets = new Map<string, TestSocket>();
    const namespace = {
      sockets,
      to: vi.fn(() => ({ emit: namespaceEmit })),
    } as unknown as Namespace;
    const runtime = new RoomRuntimeService(rooms);
    const gateway = new RoomsGateway(rooms, runtime);
    gateway.server = namespace;
    gateway.afterInit(namespace);

    for (const participant of participants) {
      const socket: TestSocket = {
        id: `socket-${participant.session.seatId}`,
        handshake: {
          auth: {},
          headers: {
            cookie: `${PLAYER_COOKIE}=${participant.session.token}`,
          },
        },
        rooms: new Set([created.room.code]),
        emit: vi.fn(),
      };
      sockets.set(socket.id, socket);
      gateway.handleConnection(socket as unknown as Socket);
    }

    runtime.publishSnapshot(started, 'game.started');
    for (const participant of participants) {
      const socket = sockets.get(`socket-${participant.session.seatId}`);
      const privateCall = socket?.emit.mock.calls.find(
        ([eventName]) => eventName === 'player.private_state',
      );
      expect(privateCall?.[1]?.playerId).toBe(participant.session.seatId);
    }
    expect(namespaceEmit.mock.calls.some(([eventName]) => eventName === 'phase.timer')).toBe(true);
  });

  it('suppresses repeated public snapshots inside secret night sub-phases', () => {
    const admin = new AdminService();
    const invite = admin.createInvite({ label: 'night-test', maxUses: 2 });
    const rooms = new RoomsService(admin);
    const created = rooms.create(invite.code, 6, '房主');
    rooms.configureAi(
      created.room.id,
      created.session.token,
      [2, 3, 4, 5, 6].map((seatNumber) => ({
        seatNumber,
        modelId: 'model',
        providerId: 'deepseek',
        personality: 'logical' as const,
      })),
    );
    rooms.setReady(created.room.code, created.session.token, true);
    const started = rooms.start(created.room.id, created.session.token);

    const namespaceEmit = vi.fn();
    const namespace = {
      sockets: new Map(),
      to: vi.fn(() => ({ emit: namespaceEmit })),
    } as unknown as Namespace;
    const runtime = new RoomRuntimeService(rooms);
    runtime.attachServer(namespace);
    runtime.publishSnapshot(started);

    const wolves = rooms.hostControl(created.room.code, created.session.token, 'advance');
    runtime.publishSnapshot(wolves);
    const snapshotsAfterEnteringNight = namespaceEmit.mock.calls.filter(
      ([eventName]) => eventName === 'room.snapshot',
    ).length;

    const seer = rooms.hostControl(created.room.code, created.session.token, 'advance');
    runtime.publishSnapshot(seer);
    const snapshotsAfterSecretTransition = namespaceEmit.mock.calls.filter(
      ([eventName]) => eventName === 'room.snapshot',
    ).length;
    expect(snapshotsAfterSecretTransition).toBe(snapshotsAfterEnteringNight);
    expect(namespaceEmit.mock.calls.some(([eventName]) => eventName === 'phase.timer')).toBe(true);
    expect(
      namespaceEmit.mock.calls
        .filter(([eventName]) => eventName === 'phase.timer')
        .every(([, payload]) => payload.phase !== 'night'),
    ).toBe(true);
  });

  it('publishes pause and resume state during a secret night phase', () => {
    const admin = new AdminService();
    const invite = admin.createInvite({ label: 'night-pause-test', maxUses: 1 });
    const rooms = new RoomsService(admin);
    const created = rooms.create(invite.code, 6, '房主');
    rooms.configureAi(
      created.room.id,
      created.session.token,
      [2, 3, 4, 5, 6].map((seatNumber) => ({
        seatNumber,
        modelId: 'model',
        providerId: 'deepseek',
        personality: 'logical' as const,
      })),
    );
    rooms.setReady(created.room.code, created.session.token, true);
    const started = rooms.start(created.room.id, created.session.token);

    const namespaceEmit = vi.fn();
    const namespace = {
      sockets: new Map(),
      to: vi.fn(() => ({ emit: namespaceEmit })),
    } as unknown as Namespace;
    const runtime = new RoomRuntimeService(rooms);
    runtime.attachServer(namespace);
    runtime.publishSnapshot(started, 'game.started');

    const night = rooms.hostControl(created.room.code, created.session.token, 'advance');
    runtime.publishSnapshot(night);
    namespaceEmit.mockClear();

    const paused = rooms.hostControl(created.room.code, created.session.token, 'pause');
    runtime.publishSnapshot(paused, 'host.pause');
    expect(
      namespaceEmit.mock.calls.some(
        ([eventName, payload]) => eventName === 'room.snapshot' && payload.isPaused === true,
      ),
    ).toBe(true);

    namespaceEmit.mockClear();
    const resumed = rooms.hostControl(created.room.code, created.session.token, 'resume');
    runtime.publishSnapshot(resumed, 'host.resume');
    expect(
      namespaceEmit.mock.calls.some(
        ([eventName, payload]) => eventName === 'room.snapshot' && payload.isPaused === false,
      ),
    ).toBe(true);
  });

  it('emits omniscient state only on the dedicated observer channel', () => {
    const admin = new AdminService();
    const invite = admin.createInvite({ label: 'observer-gateway', maxUses: 1 });
    const rooms = new RoomsService(admin);
    const created = rooms.createAiObserver(
      invite.code,
      6,
      Array.from({ length: 6 }, (_, index) => ({
        seatNumber: index + 1,
        providerId: index % 2 === 0 ? ('kimi' as const) : ('deepseek' as const),
        personality: 'logical' as const,
      })),
    );
    const socketRooms = new Set<string>();
    const socket = {
      id: 'observer-socket',
      handshake: {
        auth: {},
        headers: { cookie: `${PLAYER_COOKIE}=${created.session.token}` },
      },
      rooms: socketRooms,
      emit: vi.fn(),
      join: vi.fn((code: string) => {
        socketRooms.add(code);
      }),
    };
    const namespace = {
      sockets: new Map([[socket.id, socket]]),
      to: vi.fn(() => ({ emit: vi.fn() })),
    } as unknown as Namespace;
    const runtime = new RoomRuntimeService(rooms);
    const gateway = new RoomsGateway(rooms, runtime);
    gateway.server = namespace;
    gateway.afterInit(namespace);
    gateway.handleConnection(socket as unknown as Socket);

    expect(gateway.joinRoom(socket as unknown as Socket, { code: created.room.code })).toEqual({
      ok: true,
    });
    const observerCall = socket.emit.mock.calls.find(
      ([eventName]) => eventName === 'observer.private_state',
    );
    expect(observerCall?.[1]).toMatchObject({
      isObserver: true,
      mode: 'ai_observer',
      roomId: created.room.id,
    });
    expect(observerCall?.[1]?.roles).toHaveLength(6);
    expect(socket.emit.mock.calls.some(([eventName]) => eventName === 'player.private_state')).toBe(
      false,
    );

    socket.emit.mockClear();
    runtime.publishSnapshot(created.room, 'ai.action', undefined, created.observer);
    expect(
      socket.emit.mock.calls.some(
        ([eventName, payload]) =>
          eventName === 'observer.private_state' && payload.roomId === created.room.id,
      ),
    ).toBe(true);
  });

  it('whitelists room-level AI lifecycle metadata and never broadcasts summary text', () => {
    const admin = new AdminService();
    const invite = admin.createInvite({ label: 'status-privacy', maxUses: 1 });
    const rooms = new RoomsService(admin);
    const created = rooms.createAiObserver(
      invite.code,
      6,
      Array.from({ length: 6 }, (_, index) => ({
        seatNumber: index + 1,
        providerId: 'kimi' as const,
        personality: 'logical' as const,
      })),
    );
    const namespaceEmit = vi.fn();
    const namespace = {
      sockets: new Map(),
      to: vi.fn(() => ({ emit: namespaceEmit })),
    } as unknown as Namespace;
    const runtime = new RoomRuntimeService(rooms);
    runtime.attachServer(namespace);

    (
      runtime as unknown as {
        publishChange(change: {
          room: typeof created.room;
          event: string;
          payload: Readonly<Record<string, unknown>>;
          observer: typeof created.observer;
        }): void;
      }
    ).publishChange({
      room: created.room,
      event: 'ai.status',
      payload: {
        turnId: 'turn-1',
        actorId: created.room.seats[0]?.id,
        status: 'summary_ready',
        decisionSummary: '绝不能广播的私密摘要',
        content: '绝不能广播的私密正文',
      },
      observer: created.observer,
    });

    const status = namespaceEmit.mock.calls.find(([eventName]) => eventName === 'ai.status')?.[1];
    expect(status).toMatchObject({
      turnId: 'turn-1',
      actorId: created.room.seats[0]?.id,
      status: 'summary_ready',
    });
    expect(JSON.stringify(status)).not.toMatch(/私密摘要|私密正文|decisionSummary|content/);
    expect(namespaceEmit.mock.calls.some(([eventName]) => eventName === 'game.event')).toBe(false);
  });
});
