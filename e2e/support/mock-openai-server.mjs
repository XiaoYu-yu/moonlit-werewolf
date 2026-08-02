import { createServer } from 'node:http';

const port = Number.parseInt(process.env.MOCK_OPENAI_PORT ?? '4010', 10);
const host = process.env.MOCK_OPENAI_HOST ?? '127.0.0.1';
const sentinelPrefix = 'E2E-真实模型决策摘要';

const state = {
  calls: 0,
  speechCalls: 0,
  speechCallsByGame: new Map(),
  mode: 'success',
  delayMs: 80,
  lastRequest: undefined,
  requests: [],
};

const speechTemplates = [
  '目前公开信息还少，我暂时不急着站边。上一位的态度我记下了，后面谁能给出明确怀疑对象和理由，我再决定跟谁。',
  '我先把这一轮的公开信息排一下：有人只给结论却没有解释，也有人愿意回应前置位的问题。现阶段我更关注发言前后是否一致，以及投票时会不会突然换目标。请后面的玩家不要只说“再听听”，最好点出具体座位和依据；如果新的信息能解释现有矛盾，我也愿意调整判断。',
  '这一轮我不想只报一个模糊印象，所以把判断标准说清楚。第一，发言有没有回应前面玩家提出的问题；第二，怀疑对象是否具体，理由能否和公开事件对应；第三，态度变化有没有自然的新信息支撑。现在场上有几段发言听起来很完整，但真正可验证的内容不多，也有玩家在关键问题上反复使用安全措辞。我会把这类回避和后续投票放在一起看，而不是因为一句强势发言就直接认好。后置位如果认可某个判断，请补充独立理由，不要简单复述；如果反对，也请指出是哪条公开信息不成立。我的当前倾向只是阶段性结论，等这一圈发言结束后再结合票型修正。',
];

function json(response, status, body) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parsePrompt(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const userMessage = [...messages]
    .reverse()
    .find((message) => message && message.role === 'user' && typeof message.content === 'string');
  if (!userMessage) return {};
  try {
    return JSON.parse(userMessage.content);
  } catch {
    return {};
  }
}

function firstLegalTarget(prompt) {
  const targets = prompt?.legalTargets;
  if (
    Array.isArray(targets) &&
    targets[0] &&
    typeof targets[0] === 'object' &&
    typeof targets[0].targetSeatId === 'string'
  ) {
    return targets[0].targetSeatId;
  }
  const legacyTargets = prompt?.privatePlayer?.legalTargetIds;
  return Array.isArray(legacyTargets) && typeof legacyTargets[0] === 'string'
    ? legacyTargets[0]
    : undefined;
}

