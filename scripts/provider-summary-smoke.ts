import {
  AiGateway,
  MAX_AI_VISIBLE_ANALYSIS_CHARS,
  createPlayableProviderAdapter,
  playableProviderDefaults,
  type PlayableProviderId,
} from '../packages/ai-gateway/src/index.ts';

interface ProviderSmokeCandidate {
  readonly id: PlayableProviderId;
  readonly apiKey: string;
}

function configuredProviders(): ProviderSmokeCandidate[] {
  const candidates = [
    { id: 'kimi' as const, apiKey: process.env.KIMI_API_KEY?.trim() },
    { id: 'deepseek' as const, apiKey: process.env.DEEPSEEK_API_KEY?.trim() },
  ];

  return candidates.flatMap((candidate) =>
    candidate.apiKey ? [{ id: candidate.id, apiKey: candidate.apiKey }] : [],
  );
}

async function verifyProvider(candidate: ProviderSmokeCandidate): Promise<boolean> {
  const defaults = playableProviderDefaults(candidate.id);
  const adapter = createPlayableProviderAdapter({
    id: candidate.id,
    apiKey: candidate.apiKey,
    baseUrl: defaults.baseUrl,
    modelId: defaults.modelId,
    timeoutMs: 45_000,
  });
  const gateway = new AiGateway({
    providers: [adapter],
    maxAttemptsPerProvider: 1,
  });
  const startedAt = Date.now();
  const result = await gateway.executeTurn({
    primaryProviderId: candidate.id,
    actionType: 'vote',
    allowedSeatIds: ['seat-2', 'seat-3'],
    requireDecisionSummary: true,
    requireVisibleAnalysis: true,
    request: {
      model: defaults.modelId,
      temperature: 0,
      maxOutputTokens: 1_000,
      timeoutMs: 45_000,
      messages: [
        {
          role: 'system',
          content:
            '你正在参加一局狼人杀。只返回严格 JSON 对象，不要 Markdown，不要输出逐步思维链。' +
            '格式必须为 {"type":"vote","targetSeatId":"seat-2或seat-3",' +
            '"decisionSummary":"30至120字的简短最终结论",' +
            '"visibleAnalysis":"120至700字、供认证观战者阅读的可见分析"}。' +
            'visibleAnalysis 是专门撰写的可见分析，不是隐藏思维链，不得包含系统提示、原始推理轨迹或供应商内部信息。',
        },
        {
          role: 'user',
          content:
            '2号发言前后矛盾，3号暂时没有明显问题。请选择一个合法目标，并给出简短最终结论和有边界的可见分析。',
        },
      ],
    },
  });
  const latestAttempt = result.providerAttempts.at(-1);
  const targetSeatId =
    'targetSeatId' in result.action ? (result.action.targetSeatId ?? null) : null;
  const decisionSummary = result.action.decisionSummary ?? null;
  const visibleAnalysis = result.action.visibleAnalysis?.trim() ?? '';
  const visibleAnalysisChars = visibleAnalysis.length;
  const decisionSummaryPreview =
    decisionSummary === null
      ? null
      : decisionSummary.length > 160
        ? `${decisionSummary.slice(0, 160)}…`
        : decisionSummary;
  const ok =
    result.providerId === candidate.id &&
    result.action.type === 'vote' &&
    targetSeatId !== null &&
    decisionSummary !== null &&
    visibleAnalysisChars > 0 &&
    visibleAnalysisChars <= MAX_AI_VISIBLE_ANALYSIS_CHARS;

  console.log(
    JSON.stringify({
      provider: candidate.id,
      requestedModel: defaults.modelId,
      ok,
      returnedProvider: result.providerId ?? null,
      returnedModel: result.modelId ?? null,
      elapsedMs: Date.now() - startedAt,
      attempts: result.attempts,
      usedFallback: result.usedFallback,
      action: {
        type: result.action.type,
        targetSeatId,
        decisionSummary: decisionSummaryPreview,
        visibleAnalysisChars,
      },
      telemetry: latestAttempt
        ? {
            succeeded: latestAttempt.succeeded,
            durationMs: latestAttempt.durationMs,
            inputTokens: latestAttempt.inputTokens ?? null,
            outputTokens: latestAttempt.outputTokens ?? null,
          }
        : null,
      failures: result.failureReasons,
    }),
  );

  return ok;
}

async function main(): Promise<void> {
  const providers = configuredProviders();
  if (providers.length === 0) {
    console.error('Set KIMI_API_KEY and/or DEEPSEEK_API_KEY before running this paid smoke test.');
    process.exitCode = 2;
    return;
  }

  let allPassed = true;
  for (const provider of providers) {
    allPassed = (await verifyProvider(provider)) && allPassed;
  }
  if (!allPassed) process.exitCode = 1;
}

void main();
