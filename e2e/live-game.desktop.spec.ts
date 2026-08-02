import { expect, test, type Page } from '@playwright/test';

import { expectNoHorizontalOverflow } from './support/layout';
import { auditPage, expectAuditClean } from './support/page-audit';
import {
  latestSocketEvent,
  recordSocketTranscript,
  waitForSocketEvent,
  type SocketTranscript,
} from './support/socket-transcript';

const INVITE_CODE = 'E2E-MOONLIT-INVITE';
const HUMAN_MESSAGE = '一号真人发言：这是实时权威对局，不是本地演示。';

interface SeatSnapshot {
  readonly id: string;
  readonly number: number;
  readonly kind: 'human' | 'ai' | 'ai_takeover';
  readonly nickname: string;
}

interface RoomSnapshot {
  readonly code: string;
  readonly phase: string;
  readonly status: string;
  readonly version: number;
  readonly seats: readonly SeatSnapshot[];
  readonly game?: {
    readonly phase: string;
    readonly round: number;
    readonly players: readonly {
      readonly id: string;
      readonly alive: boolean;
      readonly revealedRole?: string;
    }[];
  };
}

interface PrivateState {
  readonly playerId: string;
  readonly role: 'werewolf' | 'seer' | 'witch' | 'villager';
  readonly alive: boolean;
  readonly legalActions: readonly string[];
  readonly legalTargetIds: readonly string[];
}

interface GameEvent {
  readonly type: string;
  readonly actorId?: string;
  readonly message?: string;
}

