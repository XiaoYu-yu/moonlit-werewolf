import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { aiBudgetPolicyFromEnvironment, RedisBudgetLedger } from './budget-ledger.js';
import { createJobHandlers } from './handlers.js';
import {
  QUEUES,
  type AiTurnJobData,
  type PersistEventJobData,
  type TranscriptionJobData,
} from './jobs.js';
import { providersFromEnvironment } from './providers.js';

function concurrency(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export class WorkerRuntime {
  readonly #connection: Redis;
  readonly #workers: Worker[] = [];

  constructor(redisUrl: string) {
    this.#connection = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }

  start(): void {
    const budgetPolicy = aiBudgetPolicyFromEnvironment();
    const providers = providersFromEnvironment({
      maxAttemptsPerProvider: budgetPolicy.maxAttemptsPerProvider,
    });
    const handlers = createJobHandlers({
      aiGateway: providers.gateway,
      budgetLedger: new RedisBudgetLedger(this.#connection),
      budgetPolicy,
      providerPrices: providers.prices,
      transcriptionAdapters: providers.transcriptions,
    });
    const connection = this.#connection;
    this.#workers.push(
      new Worker<AiTurnJobData>(
        QUEUES.ai,
        (job) =>
          handlers.aiTurn(job.data, job.id === undefined ? undefined : `${QUEUES.ai}:${job.id}`),
        {
          connection,
          concurrency: concurrency('AI_WORKER_CONCURRENCY', 8),
        },
      ),
      new Worker<TranscriptionJobData>(
        QUEUES.transcription,
        (job) => handlers.transcription(job.data),
        {
          connection,
          concurrency: concurrency('TRANSCRIPTION_WORKER_CONCURRENCY', 2),
        },
      ),
      new Worker<PersistEventJobData>(
        QUEUES.persistence,
        (job) => handlers.persistEvent(job.data),
        {
          connection,
          concurrency: concurrency('PERSISTENCE_WORKER_CONCURRENCY', 16),
        },
      ),
    );

    for (const worker of this.#workers) {
      worker.on('failed', (job, error) => {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'job.failed',
            queue: worker.name,
            jobId: job?.id,
            attemptsMade: job?.attemptsMade,
            error: error.message,
          }),
        );
      });
      worker.on('error', (error) => {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'worker.error',
            queue: worker.name,
            error: error.message,
          }),
        );
      });
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.#workers.map((worker) => worker.close()));
    this.#connection.disconnect();
  }
}
