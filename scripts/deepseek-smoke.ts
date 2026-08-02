import { AiGateway, createPlayableProviderAdapter } from '../packages/ai-gateway/src/index.ts';

const apiKey = process.env.DEEPSEEK_API_KEY;

if (!apiKey) {
  console.error('DEEPSEEK_API_KEY is required');
  process.exit(2);
}

async function main(): Promise<void> {
  const allowedSeatIds = ['seat-2', 'seat-3'] as const;
  const modelId = process.env.DEEPSEEK_MODEL ?? 'deepseek-v4-flash';
  const gateway = new AiGateway({
    providers: [
      createPlayableProviderAdapter({
        id: 'deepseek',
        apiKey,
        baseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
        modelId,
      }),
    ],
    maxAttemptsPerProvider: 2,
  });

  const result = await gateway.executeTurn({
    primaryProviderId: 'deepseek',
    actionType: 'vote',
    allowedSeatIds,
    request: {
      model: modelId,
      temperature: 0,
      maxOutputTokens: 80,
      timeoutMs: 20_000,
      messages: [
        {
          role: 'system',
          content:
            '你是狼人杀玩家。只返回严格 JSON，不要解释。格式：' +
            '{"type":"vote","targetSeatId":"seat-2或seat-3"}。',
        },
        {
          role: 'user',
          content: '请选择一个合法目标投票。',
        },
      ],
    },
  });

  const valid =
    result.providerId === 'deepseek' &&
    result.action.type === 'vote' &&
    allowedSeatIds.some((seatId) => result.action.targetSeatId === seatId);

  console.log(
    JSON.stringify({
      ok: valid,
      providerId: result.providerId ?? null,
      attempts: result.attempts,
      usedFallback: result.usedFallback,
      action: result.action,
      failureCount: result.failureReasons.length,
    }),
  );

  if (!valid) {
    process.exitCode = 1;
  }
}

void main();
