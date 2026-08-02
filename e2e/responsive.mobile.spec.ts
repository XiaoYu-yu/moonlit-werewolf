import { expect, test } from '@playwright/test';

import { expectNoHorizontalOverflow } from './support/layout';
import { auditPage, expectAuditClean } from './support/page-audit';

test('390x844 home and every demo stage stay inside the viewport', async ({ page }) => {
  const audit = auditPage(page);

  await page.goto('/');
  await expect(page.getByTestId('home-entry')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'mobile home');

  await page.goto('/room/DEMO9?mode=demo');
  await expect(page.getByTestId('room-stage-lobby')).toBeVisible();
  await expectNoHorizontalOverflow(page, 'mobile lobby');

  const stages = [
    ['身份揭示', 'role'],
    ['白天讨论', 'day'],
    ['夜间行动', 'night'],
    ['对局结算', 'result'],
  ] as const;

  for (const [label, stage] of stages) {
    await page
      .getByRole('navigation', { name: '本地演示阶段预览' })
      .getByRole('button', { name: label })
      .click();
    await expect(page.getByTestId(`room-stage-${stage}`)).toBeVisible();
    await expectNoHorizontalOverflow(page, `mobile ${stage}`);
  }

  expectAuditClean(audit);
});