function structuredAction(prompt, callNumber, speechCallNumber) {
  const instruction = typeof prompt.instruction === 'string' ? prompt.instruction : '';
  const decisionSummary = `${sentinelPrefix}-${callNumber}：最终选择已确定。`;
  const visibleAnalysis = `${sentinelPrefix}-公开分析-${callNumber}：我比较了当前可见的公开发言、阶段信息与合法行动范围，重点检查了态度是否前后一致、是否回应了前置位的问题，以及这次选择会给下一轮留下什么可验证的信息。我也保留了主要不确定性，避免把暂时的怀疑写成确定事实，并说明后续可通过票型或新发言验证的观察点。这是模型主动生成并允许观察者查看的分析文本。`;
  const targetSeatId = firstLegalTarget(prompt);

  if (instruction.includes('"type":"speak"')) {
    const template = speechTemplates[(speechCallNumber - 1) % speechTemplates.length];
    return {
      type: 'speak',
      message: `E2E 模型发言 ${speechCallNumber}：${template}`,
      memorySummary: `E2E 公开局势摘要 ${callNumber}`,
      decisionSummary,
      visibleAnalysis,
    };
  }

  if (instruction.includes('"type":"vote"')) {
    return targetSeatId
      ? { type: 'vote', targetSeatId, decisionSummary, visibleAnalysis }
      : { type: 'vote', abstain: true, decisionSummary, visibleAnalysis };
  }

  if (instruction.includes('useHeal=true')) {
    return { type: 'night', abstain: true, decisionSummary, visibleAnalysis };
  }

  return targetSeatId
    ? { type: 'night', targetSeatId, decisionSummary, visibleAnalysis }
    : { type: 'night', abstain: true, decisionSummary, visibleAnalysis };
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/__test/state') {
    json(response, 200, {
      calls: state.calls,
      speechCalls: state.speechCalls,
      mode: state.mode,
      delayMs: state.delayMs,
      lastRequest: state.lastRequest,
      requests: state.requests,
      sentinelPrefix,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/__test/reset') {
    state.calls = 0;
    state.speechCalls = 0;
    state.speechCallsByGame.clear();
    state.mode = 'success';
    state.delayMs = 80;
    state.lastRequest = undefined;
    state.requests = [];
    json(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/__test/control') {
    try {
      const body = await readJson(request);
      if (['success', 'invalid', 'error'].includes(body.mode)) state.mode = body.mode;
      if (Number.isInteger(body.delayMs) && body.delayMs >= 0 && body.delayMs <= 10_000) {
        state.delayMs = body.delayMs;
      }
      json(response, 200, { ok: true, mode: state.mode, delayMs: state.delayMs });
    } catch {
      json(response, 400, { error: 'invalid control payload' });
    }
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let body;
    try {
      body = await readJson(request);
    } catch {
      json(response, 400, { error: { message: 'invalid json' } });
      return;
    }

    state.calls += 1;
    const callNumber = state.calls;
    const prompt = parsePrompt(body);
    const instruction = typeof prompt.instruction === 'string' ? prompt.instruction : '';
    const isSpeech = instruction.includes('"type":"speak"');
    const gameId =
      typeof prompt?.publicRoom?.gameId === 'string' ? prompt.publicRoom.gameId : undefined;
    let speechCallNumber = 0;
    if (isSpeech) {
      state.speechCalls += 1;
      const gameKey = gameId ?? 'unscoped';
      speechCallNumber = (state.speechCallsByGame.get(gameKey) ?? 0) + 1;
      state.speechCallsByGame.set(gameKey, speechCallNumber);
    }
    const requestRecord = {
      callNumber,
      gameId,
      actorId:
        typeof prompt?.privatePlayer?.playerId === 'string'
          ? prompt.privatePlayer.playerId
          : undefined,
      model: typeof body.model === 'string' ? body.model : undefined,
      responseFormat: body.response_format,
      hasAuthorization: typeof request.headers.authorization === 'string',
      instruction: instruction ? instruction.slice(0, 500) : undefined,
      actionType: isSpeech ? 'speak' : instruction.includes('"type":"vote"') ? 'vote' : 'night',
      expectsVisibleAnalysis: instruction.includes('visibleAnalysis'),
      speechCallNumber: isSpeech ? speechCallNumber : undefined,
      legalTargetCount: Array.isArray(prompt?.legalTargets)
        ? prompt.legalTargets.length
        : Array.isArray(prompt?.privatePlayer?.legalTargetIds)
          ? prompt.privatePlayer.legalTargetIds.length
          : 0,
    };
    state.lastRequest = requestRecord;
    state.requests = [...state.requests, requestRecord].slice(-100);

    if (state.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    }

    if (state.mode === 'error') {
      json(response, 500, { error: { message: 'synthetic provider failure' } });
      return;
    }

    const content =
      state.mode === 'invalid'
        ? JSON.stringify({ type: 'night', abstain: true })
        : JSON.stringify(structuredAction(prompt, callNumber, speechCallNumber));
    json(response, 200, {
      id: `mock-completion-${callNumber}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1_000),
      model: typeof body.model === 'string' ? body.model : 'mock-kimi',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 32,
        completion_tokens: 24,
        total_tokens: 56,
      },
    });
    return;
  }

  json(response, 404, { error: 'not found' });
});

server.listen(port, host, () => {
  console.log(`Mock OpenAI-compatible server listening on http://${host}:${port}`);
});

const close = () => server.close(() => process.exit(0));
process.on('SIGINT', close);
process.on('SIGTERM', close);
