import { expect, test } from '@playwright/test';

import { auditPage, expectAuditClean } from './support/page-audit';
import { E2E_API_URL } from './support/test-environment';

test('API failure offers an explicit local-demo fallback', async ({ page }) => {
  const unavailableApi = new RegExp(`^${E2E_API_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`);
  const audit = auditPage(page, { ignoreUrls: [unavailableApi] });
  await page.route(`${E2E_API_URL}/**`, (route) => route.abort('connectionrefused'));

  await page.goto('/');
  await page.getByLabel('你的称呼').fill('离线旅人');
  await page.getByLabel('建房邀请码').fill('E2E-MOONLIT-INVITE');
  await page.getByRole('button', { name: '6 人局' }).click();
  await page.getByTestId('home-submit').click();

  await expect(page.getByTestId('home-feedback')).toContainText('暂时无法连接游戏服务器');
  await page.getByRole('button', { name: '进入本地演示' }).click();
  await expect(page).toHaveURL(/\/room\/DEMO6\?mode=demo$/);
  await expect(page.getByTestId('room-connection-mode')).toContainText('本地演示模式');
  await expect(page.getByTestId('room-stage-lobby')).toBeVisible();
  expectAuditClean(audit, {
    allowedConsoleErrors: [/ERR_CONNECTION_REFUSED/],
  });
});

test('home mode tabs and field errors expose keyboard and focus semantics', async ({ page }) => {
  await page.goto('/');

  const createTab = page.getByRole('tab', { name: /创建房间/ });
  const joinTab = page.getByRole('tab', { name: /加入房间/ });
  await expect(createTab).toHaveAttribute('tabindex', '0');
  await expect(joinTab).toHaveAttribute('tabindex', '-1');

  await createTab.focus();
  await createTab.press('ArrowRight');
  await expect(joinTab).toBeFocused();
  await expect(joinTab).toHaveAttribute('aria-selected', 'true');

  await page.getByTestId('home-submit').click();
  const nickname = page.getByLabel('你的称呼');
  await expect(nickname).toBeFocused();
  await expect(nickname).toHaveAttribute('aria-invalid', 'true');
  await expect(nickname).toHaveAttribute('aria-describedby', 'home-form-error');
  await expect(page.getByTestId('home-feedback')).toHaveAttribute('id', 'home-form-error');
});

test('explicit demo route completes all five UI stages locally', async ({ page }) => {
  const audit = auditPage(page);
  await page.goto('/room/DEMO9?mode=demo');

  const connectionMode = page.getByTestId('room-connection-mode');
  await expect(connectionMode).toContainText('本地演示模式');
  await expect(connectionMode).not.toHaveAttribute('aria-live', /.+/);
  await expect(page.getByTestId('room-stage-lobby')).toBeVisible();
  await page.getByRole('button', { name: '所有人已准备 · 开始演示' }).click();

  await expect(page.getByTestId('room-stage-role')).toBeVisible();
  await page.getByRole('button', { name: '翻开身份牌' }).click();
  const revealedRoleCard = page.getByRole('button', { name: '预言家身份牌' });
  await expect(revealedRoleCard).toBeVisible();
  await expect(revealedRoleCard).toHaveCSS('opacity', '1');
  await page.getByRole('button', { name: '我已记住 · 提交确认' }).click();

  await expect(page.getByTestId('room-stage-day')).toBeVisible();
  await expect(page.getByRole('heading', { name: '白天讨论与放逐投票' })).toBeAttached();
  await expect(page.locator('button.table-seat')).toHaveCount(8);
  await expect(page.locator('article.table-seat')).toHaveCount(1);
  await page.getByTestId('chat-input').fill('这是一条仅在本地保存的演示发言');
  await page.getByTestId('chat-send').click();
  await expect(page.getByText('这是一条仅在本地保存的演示发言', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /预览夜间阶段/ }).click();

  await expect(page.getByTestId('room-stage-night')).toBeVisible();
  await page.locator('.target-card').first().click();
  await page.getByRole('button', { name: /确认查验 \d+ 号/ }).click();

  await expect(page.getByTestId('room-stage-result')).toBeVisible();
  await expect(page.getByRole('heading', { name: '好人阵营胜利' })).toBeVisible();
  await page.getByRole('button', { name: /再来一局/ }).click();
  await expect(page.getByTestId('room-stage-lobby')).toBeVisible();
  expectAuditClean(audit);
});
