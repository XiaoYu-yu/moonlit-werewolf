import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  expectMinimumFontSize,
  expectNoHorizontalOverflow,
  expectTextWrapsWithoutClipping,
} from './support/layout';
import { auditPage, expectAuditClean } from './support/page-audit';
import {
  latestSocketEvent,
  recordSocketTranscript,
  waitForSocketEvent,
  type SocketTranscript,
} from './support/socket-transcript';
import { E2E_API_URL, E2E_MOCK_OPENAI_URL } from './support/test-environment';

const INVITE_CODE = 'E2E-MOONLIT-INVITE';
const ADMIN_KEY = 'dev-admin-key';
const SYNTHETIC_PROVIDER_KEY = 'synthetic-e2e-kimi-key';
const SENTINEL_PREFIX = 'E2E-真实模型决策摘要';

interface ActiveDecision {
  readonly turnId: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly providerId: 'kimi' | 'deepseek';
  readonly modelId: string;
  readonly phase: string;
  readonly round: number;
  readonly actionType: 'speak' | 'vote' | 'night';
  readonly status: 'thinking' | 'summary_ready' | 'fallback';
  readonly source?: 'provider' | 'fallback';
  readonly startedAt: number;
  readonly updatedAt: number;
  readonly summaryReadyAt?: number;
  readonly applyAt?: number;
}

interface ThoughtEntry {
  readonly id: string;
  readonly turnId: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly providerId: 'kimi' | 'deepseek';
  readonly modelId: string;
  readonly phase: string;
  readonly round: number;
  readonly actionType: 'speak' | 'vote' | 'night';
  readonly content: string;
  readonly visibleAnalysis?: string;
  readonly source: 'provider' | 'fallback';
  readonly timestamp: number;
}

interface PublicChatMessage {
  readonly id: string;
  readonly type: 'chat.message';
  readonly actorId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly message: string;
  readonly at: number;
  readonly round: number;
  readonly phase: string;
}

interface ObserverState {
  readonly connected: true;
  readonly isObserver: true;
  readonly gameId: string;
  readonly mode: 'ai_observer';
  readonly phase: string;
  readonly round: number;
  readonly activeDecision?: ActiveDecision;
  readonly aiThoughtHistory: readonly ThoughtEntry[];
  readonly chatHistory: readonly PublicChatMessage[];
  readonly actions: readonly {
    readonly sequence: number;
    readonly kind: string;
    readonly actorId?: string;
  }[];
}

interface MockOpenAiState {
  readonly calls: number;
  readonly speechCalls: number;
  readonly mode: 'success' | 'invalid' | 'error';
  readonly delayMs: number;
  readonly sentinelPrefix: string;
  readonly requests: readonly {
    readonly callNumber: number;
    readonly gameId?: string;
    readonly actorId?: string;
    readonly model?: string;
    readonly responseFormat?: { readonly type?: string };
    readonly hasAuthorization: boolean;
    readonly instruction?: string;
    readonly actionType?: 'speak' | 'vote' | 'night';
    readonly expectsVisibleAnalysis?: boolean;
    readonly speechCallNumber?: number;
    readonly legalTargetCount: number;
  }[];
}

async function configureKimiStub(request: APIRequestContext, enabled: boolean) {
  return request.patch(`${E2E_API_URL}/api/v1/admin/providers/kimi`, {
    headers: { 'x-admin-key': ADMIN_KEY },
    data: enabled
      ? {
          baseUrl: `${E2E_MOCK_OPENAI_URL}/v1`,
          apiKey: SYNTHETIC_PROVIDER_KEY,
          enabled: true,
          concurrencyLimit: 4,
          timeoutMs: 5_000,
          dailyBudgetCents: 10_000,
        }
      : { enabled: false },
  });
}

