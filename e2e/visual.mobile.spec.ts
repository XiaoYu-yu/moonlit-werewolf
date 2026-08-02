import { expect, test } from '@playwright/test';

import { auditPage, expectAuditClean } from './support/page-audit';
import { saveEvidenceScreenshot, stabilizeVisuals } from './support/visual';

test('390x844 demo lobby matches its visual regression baseline', async ({ page }) => {
  const audit = auditPage(page);
  await page.goto('/room/DEMO9?mode=demo');
  await expect(page.getByTestId('room-stage-lobby')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await stabilizeVisuals(page);

  await expect(page).toHaveScreenshot('mobile-demo-lobby.png', {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    threshold: 0.25,
    maxDiffPixelRatio: 0.035,
  });
  await saveEvidenceScreenshot(page, 'mobile-demo-lobby.png');
  expectAuditClean(audit);
});
