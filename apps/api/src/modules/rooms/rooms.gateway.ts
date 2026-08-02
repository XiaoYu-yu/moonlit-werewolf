import { UsePipes, ValidationPipe } from '@nestjs/common';
import { OBSERVER_PRIVATE_STATE_EVENT } from '@werewolf/contracts';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { SkipThrottle } from '@nestjs/throttler';
import type { Namespace, Socket } from 'socket.io';
import { parseCookie, PLAYER_COOKIE } from '../../common/http.js';
import {
  ChatEventDto,
  GameActionEventDto,
  HostControlEventDto,
  ReadyEventDto,
  RoomCodeDto,
} from './rooms.dto.js';
import { RoomRuntimeService } from './room-runtime.service.js';
import { RoomsService } from './rooms.service.js';

@WebSocketGateway({
  namespace: '/game',
  cors: {
    origin: (process.env.CORS_ORIGINS ?? process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(
      ',',
    ),
    credentials: true,
  },
  transports: ['websocket', 'polling'],
})
@SkipThrottle()
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class RoomsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  declare server: Namespace;

  readonly #socketTokens = new Map<string, string>();
  readonly #activeSocketIdsByToken = new Map<string, Set<string>>();
  readonly #eventWindows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly rooms: RoomsService,
    private readonly runtime: RoomRuntimeService,
  ) {}

  afterInit(server: Namespace): void {
    this.runtime.attachServer(server);
    this.runtime.attachPrivateStatePublisher((code) => this.publishPrivateStates(code));
  }

  handleConnection(socket: Socket): void {
    const authToken =
      typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : '';
    const cookieToken = parseCookie(socket.handshake.headers.cookie, PLAYER_COOKIE);
    const token = authToken || cookieToken;
    if (!token) return;
    this.#socketTokens.set(socket.id, token);
    const socketIds = this.#activeSocketIdsByToken.get(token) ?? new Set<string>();
    socketIds.add(socket.id);
    this.#activeSocketIdsByToken.set(token, socketIds);
  }

  handleDisconnect(socket: Socket): void {
    const token = this.#socketTokens.get(socket.id);
    this.#socketTokens.delete(socket.id);
    for (const key of this.#eventWindows.keys()) {
      if (key.startsWith(`${socket.id}:`)) this.#eventWindows.delete(key);
    }
    if (!token) return;
    const socketIds = this.#activeSocketIdsByToken.get(token);
    socketIds?.delete(socket.id);
    if (socketIds && socketIds.size > 0) return;
    this.#activeSocketIdsByToken.delete(token);
    const room = this.rooms.markDisconnected(token);
    if (room) this.runtime.publishSnapshot(room, 'presence.disconnected');
  }

  @SubscribeMessage('room.join')
  joinRoom(@ConnectedSocket() socket: Socket, @MessageBody() body: RoomCodeDto): { ok: true } {
    this.assertEventRate(socket, 'join', 30);
    const code = this.normalizeCode(body.code);
    const token = this.tokenFor(socket);
    const room = this.rooms.heartbeat(code, token);
    void socket.join(code);
    socket.emit('room.snapshot', room);
    if (this.rooms.isObserverSession(code, token)) {
      socket.emit(OBSERVER_PRIVATE_STATE_EVENT, this.rooms.getObserver(code, token));
    } else {
      socket.emit(
        'player.private_state',
        this.rooms.getPrivate(code, token) ?? { connected: true },
      );
    }
    return { ok: true };
  }

  @SubscribeMessage('seat.ready')
  setReady(@ConnectedSocket() socket: Socket, @MessageBody() envelope: ReadyEventDto) {
    this.assertEventRate(socket, 'ready', 60);
    const room = this.rooms.setReady(
      this.normalizeCode(envelope.code),
      this.tokenFor(socket),
      envelope.payload.ready,
    );
    this.runtime.publishSnapshot(room, 'seat.ready');
    return { ok: true, version: room.version };
  }

  @SubscribeMessage('presence.heartbeat')
  heartbeat(@ConnectedSocket() socket: Socket, @MessageBody() body: RoomCodeDto) {
    this.assertEventRate(socket, 'heartbeat', 120);
    const room = this.rooms.heartbeat(this.normalizeCode(body.code), this.tokenFor(socket));
    return { ok: true, version: room.version };
  }

  @SubscribeMessage('chat.send')
  chat(@ConnectedSocket() socket: Socket, @MessageBody() envelope: ChatEventDto) {
    this.assertEventRate(socket, 'chat', 30);
    const code = this.normalizeCode(envelope.code);
    const event = this.rooms.createChatEvent(code, this.tokenFor(socket), envelope.payload.message);
    this.server.to(code).emit('game.event', event);
    return { ok: true };
  }

  @SubscribeMessage('game.action.submit')
  submitAction(@ConnectedSocket() socket: Socket, @MessageBody() envelope: GameActionEventDto) {
    this.assertEventRate(socket, 'action', 60);
    const result = this.rooms.submitAction(
      this.normalizeCode(envelope.code),
      this.tokenFor(socket),
      envelope.payload,
    );
    if (!result.duplicate) {
      this.runtime.publishSnapshot(result.room, 'action.accepted');
    }
    return { ok: true, duplicate: result.duplicate };
  }

  @SubscribeMessage('host.control')
  hostControl(@ConnectedSocket() socket: Socket, @MessageBody() envelope: HostControlEventDto) {
    this.assertEventRate(socket, 'host', 30);
    const room = this.rooms.hostControl(
      this.normalizeCode(envelope.code),
      this.tokenFor(socket),
      envelope.payload.command,
    );
    this.runtime.publishSnapshot(room, `host.${envelope.payload.command}`);
    return { ok: true, version: room.version };
  }

  private tokenFor(socket: Socket): string {
    const token = this.#socketTokens.get(socket.id);
    if (!token) throw new WsException('Player session is required');
    return token;
  }

  private normalizeCode(code: unknown): string {
    if (typeof code !== 'string' || !/^[A-Z0-9_-]{4,12}$/i.test(code)) {
      throw new WsException('Invalid room code');
    }
    return code.toUpperCase();
  }

  private assertEventRate(socket: Socket, event: string, limit: number): void {
    const now = Date.now();
    const key = `${socket.id}:${event}`;
    const current = this.#eventWindows.get(key);
    const window =
      !current || now - current.startedAt >= 60_000 ? { startedAt: now, count: 0 } : current;
    if (window.count >= limit) throw new WsException('Too many realtime events');
    window.count += 1;
    this.#eventWindows.set(key, window);
  }

  private publishPrivateStates(
    code: string,
    observerOverride?: ReturnType<RoomsService['getObserver']>,
  ): void {
    for (const [socketId, token] of this.#socketTokens) {
      const socket = this.server.sockets.get(socketId);
      if (!socket?.rooms.has(code)) continue;
      try {
        if (this.rooms.isObserverSession(code, token)) {
          socket.emit(
            OBSERVER_PRIVATE_STATE_EVENT,
            observerOverride ?? this.rooms.getObserver(code, token),
          );
        } else {
          socket.emit(
            'player.private_state',
            this.rooms.getPrivate(code, token) ?? {
              connected: true,
            },
          );
        }
      } catch {
        // A stale socket/session must never receive another player's private view.
      }
    }
  }
}
