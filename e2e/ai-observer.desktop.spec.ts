import { expect, test } from '@playwright/test';

import { expectNoHorizontalOverflow } from './support/layout';
import { auditPage, expectAuditClean } from './support/page-audit';
import { recordSocketTranscript, waitForSocketEvent } from './support/socket-transcript';

const INVITE_CODE = 'E2E-MOONLIT-INVITE';

interface ObserverRole {
  readonly playerId: string;
  readonly seatNumber: number;
  readonly nickname: string;
  readonly role: string;
  readonly providerId: 'deepseek' | 'kimi';
  readonly modelId: string;
}

interface ObserverState {
  readonly connected: true;
  readonly isObserver: true;
  readonly mode: 'ai_observer';
  readonly phase: string;
  readonly round: number;
  readonly roles: readonly ObserverRole[];
  readonly actions: readonly {
    readonly sequence: number;
    readonly kind: string;
  }[];
}

interface RoomSnapshot {
  readonly code: string;
  readonly mode: 'standard' | 'ai_observer';
  readonly phase: string;
  readonly status: string;
  readonly seats: readonly {
    readonly id: string;
    readonly number: number;
    readonly kind: 'human' | 'ai' | 'ai_takeover';
    readonly ai?: {
      readonly providerId: string;
      readonly modelId: string;
    };
  }[];
  readonly game?: {
    readonly round: number;
    readonly players: readonly {
      readonly id: string;
      readonly alive: boolean;
      readonly revealedRole?: string;
    }[];
  };
}

test('host creates and watches a six-seat authoritative AI-only match', async ({ page }) => {
  test.setTimeout(75_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const audit = auditPage(page);
  const transcript = recordSocketTranscript(page);

  await page.goto('/');
  await page.getByRole('tab', { name: 'AI 观战局' }).click();
  await page.getByLabel('建房邀请码').fill(INVITE_CODE);
  await page.getByRole('button', { name: '6 人局' }).click();

  const modelSelects = page.getByLabel(/\d+ 号模型/);
  await expect(modelSelects).toHaveCount(6);
  await page.getByLabel('1 号模型').selectOption('kimi');
  await page.getByLabel('2 号模型').selectOption('deepseek');

  const requestPromise = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/rooms/ai-observer'),
  );
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().endsWith('/api/v1/rooms/ai-observer'),
  );
  await page.getByTestId('home-submit').click();

  const [request, response] = await Promise.all([requestPromise, responsePromise]);
  expect(response.status()).toBe(201);
  const body = request.postDataJSON() as {
    preset: number;
    lineup: readonly {
      seatNumber: number;
      providerId: string;
      modelId: string;
    }[];
  };
  expect(body.preset).toBe(6);
  expect(body.lineup).toHaveLength(6);
  expect(body.lineup.map((seat) => seat.seatNumber)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(new Set(body.lineup.map((seat) => seat.providerId))).toEqual(
    new Set(['deepseek', 'kimi']),
  );
  expect(
    body.lineup.every(
      (seat) =>
        (seat.providerId === 'kimi' && seat.modelId === 'kimi-k2.6') ||
        (seat.providerId === 'deepseek' && seat.modelId === 'deepseek-v4-flash'),
    ),
  ).toBe(true);

  await expect(page).toHaveURL(/\/room\/[A-Z0-9_-]+\?mode=live$/);
  await expect(page.getByTestId('observer-connection-mode')).toContainText('全知观察者');
  await expect(page.getByText('观察者私密数据')).toBeVisible();
  await expect(page.locator('.observer-role-grid article')).toHaveCount(6);
  await expectNoHorizontalOverflow(page, 'AI-only observer room');

  const observer = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) =>
      state.isObserver === true &&
      state.mode === 'ai_observer' &&
      state.roles.length === 6 &&
      new Set(state.roles.map((role) => role.playerId)).size === 6,
    {
      timeout: 15_000,
      description: 'waiting for authenticated omniscient observer state',
    },
  );
  expect(observer.payload.roles.every((role) => typeof role.role === 'string')).toBe(true);
  expect(new Set(observer.payload.roles.map((role) => role.providerId))).toEqual(
    new Set(['deepseek', 'kimi']),
  );

  const publicSnapshot = await waitForSocketEvent<RoomSnapshot>(
    transcript,
    'room.snapshot',
    (room) => room.mode === 'ai_observer' && room.seats.length === 6,
    { description: 'waiting for AI-only public room snapshot' },
  );
  expect(publicSnapshot.payload.seats.every((seat) => seat.kind === 'ai')).toBe(true);
  expect(JSON.stringify(publicSnapshot.payload)).not.toContain('"role":');
  expect(JSON.stringify(publicSnapshot.payload)).not.toContain('"actions":');

  const observerAdvanced = await waitForSocketEvent<ObserverState>(
    transcript,
    'observer.private_state',
    (state) =>
      state.mode === 'ai_observer' &&
      state.actions.some((event) => event.kind === 'action.accepted') &&
      (state.phase !== 'role_reveal' || state.round > 1),
    {
      timeout: 25_000,
      description: 'waiting for the AI-only match to advance without a human action',
    },
  );
  expect(observerAdvanced.payload.actions.length).toBeGreaterThan(0);
  await expect(page.locator('.observer-action-feed li').first()).toBeVisible();

  const leakedPlayerPrivateRole = transcript.events.some(
    (event) =>
      event.name === 'player.private_state' &&
      typeof event.payload === 'object' &&
      event.payload !== null &&
      'role' in event.payload,
  );
  expect(leakedPlayerPrivateRole).toBe(false);
  expectAuditClean(audit);
});
