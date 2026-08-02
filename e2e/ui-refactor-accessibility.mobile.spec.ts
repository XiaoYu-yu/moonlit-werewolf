import { expect, test, type Page } from '@playwright/test';

import { expectInsideViewport, expectNoHorizontalOverflow } from './support/layout';
import { auditPage, expectAuditClean } from './support/page-audit';

const ADMIN_KEY = 'dev-admin-key';
const INVITE_CODE = 'E2E-MOONLIT-INVITE';

async function expectNoContentHorizontalOverflow(page: Page, label: string): Promise<void> {
  const report = await page.evaluate(async () => {
    const clientWidth = document.documentElement.clientWidth;
    const rightOffenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          !element.closest('[aria-hidden="true"]') &&
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.right > clientWidth + 1
        );
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const identity = element.id
          ? `#${element.id}`
          : element.className
            ? `.${String(element.className).trim().replace(/\s+/g, '.')}`
            : element.tagName.toLowerCase();
        return `${identity} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`;
      });

    const previousY = window.scrollY;
    window.scrollTo({ left: 9_999, top: previousY });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const horizontalScrollDistance = window.scrollX;
    window.scrollTo({ left: 0, top: previousY });

    return {
      bodyScrollWidth: document.body.scrollWidth,
      clientWidth,
      horizontalScrollDistance,
      rightOffenders,
    };
  });

  // On Windows Chromium, documentElement.scrollWidth includes the vertical scrollbar gutter
  // (9px in the 320px project) even when content cannot scroll horizontally. Body width, visible
  // element bounds, and an actual scroll attempt together test the content boundary without that
  // browser-owned gutter.
  expect(
    report.bodyScrollWidth,
    `${label} body content exceeds ${report.clientWidth}px`,
  ).toBeLessThanOrEqual(report.clientWidth);
  expect(report.rightOffenders, `${label} has accessible content beyond the right edge`).toEqual(
    [],
  );
  expect(report.horizontalScrollDistance, `${label} can scroll horizontally`).toBe(0);
}

test('390px provider bottom sheet stays in bounds and returns focus when closed', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const audit = auditPage(page);
  await page.goto('/admin/models');
  await page.getByTestId('admin-key').fill(ADMIN_KEY);
  await page.getByRole('button', { name: '读取实时后台' }).click();
  await expect(page.locator('.provider-row')).toHaveCount(2);
  await expectNoHorizontalOverflow(page, '390px loaded provider administration');

  const trigger = page.getByRole('button', { name: '配置 Kimi' });
  await trigger.click();
  const dialog = page.getByTestId('admin-provider-dialog');
  await expect(dialog).toBeVisible();
  await expectInsideViewport(dialog, '390px provider bottom sheet');
  await expectNoHorizontalOverflow(page, '390px provider bottom sheet');

  await page.getByRole('button', { name: '关闭供应商配置' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expectAuditClean(audit);
});

test.describe('320px compact layout', () => {
  test.use({ viewport: { width: 320, height: 720 } });

  test('home and observer header stay inside the viewport', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const audit = auditPage(page);

    await page.goto('/');
    await expect(page.getByTestId('home-entry')).toBeVisible();
    await expectNoContentHorizontalOverflow(page, '320px home');

    await page.getByRole('tab', { name: /AI 观战局/ }).click();
    await page.getByLabel('建房邀请码').fill(INVITE_CODE);
    await page.getByRole('button', { name: '6 人局' }).click();
    await expectNoContentHorizontalOverflow(page, '320px observer creation');
    await page.getByTestId('home-submit').click();

    await expect(page).toHaveURL(/\/room\/[A-Z0-9_-]+\?mode=live$/);
    await expect(page.getByTestId('observer-connection-mode')).toContainText('全知观察者');

    const header = page.locator('.observer-page .site-header');
    await expect(header).toBeVisible();
    await expectInsideViewport(header, '320px observer header');
    await expectInsideViewport(header.getByRole('link', { name: '返回狼人杀首页' }), '320px brand');
    await expectInsideViewport(header.locator('.header-room'), '320px room status');
    await expectInsideViewport(header.getByRole('button', { name: '游戏帮助' }), '320px help');
    await expectInsideViewport(header.getByRole('button', { name: '界面设置' }), '320px settings');
    await expectNoContentHorizontalOverflow(page, '320px observer room');
    expectAuditClean(audit);
  });
});
