import { expect, test, type APIRequestContext } from '@playwright/test';

import {
  expectInsideViewport,
  expectMinimumFontSize,
  expectMinimumTouchTarget,
  expectNoHorizontalOverflow,
  expectTextWrapsWithoutClipping,
} from './support/layout';
import { auditPage, expectAuditClean } from './support/page-audit';
import { recordSocketTranscript, waitForSocketEvent } from './support/socket-transcript';
import { E2E_API_URL, E2E_MOCK_OPENAI_URL } from './support/test-environment';

const INVITE_CODE = 'E2E-MOONLIT-INVITE';
const ADMIN_KEY = 'dev-admin-key';
const SYNTHETIC_PROVIDER_KEY = 'synthetic-e2e-kimi-key';

interface ThoughtEntry {
  readonly id: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly providerId: 'kimi' | 'deepseek';
  readonly source: 'provider' | 'fallback';
  readonly visibleAnalysis?: string;
}

interface PublicChatMessage {
  readonly id: string;
  readonly actorId: string;
  readonly seatNumber: number;
  readonly message: string;
  readonly round: number;
  readonly phase: string;
}

interface ObserverState {
  readonly aiThoughtHistory: readonly ThoughtEntry[];
  readonly chatHistory: readonly PublicChatMessage[];
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

test.afterEach(async ({ request }) => {
  await configureKimiStub(request, false).catch(() => undefined);
  await request.post(`${E2E_MOCK_OPENAI_URL}/__test/reset`).catch(() => undefined);
});

test('390px mobile keeps readable AI discussion and per-seat analysis inside the viewport', async ({
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
  await expect(page.getByTestId('observer-seat-1-model')).toBeVisible();
  await expect(page.getByTestId('observer-seat-6-personality')).toBeVisible();
  for (let seatNumber = 1; seatNumber <= 6; seatNumber += 1) {
    await page.getByTestId(`observer-seat-${seatNumber}-model`).selectOption('kimi');
  }
  await expectNoHorizontalOverflow(page, 'mobile AI observer creation');

  const socketStartIndex = transcript.events.length;
  await page.getByTestId('home-submit').click();
  await expect(page).toHaveURL(/\/room\/[A-Z0-9_-]+\?mode=live$/);
  await expect(page.getByTestId('observer-connection-mode')).toContainText('全知观察者');
  await expect(page.getByTestId('observer-role-grid').locator('article')).toHaveCount(6);
  await expect(page.getByTestId('observer-pause-toggle')).toBeVisible();
  await expect(page.getByTestId('observer-thinking-stage')).toBeVisible();
  await expect(page.getByTestId('observer-thought-channel')).toBeVisible();
  await expect(page.getByTestId('observer-action-feed')).toBeVisible();
  await expect(page.getByTestId('observer-chat-feed')).toBeVisible();

  const observer = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) =>
      state.aiThoughtHistory.some(
        (thought) => thought.source === 'provider' && Boolean(thought.visibleAnalysis),
      ) &&
      state.chatHistory.filter((message) => message.message.startsWith('E2E 模型发言')).length >= 3,
    {
      afterIndex: socketStartIndex,
      timeout: 90_000,
      description: 'waiting for mobile provider analysis and adaptive public speeches',
    },
  );
  const providerThought = observer.payload.aiThoughtHistory.find(
    (thought) => thought.source === 'provider' && Boolean(thought.visibleAnalysis),
  );
  expect(providerThought).toBeDefined();
  if (!providerThought) throw new Error('Provider analysis was not present');

  const speeches = observer.payload.chatHistory
    .filter((message) => message.message.startsWith('E2E 模型发言'))
    .slice(0, 3);
  expect(speeches).toHaveLength(3);
  const lengths = speeches.map((speech) => speech.message.length);
  expect(lengths.some((length) => length >= 20 && length <= 80)).toBe(true);
  expect(lengths.some((length) => length >= 81 && length <= 180)).toBe(true);
  expect(lengths.some((length) => length >= 181 && length <= 420)).toBe(true);

  const discussion = page.getByTestId('observer-discussion-channel');
  await expect(discussion).toBeVisible();
  await expect(page.getByTestId('observer-current-speaker')).toBeVisible();
  const longSpeech = speeches.reduce((longest, speech) =>
    speech.message.length > longest.message.length ? speech : longest,
  );
  const longSpeechItem = page.getByTestId(`observer-speech-${longSpeech.id}`);
  await expect(longSpeechItem).toHaveAttribute('data-round', String(longSpeech.round));
  await expect(longSpeechItem).toHaveAttribute('data-phase', longSpeech.phase);
  await expect(longSpeechItem).toHaveAttribute('data-actor-id', longSpeech.actorId);
  await expect(longSpeechItem).toHaveAttribute('data-seat-number', String(longSpeech.seatNumber));
  await expect(longSpeechItem).toHaveAttribute(
    'data-message-length',
    String(longSpeech.message.length),
  );
  const longSpeechText = longSpeechItem.locator('.observer-speech-body > p');
  await expectMinimumFontSize(longSpeechText, 16, 'mobile observer speech body');
  await expectTextWrapsWithoutClipping(longSpeechText, 'mobile observer long speech');

  await expectMinimumTouchTarget(
    page.getByTestId(/^observer-seat-analysis-\d+$/),
    44,
    'mobile AI analysis seat buttons',
  );
  await expectMinimumTouchTarget(
    page.getByTestId('observer-pause-toggle'),
    44,
    'mobile observer pause button',
  );

  const analysisTrigger = page.getByTestId(`observer-seat-analysis-${providerThought.seatNumber}`);
  await analysisTrigger.click();
  const analysisDrawer = page.getByTestId('observer-analysis-drawer');
  await expect(analysisDrawer).toBeVisible();
  await expectInsideViewport(analysisDrawer, 'mobile AI analysis drawer');
  await expect(page.getByTestId('observer-analysis-title')).toContainText(
    `${providerThought.seatNumber} 号`,
  );
  await expect(page.getByTestId('observer-analysis-current-status')).toBeVisible();

  const analysisFeed = page.getByTestId('observer-analysis-feed');
  const entries = analysisFeed.locator('[data-testid^="observer-analysis-entry-"]');
  await expect(entries.first()).toBeVisible();
  expect(
    await entries.evaluateAll(
      (items, actorId) =>
        items
          .map((item) => item.getAttribute('data-actor-id'))
          .filter((itemActorId) => itemActorId !== actorId),
      providerThought.actorId,
    ),
  ).toEqual([]);
  const analysisEntry = page.getByTestId(`observer-analysis-entry-${providerThought.id}`);
  await expect(analysisEntry).toHaveAttribute('data-actor-id', providerThought.actorId);
  await expect(analysisEntry).toHaveAttribute('data-provider-id', providerThought.providerId);
  await expect(analysisEntry).toHaveAttribute('data-source', 'provider');
  const visibleAnalysis = page.getByTestId(`observer-analysis-visible-${providerThought.id}`);
  await expect(visibleAnalysis).toContainText(providerThought.visibleAnalysis ?? '');
  await expectMinimumFontSize(visibleAnalysis.locator('p'), 16, 'mobile observer visible analysis');
  await expectTextWrapsWithoutClipping(
    visibleAnalysis.locator('p'),
    'mobile observer visible analysis',
  );
  await expectMinimumFontSize(
    page.getByTestId('observer-analysis-title'),
    20,
    'mobile observer analysis title',
  );
  await expectMinimumTouchTarget(
    page.getByTestId('observer-analysis-close'),
    44,
    'mobile AI analysis close button',
  );
  await expectNoHorizontalOverflow(page, 'mobile AI observer analysis drawer');

  await page.getByTestId('observer-analysis-close').click();
  await expect(analysisDrawer).toBeHidden();
  await expect(analysisTrigger).toBeFocused();
  await expectNoHorizontalOverflow(page, 'mobile AI observer match');

  for (const event of transcript.events.filter(({ name }) =>
    ['room.snapshot', 'game.event', 'ai.status'].includes(name),
  )) {
    expect(event.raw).not.toContain('"visibleAnalysis"');
  }
  expectAuditClean(audit);
});
