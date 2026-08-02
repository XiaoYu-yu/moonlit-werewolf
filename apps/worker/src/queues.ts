import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUES } from './jobs.js';

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1_000,
    jitter: 0.25,
  },
  removeOnComplete: { age: 60 * 60, count: 1_000 },
  removeOnFail: { age: 24 * 60 * 60, count: 5_000 },
};

export function createQueues(connection: Redis) {
  return {
    ai: new Queue(QUEUES.ai, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS }),
    transcription: new Queue(QUEUES.transcription, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
    persistence: new Queue(QUEUES.persistence, {
      connection,
      defaultJobOptions: DEFAULT_JOB_OPTIONS,
    }),
  };
}
