import { expect, test } from '@playwright/test';

import { auditPage, expectAuditClean } from './support/page-audit';
import { saveEvidenceScreenshot, stabilizeVisuals } from './support/visual';

test('desktop home matches its visual regression baseline', async ({ page }) => {
  const audit = auditPage(page);
  await page.goto('/');
  await expect(page.getByTestId('home-entry')).toBeVisible();
  await page.waitForLoadState('networkidle');
  await stabilizeVisuals(page);

  await expect(page).toHaveScreenshot('desktop-home.png', {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    threshold: 0.25,
    maxDiffPixelRatio: 0.03,
  });
  await saveEvidenceScreenshot(page, 'desktop-home.png');
  expectAuditClean(audit);
});
