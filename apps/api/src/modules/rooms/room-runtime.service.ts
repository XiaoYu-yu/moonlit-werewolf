import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ObserverPrivateState } from '@werewolf/contracts';
import type { Namespace } from 'socket.io';
import { RoomsService, type RoomChange } from './rooms.service.js';
import type { PublicRoomState } from './rooms.types.js';

type PrivateStatePublisher = (code: string, observer?: ObserverPrivateState) => void;

const AI_STATUS_PUBLIC_FIELDS = [
  'turnId',
  'actorId',
  'seatNumber',
  'nickname',
  'providerId',
  'modelId',
  'phase',
  'round',
  'actionType',
  'status',
  'source',
  'startedAt',
  'updatedAt',
  'summaryReadyAt',
  'applyAt',
] as const;

function publicAiStatusPayload(
  payload: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  const safe: Record<string, unknown> = {};
  for (const field of AI_STATUS_PUBLIC_FIELDS) {
    const value = payload?.[field];
    if (value !== undefined) safe[field] = value;
  }
  return safe;
}

@Injectable()
export class RoomRuntimeService implements OnModuleInit, OnModuleDestroy {
  #timer?: NodeJS.Timeout;
  #server?: Namespace;
  #privateStatePublisher?: PrivateStatePublisher;
  readonly #lastPublishedPhase = new Map<string, PublicRoomState['phase']>();

  constructor(private readonly rooms: RoomsService) {}

  attachServer(server: Namespace): void {
    this.#server = server;
  }

  attachPrivateStatePublisher(publisher: PrivateStatePublisher): void {
    this.#privateStatePublisher = publisher;
  }

  publishSnapshot(
    room: PublicRoomState,
    event?: string,
    payload?: Readonly<Record<string, unknown>>,
    observer?: ObserverPrivateState,
  ): void {
    const previousPhase = this.#lastPublishedPhase.get(room.code);
    const isPublicHostPauseChange = event === 'host.pause' || event === 'host.resume';
    const repeatedPrivateNight =
      room.phase === 'night' && previousPhase === 'night' && !isPublicHostPauseChange;
    if (!repeatedPrivateNight) {
      this.#server?.to(room.code).emit('room.snapshot', room);
      this.#lastPublishedPhase.set(room.code, room.phase);
      if (event) {
        this.#server?.to(room.code).emit('game.event', {
          type: event,
          version: room.version,
          ...payload,
        });
      }
      this.emitPhaseTimer(room);
    }
    this.#privateStatePublisher?.(room.code, observer);
  }

  onModuleInit(): void {
    this.#timer = setInterval(() => {
      for (const change of this.rooms.tick()) {
        this.publishChange(change);
      }
      for (const timer of this.rooms.getPhaseTimers()) {
        this.#server?.to(timer.code).emit('phase.timer', timer);
      }
    }, 1_000);
    this.#timer.unref();
  }

  onModuleDestroy(): void {
    if (this.#timer) clearInterval(this.#timer);
  }

  private publishChange(change: RoomChange): void {
    if (change.event === 'ai.status') {
      // The authoritative observer snapshot is published first. The room-level
      // lifecycle event is metadata-only and never contains decision text.
      this.#privateStatePublisher?.(change.room.code, change.observer);
      this.#server?.to(change.room.code).emit('ai.status', {
        ...publicAiStatusPayload(change.payload),
        version: change.room.version,
      });
      return;
    }
    this.publishSnapshot(change.room, change.event, change.payload, change.observer);
  }

  private emitPhaseTimer(room: PublicRoomState): void {
    if (room.phaseEndsAt === undefined || room.isPaused || room.phase === 'night') return;
    this.#server?.to(room.code).emit('phase.timer', {
      code: room.code,
      phase: room.phase,
      phaseEndsAt: room.phaseEndsAt,
      serverNow: Date.now(),
      version: room.version,
    });
  }
}
