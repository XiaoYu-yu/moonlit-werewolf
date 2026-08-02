import { expect, type Locator, type Page } from '@playwright/test';

interface OverflowReport {
  readonly viewportWidth: number;
  readonly scrollWidth: number;
  readonly possibleOffenders: readonly string[];
}

export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const report = await page.evaluate<OverflowReport>(() => {
    const root = document.documentElement;
    const viewportWidth = root.clientWidth;
    const possibleOffenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return rect.right > viewportWidth + 1 || rect.left < -1;
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

    return {
      viewportWidth,
      scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
      possibleOffenders,
    };
  });

  expect(
    report.scrollWidth,
    `${label} horizontally overflows ${report.viewportWidth}px; candidates: ${report.possibleOffenders.join(', ') || 'none'}`,
  ).toBeLessThanOrEqual(report.viewportWidth + 1);
}

interface FontSizeReport {
  readonly text: string;
  readonly fontSize: number;
}

export async function expectMinimumFontSize(
  locator: Locator,
  minimumPx: number,
  label: string,
): Promise<void> {
  const report = await locator.evaluateAll<FontSizeReport[], { minimumPx: number }>(
    (elements, { minimumPx }) =>
      elements
        .filter((element) => {
          const htmlElement = element;
          const style = getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        })
        .map((element) => ({
          text: (element.textContent ?? '').trim().slice(0, 80),
          fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
        }))
        .filter(({ fontSize }) => !Number.isFinite(fontSize) || fontSize < minimumPx),
    { minimumPx },
  );

  expect(
    report,
    `${label} contains text below ${minimumPx}px: ${report
      .map(({ text, fontSize }) => `"${text}" (${fontSize}px)`)
      .join(', ')}`,
  ).toEqual([]);
}

interface TouchTargetReport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
}

export async function expectMinimumTouchTarget(
  locator: Locator,
  minimumPx: number,
  label: string,
): Promise<void> {
  const report = await locator.evaluateAll<TouchTargetReport[], { minimumPx: number }>(
    (elements, { minimumPx }) =>
      elements
        .filter((element) => {
          const htmlElement = element;
          const style = getComputedStyle(htmlElement);
          const rect = htmlElement.getBoundingClientRect();
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            rect.width > 0 &&
            rect.height > 0
          );
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label:
              element.getAttribute('aria-label') ??
              (element.textContent ?? '').trim().slice(0, 80) ??
              element.tagName.toLowerCase(),
            width: rect.width,
            height: rect.height,
          };
        })
        .filter(({ width, height }) => width + 0.5 < minimumPx || height + 0.5 < minimumPx),
    { minimumPx },
  );

  expect(
    report,
    `${label} contains touch targets below ${minimumPx}×${minimumPx}px: ${report
      .map(
        ({ label: targetLabel, width, height }) =>
          `"${targetLabel}" (${Math.round(width)}×${Math.round(height)})`,
      )
      .join(', ')}`,
  ).toEqual([]);
}

interface TextWrapReport {
  readonly clientWidth: number;
  readonly scrollWidth: number;
  readonly lineClamp: string;
  readonly overflow: string;
  readonly textLength: number;
  readonly whiteSpace: string;
}

export async function expectTextWrapsWithoutClipping(
  locator: Locator,
  label: string,
): Promise<void> {
  const report = await locator.evaluate<TextWrapReport>((element) => {
    const style = getComputedStyle(element);
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      lineClamp: style.getPropertyValue('-webkit-line-clamp'),
      overflow: style.overflow,
      textLength: (element.textContent ?? '').length,
      whiteSpace: style.whiteSpace,
    };
  });

  expect(report.textLength, `${label} should contain stress text`).toBeGreaterThan(0);
  expect(
    report.scrollWidth,
    `${label} has horizontal text overflow (${report.scrollWidth}px > ${report.clientWidth}px)`,
  ).toBeLessThanOrEqual(report.clientWidth + 1);
  expect(report.lineClamp, `${label} must not line-clamp long content`).toMatch(/^$|^none$/);
  expect(report.whiteSpace, `${label} must allow wrapping`).not.toBe('nowrap');
  expect(report.overflow, `${label} must not clip long content`).not.toBe('hidden');
}

export async function expectInsideViewport(locator: Locator, label: string): Promise<void> {
  const report = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    };
  });

  expect(report.left, `${label} starts left of the viewport`).toBeGreaterThanOrEqual(-1);
  expect(report.right, `${label} ends right of the viewport`).toBeLessThanOrEqual(
    report.viewportWidth + 1,
  );
  expect(report.top, `${label} starts above the viewport`).toBeGreaterThanOrEqual(-1);
  expect(report.bottom, `${label} ends below the viewport`).toBeLessThanOrEqual(
    report.viewportHeight + 1,
  );
}
