import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import {
  AI_TURN_JOB_NAME,
  AI_TURN_QUEUE_NAME,
  fallbackAiTurnResult,
  isAiTurnJobResult,
  type AiTurnJobData,
  type AiTurnJobResult,
} from '@werewolf/ai-gateway';
import { Queue, QueueEvents } from 'bullmq';
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  readAiQueueConnectTimeoutMs,
  readAiQueueResultTimeoutMs,
} from '../../common/runtime-config.js';
import { AdminService } from '../admin/admin.service.js';

const RETRY_COOLDOWN_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

@Injectable()
export class AiTurnQueueService implements OnModuleDestroy {
  readonly #redisUrl = process.env.REDIS_URL?.trim();
  readonly #connectTimeoutMs = readAiQueueConnectTimeoutMs();
  readonly #resultTimeoutMs = readAiQueueResultTimeoutMs();

  #producerConnection: Redis | undefined;
  #eventsConnection: Redis | undefined;
  #queue: Queue<AiTurnJobData, AiTurnJobResult, string> | undefined;
  #events: QueueEvents | undefined;
  #ready: Promise<boolean> | undefined;
  #retryAfter = 0;
  #closed = false;
  #lastWarningAt = 0;

  constructor(@Optional() private readonly admin?: AdminService) {}

  async execute(data: AiTurnJobData): Promise<AiTurnJobResult> {
    if (!this.#redisUrl) {
      return this.executeDirectOrFallback(data, 'AI queue is disabled because REDIS_URL is unset');
    }
    if (!(await this.ensureReady()) || !this.#queue || !this.#events) {
      return this.executeDirectOrFallback(data, 'AI queue is temporarily unavailable');
    }

    try {
      const jobId = createHash('sha256')
        .update(
          `${data.roomId}|${data.matchId}|${data.actorSeatId}|${JSON.stringify(data.request)}`,
        )
        .digest('hex');
      const job = await withTimeout(
        this.#queue.add(AI_TURN_JOB_NAME, data, {
          jobId,
          attempts: 1,
          removeOnComplete: { age: 60 * 60, count: 5_000 },
          removeOnFail: { age: 24 * 60 * 60, count: 5_000 },
        }),
        this.#connectTimeoutMs,
        'AI queue enqueue',
      );
      const result = await job.waitUntilFinished(this.#events, this.#resultTimeoutMs);
      if (
        !isAiTurnJobResult(
          result,
          data.actionType,
          data.allowedSeatIds ?? [],
          data.requireDecisionSummary ?? false,
          data.requireVisibleAnalysis ?? false,
        )
      ) {
        return fallbackAiTurnResult(data.fallbackAction, 'AI worker returned an invalid action');
      }
      await this.admin?.recordAiTurnResult(result);
      return result;
    } catch (error) {
      this.warnOnce('ai.queue.fallback', error);
      return fallbackAiTurnResult(
        data.fallbackAction,
        error instanceof Error ? `AI queue failed: ${error.message}` : 'AI queue failed',
      );
    }
  }

  private async executeDirectOrFallback(
    data: AiTurnJobData,
    fallbackReason: string,
  ): Promise<AiTurnJobResult> {
    if (!this.admin) return fallbackAiTurnResult(data.fallbackAction, fallbackReason);
    try {
      return await this.admin.executeAiTurnDirect(data);
    } catch (error) {
      return fallbackAiTurnResult(
        data.fallbackAction,
        error instanceof Error
          ? `Direct AI provider failed: ${error.message}`
          : 'Direct AI provider failed',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.#closed = true;
    await this.dispose();
  }

  private async ensureReady(): Promise<boolean> {
    if (this.#closed || !this.#redisUrl || Date.now() < this.#retryAfter) return false;
    if (!this.#ready) {
      this.#ready = this.initialize().then(async (ready) => {
        if (!ready) {
          this.#retryAfter = Date.now() + RETRY_COOLDOWN_MS;
          await this.dispose();
          this.#ready = undefined;
        }
        return ready;
      });
    }
    return this.#ready;
  }

  private async initialize(): Promise<boolean> {
    try {
      const producer = new Redis(this.#redisUrl as string, {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        connectTimeout: this.#connectTimeoutMs,
      });
      producer.on('error', (error) => this.warnOnce('ai.queue.redis_error', error));
      this.#producerConnection = producer;
      await withTimeout(producer.connect(), this.#connectTimeoutMs, 'Redis connection');
      await withTimeout(producer.ping(), this.#connectTimeoutMs, 'Redis ping');

      const eventsConnection = new Redis(this.#redisUrl as string, {
        lazyConnect: true,
        maxRetriesPerRequest: null,
        connectTimeout: this.#connectTimeoutMs,
      });
      eventsConnection.on('error', (error) => this.warnOnce('ai.queue.events_redis_error', error));
      this.#eventsConnection = eventsConnection;

      const queue = new Queue<AiTurnJobData, AiTurnJobResult, string>(AI_TURN_QUEUE_NAME, {
        connection: producer,
      });
      const events = new QueueEvents(AI_TURN_QUEUE_NAME, { connection: eventsConnection });
      queue.on('error', (error) => this.warnOnce('ai.queue.error', error));
      events.on('error', (error) => this.warnOnce('ai.queue.events_error', error));
      this.#queue = queue;
      this.#events = events;
      await withTimeout(events.waitUntilReady(), this.#connectTimeoutMs, 'AI queue events');
      return true;
    } catch (error) {
      this.warnOnce('ai.queue.unavailable', error);
      return false;
    }
  }

  private async dispose(): Promise<void> {
    const queue = this.#queue;
    const events = this.#events;
    this.#queue = undefined;
    this.#events = undefined;
    await Promise.allSettled([
      ...(queue ? [withTimeout(queue.close(), 2_000, 'AI queue close')] : []),
      ...(events ? [withTimeout(events.close(), 2_000, 'AI queue events close')] : []),
    ]);
    this.#producerConnection?.disconnect();
    this.#eventsConnection?.disconnect();
    this.#producerConnection = undefined;
    this.#eventsConnection = undefined;
  }

  private warnOnce(event: string, error: unknown): void {
    const now = Date.now();
    if (now - this.#lastWarningAt < RETRY_COOLDOWN_MS) return;
    this.#lastWarningAt = now;
    console.warn(
      JSON.stringify({
        level: 'warn',
        event,
        error: error instanceof Error ? error.message : 'Unknown queue error',
      }),
    );
  }
}
