import { expect, test } from '@playwright/test';

import { auditPage, expectAuditClean } from './support/page-audit';

const ADMIN_KEY = 'dev-admin-key';

test('home mode tabs wrap in both directions with one roving tab stop', async ({ page }) => {
  const audit = auditPage(page);
  await page.goto('/');

  const tabList = page.getByRole('tablist');
  const createTab = tabList.getByRole('tab', { name: /创建房间/ });
  const observerTab = tabList.getByRole('tab', { name: /AI 观战局/ });

  await expect(tabList.getByRole('tab')).toHaveCount(3);
  await createTab.focus();
  await createTab.press('ArrowLeft');

  await expect(observerTab).toBeFocused();
  await expect(observerTab).toHaveAttribute('aria-selected', 'true');
  await expect(tabList.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'home-mode-observe');

  await observerTab.press('ArrowRight');
  await expect(createTab).toBeFocused();
  await expect(createTab).toHaveAttribute('aria-selected', 'true');
  await expect(tabList.locator('[role="tab"][tabindex="0"]')).toHaveCount(1);
  expectAuditClean(audit);
});

test('provider dialog traps focus and Escape restores its trigger', async ({ page }) => {
  const audit = auditPage(page);
  await page.goto('/admin/models');
  await page.getByTestId('admin-key').fill(ADMIN_KEY);
  await page.getByRole('button', { name: '读取实时后台' }).click();
  await expect(page.locator('.provider-row')).toHaveCount(2);

  const trigger = page.getByRole('button', { name: '配置 DeepSeek' });
  await trigger.click();

  const dialog = page.getByTestId('admin-provider-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('role', 'dialog');
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);

  for (let step = 0; step < 12; step += 1) {
    await page.keyboard.press('Tab');
    expect(
      await dialog.evaluate((element) => element.contains(document.activeElement)),
      `focus escaped the provider dialog after Tab ${step + 1}`,
    ).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expectAuditClean(audit);
});
