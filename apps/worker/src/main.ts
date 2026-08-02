import { WorkerRuntime } from './runtime.js';

const redisUrl = process.env.REDIS_URL;
const runtime = redisUrl ? new WorkerRuntime(redisUrl) : undefined;
if (runtime) {
  runtime.start();
} else {
  console.warn(
    JSON.stringify({
      level: 'warn',
      event: 'worker.disabled',
      reason: 'REDIS_URL is unset',
    }),
  );
}

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  console.info(JSON.stringify({ level: 'info', event: 'worker.shutdown', signal }));
  await runtime?.close();
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void shutdown(signal).finally(() => process.exit(0));
  });
}
