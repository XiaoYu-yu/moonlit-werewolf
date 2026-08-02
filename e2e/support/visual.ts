import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import type { Page } from '@playwright/test';

const STABLE_VISUAL_STYLE = `
  html {
    scroll-behavior: auto !important;
  }

  *,
  *::before,
  *::after {
    animation-delay: 0s !important;
    animation-duration: 0s !important;
    caret-color: transparent !important;
    transition-delay: 0s !important;
    transition-duration: 0s !important;
  }

  canvas {
    visibility: hidden !important;
  }
`;

export async function stabilizeVisuals(page: Page): Promise<void> {
  await page.addStyleTag({ content: STABLE_VISUAL_STYLE });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, (image) =>
        image.complete ? Promise.resolve() : image.decode().catch(() => undefined),
      ),
    );
  });
}

export async function saveEvidenceScreenshot(page: Page, filename: string): Promise<void> {
  const directory = path.join(process.cwd(), 'output', 'playwright');
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, filename),
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
  });
}
