import { expect, test } from '@playwright/test';

import { auditPage, expectAuditClean } from './support/page-audit';
import { E2E_WEB_URL } from './support/test-environment';

const INVITE_CODE = 'E2E-MOONLIT-INVITE';

test('two isolated browser sessions create and join the same live room', async ({ browser }) => {
  const hostContext = await browser.newContext({
    baseURL: E2E_WEB_URL,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
  });
  const guestContext = await browser.newContext({
    baseURL: E2E_WEB_URL,
    locale: 'zh-CN',
    viewport: { width: 1440, height: 1000 },
  });
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  const hostAudit = auditPage(hostPage);
  const guestAudit = auditPage(guestPage);

  try {
    await hostPage.goto('/');
    await hostPage.getByLabel('你的称呼').fill('月痕房主');
    await hostPage.getByLabel('建房邀请码').fill(INVITE_CODE);
    await hostPage.getByRole('button', { name: '6 人局' }).click();
    await hostPage.getByTestId('home-submit').click();

    await expect(hostPage).toHaveURL(/\/room\/[A-Z0-9_-]+\?mode=live$/);
    const hostConnectionMode = hostPage.getByTestId('room-connection-mode');
    await expect(hostConnectionMode).toContainText('实时房间已连接');
    await expect(hostConnectionMode).not.toContainText('本地演示');
    await expect(hostConnectionMode).not.toHaveAttribute('aria-live', /.+/);
    const liveProgress = hostPage.getByRole('navigation', { name: '实时对局进度' });
    await expect(liveProgress.locator('ol')).toBeVisible();
    await expect(liveProgress.getByRole('button')).toHaveCount(0);
    await expect(liveProgress.locator('li[aria-current="step"]')).toContainText('房间大厅');
    const roomCode = (await hostPage.locator('.room-code strong').innerText()).trim();
    expect(roomCode).toMatch(/^[A-Z0-9_-]{4,12}$/);

    await guestPage.goto('/');
    await guestPage.getByRole('tab', { name: '加入房间' }).click();
    await guestPage.getByLabel('你的称呼').fill('雾行客');
    await guestPage.getByRole('textbox', { name: '房间码' }).fill(roomCode);
    await guestPage.getByTestId('home-submit').click();

    await expect(guestPage).toHaveURL(new RegExp(`/room/${roomCode}\\?mode=live$`));
    await expect(guestPage.getByTestId('room-connection-mode')).toContainText('实时房间已连接');
    await expect(guestPage.getByTestId('room-connection-mode')).not.toContainText('本地演示');

    for (const page of [hostPage, guestPage]) {
      const humanSeats = page.locator('.seat-card.human');
      await expect(humanSeats).toHaveCount(2);
      await expect(humanSeats.getByText('月痕房主', { exact: true })).toBeVisible();
      await expect(humanSeats.getByText('雾行客', { exact: true })).toBeVisible();
    }

    expectAuditClean(hostAudit);
    expectAuditClean(guestAudit);
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});