async function mockState(request: APIRequestContext): Promise<MockOpenAiState> {
  const response = await request.get(`${E2E_MOCK_OPENAI_URL}/__test/state`);
  expect(response.ok()).toBe(true);
  return (await response.json()) as MockOpenAiState;
}

function eventIndex(transcript: SocketTranscript, event: object): number {
  return transcript.events.findIndex((candidate) => candidate === event);
}

function publicEventsAfter(transcript: SocketTranscript, afterIndex: number) {
  return transcript.events
    .slice(afterIndex)
    .filter(({ name }) => ['room.snapshot', 'game.event', 'ai.status'].includes(name));
}

function requestsForDecision(
  state: MockOpenAiState,
  gameId: string,
  actorId: string,
): MockOpenAiState['requests'] {
  return state.requests.filter(
    (request) => request.gameId === gameId && request.actorId === actorId,
  );
}

test.afterEach(async ({ request }) => {
  await configureKimiStub(request, false).catch(() => undefined);
  await request.post(`${E2E_MOCK_OPENAI_URL}/__test/reset`).catch(() => undefined);
});

test('real provider summary is private, paced, pausable, and truthfully falls back', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const audit = auditPage(page);
  const transcript = recordSocketTranscript(page);

  const reset = await request.post(`${E2E_MOCK_OPENAI_URL}/__test/reset`);
  expect(reset.ok()).toBe(true);
  const controlled = await request.post(`${E2E_MOCK_OPENAI_URL}/__test/control`, {
    data: { mode: 'success', delayMs: 1_600 },
  });
  expect(controlled.ok()).toBe(true);

  const configured = await configureKimiStub(request, true);
  expect(configured.status()).toBe(200);

  await page.goto('/');
  await page.getByTestId('home-observer-tab').click();
  await page.getByLabel('建房邀请码').fill(INVITE_CODE);
  await page.getByTestId('observer-preset-6').click();
  for (let seatNumber = 1; seatNumber <= 6; seatNumber += 1) {
    await page.getByTestId(`observer-seat-${seatNumber}-model`).selectOption('kimi');
  }

  const socketStartIndex = transcript.events.length;
  await page.getByTestId('home-submit').click();
  await expect(page).toHaveURL(/\/room\/[A-Z0-9_-]+\?mode=live$/);

  const thinking = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) => state.activeDecision?.status === 'thinking',
    {
      afterIndex: socketStartIndex,
      timeout: 20_000,
      description: 'waiting for a real Kimi turn to enter thinking state',
    },
  );
  const thinkingDecision = thinking.payload.activeDecision;
  expect(thinkingDecision).toBeDefined();
  if (!thinkingDecision) throw new Error('Thinking decision was not present');

  const thinkingStage = page.getByTestId('observer-thinking-stage');
  await expect(thinkingStage).toHaveAttribute('data-status', 'thinking');
  await expect(thinkingStage).toHaveAttribute('data-turn-id', thinkingDecision.turnId);
  await expect(thinkingStage).toHaveAttribute('data-actor-id', thinkingDecision.actorId);
  await expect(
    page.getByTestId('observer-role-grid').locator('article[data-thinking="true"]'),
  ).toHaveCount(1);

  const summary = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) =>
      state.activeDecision?.turnId === thinkingDecision.turnId &&
      state.activeDecision.status === 'summary_ready' &&
      state.aiThoughtHistory.some(
        (entry) =>
          entry.turnId === thinkingDecision.turnId &&
          entry.source === 'provider' &&
          entry.content.startsWith(SENTINEL_PREFIX),
      ),
    {
      afterIndex: eventIndex(transcript, thinking) + 1,
      timeout: 20_000,
      description: 'waiting for the provider-authored summary before action application',
    },
  );
  const summaryDecision = summary.payload.activeDecision;
  const providerThought = summary.payload.aiThoughtHistory.find(
    (entry) => entry.turnId === thinkingDecision.turnId,
  );
  expect(summaryDecision).toBeDefined();
  expect(providerThought).toBeDefined();
  if (!summaryDecision || !providerThought)
    throw new Error('Provider summary state was incomplete');

  expect(summaryDecision.source).toBe('provider');
  expect(summaryDecision.providerId).toBe('kimi');
  expect(summaryDecision.modelId).toBe('kimi-k2.6');
  expect(summaryDecision.summaryReadyAt).toBeGreaterThanOrEqual(summaryDecision.startedAt + 1_400);
  expect(summaryDecision.applyAt).toBeGreaterThanOrEqual(
    (summaryDecision.summaryReadyAt ?? 0) + 2_400,
  );
  expect(summary.receivedAt).toBeGreaterThanOrEqual(thinking.receivedAt);
  expect(providerThought.content).toContain(SENTINEL_PREFIX);
  expect(providerThought.visibleAnalysis).toContain(`${SENTINEL_PREFIX}-公开分析`);
  expect(providerThought.visibleAnalysis?.length).toBeGreaterThanOrEqual(120);

  await expect(thinkingStage).toHaveAttribute('data-status', 'summary_ready');
  const providerThoughtItem = page.getByTestId(`observer-thought-${providerThought.id}`);
  await expect(providerThoughtItem).toBeVisible();
  await expect(providerThoughtItem).toHaveAttribute('data-source', 'provider');
  await expect(providerThoughtItem).toContainText(SENTINEL_PREFIX);
  await expect(page.getByTestId(`observer-thought-source-${providerThought.id}`)).toBeVisible();
  await expectNoHorizontalOverflow(page, 'desktop provider thought channel');

  const analysisTrigger = page.getByTestId(`observer-seat-analysis-${providerThought.seatNumber}`);
  await analysisTrigger.click();
  const analysisDrawer = page.getByTestId('observer-analysis-drawer');
  await expect(analysisDrawer).toBeVisible();
  await expect(page.getByTestId('observer-analysis-title')).toContainText(
    `${providerThought.seatNumber} 号`,
  );
  await expect(page.getByTestId('observer-analysis-current-status')).toBeVisible();
  const analysisFeed = page.getByTestId('observer-analysis-feed');
  const analysisEntry = page.getByTestId(`observer-analysis-entry-${providerThought.id}`);
  await expect(analysisEntry).toHaveAttribute('data-actor-id', providerThought.actorId);
  await expect(analysisEntry).toHaveAttribute('data-provider-id', providerThought.providerId);
  await expect(analysisEntry).toHaveAttribute('data-source', 'provider');
  await expect(analysisEntry).toHaveAttribute('data-round', String(providerThought.round));
  await expect(analysisEntry).toHaveAttribute('data-phase', providerThought.phase);
  await expect(analysisEntry).toContainText(providerThought.visibleAnalysis ?? '');
  expect(
    await analysisFeed
      .locator('[data-testid^="observer-analysis-entry-"]')
      .evaluateAll(
        (entries, actorId) =>
          entries
            .map((entry) => entry.getAttribute('data-actor-id'))
            .filter((entryActorId) => entryActorId !== actorId),
        providerThought.actorId,
      ),
  ).toEqual([]);
  const visibleAnalysis = page.getByTestId(`observer-analysis-visible-${providerThought.id}`);
  await expectMinimumFontSize(
    visibleAnalysis.locator('p'),
    16,
    'desktop observer visible analysis',
  );
  await expectTextWrapsWithoutClipping(
    visibleAnalysis.locator('p'),
    'desktop observer visible analysis',
  );
  await page.getByTestId('observer-analysis-close').click();
  await expect(analysisDrawer).toBeHidden();
  await expect(analysisTrigger).toBeFocused();

  const emptySeatNumber = [1, 2, 3, 4, 5, 6].find(
    (seatNumber) =>
      !summary.payload.aiThoughtHistory.some((thought) => thought.seatNumber === seatNumber),
  );
  expect(emptySeatNumber).toBeDefined();
  if (!emptySeatNumber) throw new Error('No empty analysis seat was available');
  const emptyAnalysisTrigger = page.getByTestId(`observer-seat-analysis-${emptySeatNumber}`);
  await emptyAnalysisTrigger.click();
  await expect(page.getByTestId('observer-analysis-empty')).toBeVisible();
  await page.getByTestId('observer-analysis-close').click();
  await expect(emptyAnalysisTrigger).toBeFocused();

  const stubAfterSummary = await mockState(request);
  expect(stubAfterSummary.mode).toBe('success');
  expect(stubAfterSummary.sentinelPrefix).toBe(SENTINEL_PREFIX);
  const currentDecisionRequests = requestsForDecision(
    stubAfterSummary,
    summary.payload.gameId,
    thinkingDecision.actorId,
  );
  expect(currentDecisionRequests).toHaveLength(1);
  expect(currentDecisionRequests[0]).toMatchObject({
    model: 'kimi-k2.6',
    hasAuthorization: true,
    responseFormat: { type: 'json_object' },
  });
  expect(providerThought.content).toContain(
    `${SENTINEL_PREFIX}-${currentDecisionRequests[0]?.callNumber}`,
  );

  const summaryEventIndex = eventIndex(transcript, summary);
  const publicBeforePause = publicEventsAfter(transcript, socketStartIndex);
  expect(publicBeforePause.length).toBeGreaterThan(0);
  for (const event of publicBeforePause) {
    expect(event.raw).not.toContain(SENTINEL_PREFIX);
    expect(event.raw).not.toContain('"decisionSummary"');
    expect(event.raw).not.toContain('"visibleAnalysis"');
    expect(event.raw).not.toContain('"aiThoughtHistory"');
  }

  await page.getByTestId('observer-pause-toggle').click();
  await expect(page.getByTestId('observer-pause-toggle')).toHaveAttribute(
    'aria-label',
    '继续 AI 观战对局',
  );
  const paused = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) =>
      state.activeDecision?.turnId === thinkingDecision.turnId &&
      state.activeDecision.applyAt === undefined,
    {
      afterIndex: summaryEventIndex + 1,
      description: 'waiting for pause to freeze the pending provider turn',
    },
  );
  const originalApplyAt = summaryDecision.applyAt;
  if (!originalApplyAt) throw new Error('Summary-ready state did not expose applyAt');
  await expect
    .poll(() => Date.now(), {
      timeout: Math.max(5_000, originalApplyAt - Date.now() + 2_500),
      message: 'waiting beyond the original application deadline while paused',
    })
    .toBeGreaterThan(originalApplyAt + 500);

  const pausedState = latestSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) => state.activeDecision?.turnId === thinkingDecision.turnId,
    eventIndex(transcript, paused),
  );
  expect(pausedState?.payload.activeDecision?.turnId).toBe(thinkingDecision.turnId);
  expect(pausedState?.payload.activeDecision?.applyAt).toBeUndefined();
  expect(
    pausedState?.payload.aiThoughtHistory.filter(
      (entry) => entry.turnId === thinkingDecision.turnId,
    ),
  ).toHaveLength(1);
  expect(
    requestsForDecision(await mockState(request), summary.payload.gameId, thinkingDecision.actorId),
  ).toHaveLength(currentDecisionRequests.length);

  const initialActionCount = summary.payload.actions.length;
  const actionAppliedWhilePaused = transcript.events
    .slice(summaryEventIndex + 1)
    .some(
      (event) =>
        event.name === 'observer.private_state' &&
        (event.payload as ObserverState).actions.length > initialActionCount,
    );
  expect(actionAppliedWhilePaused).toBe(false);

  await request.post(`${E2E_MOCK_OPENAI_URL}/__test/control`, {
    data: { mode: 'invalid', delayMs: 40 },
  });
  await page.getByTestId('observer-pause-toggle').click();
  await expect(page.getByTestId('observer-pause-toggle')).toHaveAttribute(
    'aria-label',
    '立即暂停 AI 观战对局',
  );
  const resumed = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) =>
      state.activeDecision?.turnId === thinkingDecision.turnId &&
      typeof state.activeDecision.applyAt === 'number' &&
      state.activeDecision.applyAt > Date.now(),
    {
      afterIndex: eventIndex(transcript, paused) + 1,
      description: 'waiting for resume to restore the same pending turn deadline',
    },
  );
  expect(resumed.payload.activeDecision?.turnId).toBe(thinkingDecision.turnId);

  const applied = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) =>
      state.actions.length > initialActionCount &&
      state.activeDecision?.turnId !== thinkingDecision.turnId,
    {
      afterIndex: eventIndex(transcript, resumed) + 1,
      timeout: 15_000,
      description: 'waiting for exactly one paused provider turn to apply after resume',
    },
  );
  expect(
    applied.payload.aiThoughtHistory.filter((entry) => entry.turnId === thinkingDecision.turnId),
  ).toHaveLength(1);

  const fallback = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) =>
      state.aiThoughtHistory.some(
        (entry) =>
          entry.turnId !== thinkingDecision.turnId &&
          entry.source === 'fallback' &&
          entry.content.includes('规则兜底'),
      ),
    {
      afterIndex: eventIndex(transcript, applied),
      timeout: 25_000,
      description: 'waiting for invalid provider output to become an explicit fallback entry',
    },
  );
  const fallbackThought = [...fallback.payload.aiThoughtHistory]
    .reverse()
    .find(
      (entry) =>
        entry.turnId !== thinkingDecision.turnId &&
        entry.source === 'fallback' &&
        entry.content.includes('规则兜底'),
    );
  expect(fallbackThought).toBeDefined();
  if (!fallbackThought) throw new Error('Fallback thought was not present');

  const fallbackItem = page.getByTestId(`observer-thought-${fallbackThought.id}`);
  await expect(fallbackItem).toHaveAttribute('data-source', 'fallback');
  await expect(fallbackItem).toContainText('规则兜底');
  await expect(page.getByTestId(`observer-thought-source-${fallbackThought.id}`)).toBeVisible();

  const publicAfterFallback = publicEventsAfter(transcript, summaryEventIndex + 1);
  for (const event of publicAfterFallback) {
    expect(event.raw).not.toContain(SENTINEL_PREFIX);
    expect(event.raw).not.toContain('"decisionSummary"');
    expect(event.raw).not.toContain('"visibleAnalysis"');
    expect(event.raw).not.toContain('规则兜底');
    expect(event.raw).not.toContain('"aiThoughtHistory"');
  }
  expect(
    (await mockState(request)).requests.filter(
      (providerRequest) => providerRequest.gameId === summary.payload.gameId,
    ).length,
  ).toBeGreaterThan(currentDecisionRequests.length);
  expectAuditClean(audit);
});