async function submitHumanNightAction(page: Page, role: PrivateState['role']): Promise<void> {
  if (role === 'villager') return;

  if (role === 'witch') {
    const heal = page.getByRole('button', { name: /使用解药救 \d+ 号/ });
    const skip = page.getByRole('button', { name: '放弃本次行动' });
    await expect(skip).toBeVisible({ timeout: 12_000 });
    if (await heal.isVisible()) {
      await heal.click();
    } else {
      await skip.click();
    }
    return;
  }

  const target = page.locator('.target-card').first();
  await expect(target).toBeVisible({ timeout: 12_000 });
  await target.click();
  const confirm = page.locator('.night-action-buttons .primary-button');
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

async function submitHumanVoteIfEligible(
  page: Page,
  transcript: SocketTranscript,
  privateState: PrivateState,
  afterIndex: number,
  humanAlive: boolean,
): Promise<boolean> {
  if (!humanAlive) return false;

  await waitForSocketEvent<PrivateState>(
    transcript,
    'player.private_state',
    (state) => state.playerId === privateState.playerId && state.legalActions.includes('day_vote'),
    {
      afterIndex,
      timeout: 8_000,
      description: 'waiting for the living human voter private action',
    },
  );

  const target = page.locator('.vote-candidate:not([disabled])').first();
  await expect(target).toBeVisible();
  await target.click();
  const confirm = page.getByRole('button', { name: /确认投给 \d+ 号/ });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  return true;
}

test('one human and five AI reach authoritative voting in a live match', async ({ page }) => {
  test.setTimeout(75_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const audit = auditPage(page);
  const transcript = recordSocketTranscript(page);

  await page.goto('/');
  await page.getByLabel('你的称呼').fill('权威一号');
  await page.getByLabel('建房邀请码').fill(INVITE_CODE);
  await page.getByRole('button', { name: '6 人局' }).click();
  await page.getByTestId('home-submit').click();

  await expect(page).toHaveURL(/\/room\/[A-Z0-9_-]+\?mode=live$/);
  await expect(page.getByTestId('room-connection-mode')).toContainText('实时房间已连接');
  await expect(page.getByTestId('room-connection-mode')).not.toContainText('本地演示');
  await expect(page.getByTestId('room-stage-lobby')).toBeVisible();
  await expect(page.locator('.seat-card.human')).toHaveCount(1);
  await expect(page.locator('.seat-card.ai')).toHaveCount(5);
  await expect(page.locator('select[name^="seat-"][name$="-model"]')).toHaveCount(5);
  await expect(page.locator('select[name^="seat-"][name$="-personality"]')).toHaveCount(5);
  await expectNoHorizontalOverflow(page, 'live six-player lobby');

  const roomCode = (await page.locator('.room-code strong').innerText()).trim();
  const aiConfigurationRequest = page.waitForRequest(
    (request) =>
      request.method() === 'PUT' &&
      request.url().includes('/api/v1/rooms/') &&
      request.url().endsWith('/ai-seats'),
  );
  const startRequest = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes('/api/v1/rooms/') &&
      response.url().endsWith('/start'),
  );
  await page.getByRole('button', { name: '补齐 AI 并开始实时对局' }).click();

  const aiRequest = await aiConfigurationRequest;
  const aiBody = aiRequest.postDataJSON() as { seats: readonly { seatNumber: number }[] };
  expect(aiBody.seats).toHaveLength(5);
  expect(aiBody.seats.map((seat) => seat.seatNumber)).toEqual([2, 3, 4, 5, 6]);
  expect((await startRequest).status()).toBe(201);

  await expect(page.getByTestId('room-stage-role')).toBeVisible();
  const roleSnapshotEvent = await waitForSocketEvent<RoomSnapshot>(
    transcript,
    'room.snapshot',
    (room) => room.code === roomCode && room.phase === 'role_reveal',
    { description: 'waiting for authoritative role-reveal snapshot' },
  );
  const privateEvent = await waitForSocketEvent<PrivateState>(
    transcript,
    'player.private_state',
    (state) => typeof state?.role === 'string' && state.legalActions.includes('acknowledge_role'),
    { description: 'waiting for player-specific role state' },
  );
  const privateState = privateEvent.payload;
  const publicRoleSnapshot = JSON.stringify(roleSnapshotEvent.payload);
  expect(privateState.playerId).toBe(roleSnapshotEvent.payload.seats[0]?.id);
  expect(publicRoleSnapshot).not.toContain('"role":');
  expect(publicRoleSnapshot).not.toContain('"werewolfTeamIds"');
  expect(publicRoleSnapshot).not.toContain('"seerChecks"');
  await expectNoHorizontalOverflow(page, 'live role reveal');

  await page.getByRole('button', { name: '翻开身份牌' }).click();
  const revealedRole = (await page.locator('.role-card-front h2').innerText()).trim();
  expect(['狼人', '预言家', '女巫', '村民']).toContain(revealedRole);
  await expect(page.getByRole('button', { name: `${revealedRole}身份牌` })).toBeVisible();
  const nightStartedAt = Date.now();
  const nightEventIndex = transcript.events.length;
  await page.getByRole('button', { name: '我已记住 · 提交确认' }).click();

  const publicNight = await waitForSocketEvent<RoomSnapshot>(
    transcript,
    'room.snapshot',
    (room) => room.code === roomCode && room.phase === 'night',
    {
      afterIndex: nightEventIndex,
      description: 'waiting for coarse public night snapshot',
    },
  );
  expect(publicNight.payload.game?.phase).toBe('night');
  expect(JSON.stringify(publicNight.payload)).not.toMatch(/night_(guard|werewolves|seer|witch)/);
  if (privateState.role !== 'villager') {
    await expect(page.getByTestId('room-stage-night')).toBeVisible({ timeout: 12_000 });
    await expectNoHorizontalOverflow(page, 'live night action');
  }

  await submitHumanNightAction(page, privateState.role);

  const dawn = await waitForSocketEvent<RoomSnapshot>(
    transcript,
    'room.snapshot',
    (room) => room.code === roomCode && room.phase === 'dawn',
    {
      afterIndex: nightEventIndex,
      timeout: 15_000,
      description: 'waiting for AI fallback actions to complete the first night',
    },
  );
  expect(dawn.receivedAt - nightStartedAt).toBeLessThan(15_000);
  await expect(page.getByTestId('room-stage-day')).toBeVisible();

  const publicHumanAliveAfterNight =
    dawn.payload.game?.players.find((player) => player.id === privateState.playerId)?.alive ===
    true;
  const postDawnPrivate = await waitForSocketEvent<PrivateState>(
    transcript,
    'player.private_state',
    (state) =>
      state.playerId === privateState.playerId && state.alive === publicHumanAliveAfterNight,
    {
      afterIndex: nightEventIndex,
      description: 'waiting for private alive state after the first night',
    },
  );
  const humanAliveAfterNight = postDawnPrivate.payload.alive;
  expect(humanAliveAfterNight).toBe(publicHumanAliveAfterNight);

  const chatInput = page.getByTestId('chat-input');
  await expect(chatInput).toBeEnabled({ timeout: 15_000 });
  const speakingPrivate = await waitForSocketEvent<PrivateState>(
    transcript,
    'player.private_state',
    (state) =>
      state.playerId === privateState.playerId && state.legalActions.includes('finish_speech'),
    {
      afterIndex: nightEventIndex,
      description: humanAliveAfterNight
        ? 'waiting for the living human discussion turn'
        : 'waiting for the eliminated human last-words turn',
    },
  );
  expect(speakingPrivate.payload.alive).toBe(humanAliveAfterNight);
  await expect(
    page.locator(
      humanAliveAfterNight
        ? '[data-phase-detail="discussion"]'
        : '[data-phase-detail="last-words"]',
    ),
  ).toBeVisible();
  if (humanAliveAfterNight) {
    const discussion = page.locator('[data-phase-detail="discussion"]');
    await expect(discussion.getByRole('heading', { name: '白天讨论与放逐投票' })).toBeAttached();
    await expect(discussion.locator('button.table-seat')).toHaveCount(0);
    await expect(discussion.locator('article.table-seat')).toHaveCount(6);
  }
  await chatInput.fill(HUMAN_MESSAGE);
  await page.getByTestId('chat-send').click();
  await expect(page.getByText(HUMAN_MESSAGE, { exact: true })).toBeVisible();
  const humanChat = await waitForSocketEvent<GameEvent>(
    transcript,
    'game.event',
    (event) =>
      event.type === 'chat.message' &&
      event.actorId === privateState.playerId &&
      event.message === HUMAN_MESSAGE,
    { description: 'waiting for authoritative human chat broadcast' },
  );
  expect(humanChat.payload.actorId).toBe(privateState.playerId);
  await expectNoHorizontalOverflow(page, 'live public discussion');

  const votingEventIndex = transcript.events.length;
  await page
    .getByRole('button', { name: humanAliveAfterNight ? '完成本轮发言' : '完成遗言' })
    .click();
  await waitForSocketEvent<GameEvent>(
    transcript,
    'game.event',
    (event) =>
      event.type === 'ai.action' &&
      event.actorId !== privateState.playerId &&
      typeof event.message === 'string',
    {
      afterIndex: votingEventIndex,
      timeout: 15_000,
      description: 'waiting for an automatic AI public discussion message',
    },
  );
  const voting = await waitForSocketEvent<RoomSnapshot>(
    transcript,
    'room.snapshot',
    (room) => room.code === roomCode && room.phase === 'voting',
    {
      afterIndex: votingEventIndex,
      timeout: 15_000,
      description: 'waiting for authoritative day voting phase',
    },
  );
  expect(voting.payload.status).toBe('playing');
  const humanAliveAtVoting =
    voting.payload.game?.players.find((player) => player.id === privateState.playerId)?.alive ===
    true;

  if (humanAliveAtVoting) {
    await expect(page.locator('[data-phase-detail="voting"]')).toBeVisible();
    await expect(page.getByText(/未公开的实时票数不会显示/)).toBeVisible();
  }

  const humanVoted = await submitHumanVoteIfEligible(
    page,
    transcript,
    privateState,
    votingEventIndex,
    humanAliveAtVoting,
  );
  if (humanVoted) {
    await waitForSocketEvent<GameEvent>(
      transcript,
      'game.event',
      (event) => event.type === 'action.accepted',
      {
        afterIndex: votingEventIndex,
        description: 'waiting for authoritative human vote acceptance',
      },
    );
  }

  const resultVisible = await page
    .getByTestId('room-stage-result')
    .waitFor({ state: 'visible', timeout: 8_000 })
    .then(() => true)
    .catch(() => false);
  const ended = latestSocketEvent<RoomSnapshot>(
    transcript,
    'room.snapshot',
    (room) => room.code === roomCode && room.status === 'finished' && room.phase === 'ended',
    votingEventIndex,
  );
  expect(resultVisible).toBe(ended !== undefined);
  if (ended) {
    await expect(page.getByRole('heading', { name: /阵营胜利/ })).toBeVisible();
    expect(ended.payload.game?.players).toHaveLength(6);
    expect(ended.payload.game?.players.every((player) => player.revealedRole !== undefined)).toBe(
      true,
    );
    await expectNoHorizontalOverflow(page, 'live match result');
  } else {
    await expect(page.getByTestId('room-connection-mode')).toContainText('实时房间已连接');
    const latestRoom = latestSocketEvent<RoomSnapshot>(
      transcript,
      'room.snapshot',
      (room) => room.code === roomCode,
      votingEventIndex,
    );
    expect(latestRoom?.payload.phase).not.toBe('lobby');
    expect(latestRoom?.payload.phase).not.toBe('role_reveal');
  }

  const liveSnapshots = transcript.events.filter(
    (event) =>
      event.name === 'room.snapshot' &&
      (event.payload as RoomSnapshot | undefined)?.code === roomCode,
  );
  expect(liveSnapshots.length).toBeGreaterThan(5);
  expectAuditClean(audit);
});