test('AI discussion renders authoritative rounds with adaptive speech lengths', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const audit = auditPage(page);
  const transcript = recordSocketTranscript(page);

  const reset = await request.post(`${E2E_MOCK_OPENAI_URL}/__test/reset`);
  expect(reset.ok()).toBe(true);
  const controlled = await request.post(`${E2E_MOCK_OPENAI_URL}/__test/control`, {
    data: { mode: 'success', delayMs: 30 },
  });
  expect(controlled.ok()).toBe(true);
  const configured = await configureKimiStub(request, true);
  expect(configured.status()).toBe(200);

  await page.goto('/');
  await page.getByTestId('home-observer-tab').click();
  await page.getByLabel('建房邀请码').fill(INVITE_CODE);
  await page.getByTestId('observer-preset-6').click();
  for (let seatNumber = 1; seatNumber <= 6; seatNumber += 1) {
    await page.getByTestId(`observer-seat-${seatNumber}-model`).selectOption('kimi');
  }

  const socketStartIndex = transcript.events.length;
  await page.getByTestId('home-submit').click();
  await expect(page).toHaveURL(/\/room\/[A-Z0-9_-]+\?mode=live$/);

  const discussionState = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) =>
      state.chatHistory.filter((message) => message.message.startsWith('E2E 模型发言')).length >= 3,
    {
      afterIndex: socketStartIndex,
      timeout: 90_000,
      description: 'waiting for short, medium, and long controlled AI speeches',
    },
  );
  const speeches = discussionState.payload.chatHistory
    .filter((message) => message.message.startsWith('E2E 模型发言'))
    .slice(0, 3);
  expect(speeches).toHaveLength(3);

  const lengths = speeches.map((speech) => speech.message.length);
  expect(lengths.some((length) => length >= 20 && length <= 80)).toBe(true);
  expect(lengths.some((length) => length >= 81 && length <= 180)).toBe(true);
  expect(lengths.some((length) => length >= 181 && length <= 420)).toBe(true);
  expect(new Set(speeches.map((speech) => speech.message)).size).toBe(speeches.length);

  const discussion = page.getByTestId('observer-discussion-channel');
  await expect(discussion).toBeVisible();
  await expect(page.getByTestId('observer-current-speaker')).toBeVisible();

  let previousIndex = -1;
  const renderedMessageIds = await discussion
    .locator('[data-testid^="observer-speech-"]')
    .evaluateAll((entries) => entries.map((entry) => entry.getAttribute('data-message-id')));
  for (const [index, speech] of speeches.entries()) {
    const speechItem = page.getByTestId(`observer-speech-${speech.id}`);
    await expect(speechItem).toBeVisible();
    await expect(speechItem).toHaveAttribute('data-message-id', speech.id);
    await expect(speechItem).toHaveAttribute('data-round', String(speech.round));
    await expect(speechItem).toHaveAttribute('data-phase', speech.phase);
    await expect(speechItem).toHaveAttribute('data-seat-number', String(speech.seatNumber));
    await expect(speechItem).toHaveAttribute('data-actor-id', speech.actorId);
    await expect(speechItem).toHaveAttribute('data-message-length', String(speech.message.length));
    await expect(speechItem).toContainText(speech.message);
    const renderedIndex = renderedMessageIds.indexOf(speech.id);
    expect(
      renderedIndex,
      `speech ${index + 1} should preserve authoritative order`,
    ).toBeGreaterThan(previousIndex);
    previousIndex = renderedIndex;
  }

  await expect(page.getByTestId(`observer-round-divider-${speeches[0]?.round}`)).toBeVisible();
  const longSpeech = speeches.reduce((longest, speech) =>
    speech.message.length > longest.message.length ? speech : longest,
  );
  const longSpeechText = page
    .getByTestId(`observer-speech-${longSpeech.id}`)
    .locator('.observer-speech-body > p');
  await expectMinimumFontSize(longSpeechText, 16, 'desktop observer speech body');
  await expectTextWrapsWithoutClipping(longSpeechText, 'desktop observer long speech');
  await expectMinimumFontSize(
    discussion.locator('.observer-speech-body header strong'),
    13,
    'desktop observer speech author',
  );
  await expectNoHorizontalOverflow(page, 'desktop adaptive observer discussion');

  const publicEvents = publicEventsAfter(transcript, socketStartIndex);
  for (const event of publicEvents) {
    expect(event.raw).not.toContain('"visibleAnalysis"');
  }

  const stub = await mockState(request);
  expect(stub.speechCalls).toBeGreaterThanOrEqual(3);
  expect(
    stub.requests
      .filter((providerRequest) => providerRequest.actionType === 'speak')
      .every((providerRequest) => providerRequest.expectsVisibleAnalysis === true),
  ).toBe(true);
  expectAuditClean(audit);
});
