import { chromium, type Locator, type Page } from '@playwright/test';

const webUrl = process.env.LIVE_WEB_URL?.trim() || 'http://localhost:3000';
const inviteCode = process.env.LIVE_INVITE_CODE?.trim() || 'MOONLIT-DEV';
const apiUrl = process.env.LIVE_API_URL?.trim();
const adminKey = process.env.LIVE_ADMIN_KEY?.trim();
const maxFailedAttempts = Math.max(
  0,
  Number.parseInt(process.env.LIVE_MAX_FAILED_ATTEMPTS ?? '0', 10) || 0,
);
const expectedProviders = [
  ...new Set(
    (process.env.LIVE_PROVIDER_IDS ?? 'kimi,deepseek')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value === 'kimi' || value === 'deepseek'),
  ),
];

if (expectedProviders.length === 0) {
  throw new Error('LIVE_PROVIDER_IDS must contain kimi and/or deepseek');
}

interface ProviderUsage {
  readonly providerId?: string;
  readonly calls?: number;
  readonly succeeded?: number;
  readonly failed?: number;
  readonly lastError?: string;
}

interface UsageSnapshot {
  readonly calls?: number;
  readonly succeeded?: number;
  readonly failed?: number;
  readonly providerUsage?: readonly ProviderUsage[];
}

interface ProviderUiEvidence {
  readonly provider: string;
  readonly summaryCharacters: number;
  readonly visibleAnalysisCharacters: number;
}

async function readUsage(): Promise<UsageSnapshot | undefined> {
  if (!apiUrl || !adminKey) return undefined;
  return (await fetch(`${apiUrl.replace(/\/$/, '')}/api/v1/admin/usage`, {
    headers: { 'x-admin-key': adminKey },
  }).then(async (response) => {
    if (!response.ok) {
      throw new Error(`Admin usage request failed with ${response.status}`);
    }
    return response.json();
  })) as UsageSnapshot;
}

function usageDelta(
  after: UsageSnapshot | undefined,
  before: UsageSnapshot | undefined,
): UsageSnapshot | undefined {
  if (!after) return undefined;
  const beforeProviders = new Map(
    before?.providerUsage?.map((item) => [item.providerId, item] as const) ?? [],
  );
  return {
    calls: (after.calls ?? 0) - (before?.calls ?? 0),
    succeeded: (after.succeeded ?? 0) - (before?.succeeded ?? 0),
    failed: (after.failed ?? 0) - (before?.failed ?? 0),
    providerUsage: after.providerUsage?.map((item) => {
      const previous = beforeProviders.get(item.providerId);
      const failed = (item.failed ?? 0) - (previous?.failed ?? 0);
      return {
        providerId: item.providerId,
        calls: (item.calls ?? 0) - (previous?.calls ?? 0),
        succeeded: (item.succeeded ?? 0) - (previous?.succeeded ?? 0),
        failed,
        ...(failed > 0 && item.lastError ? { lastError: item.lastError } : {}),
      };
    }),
  };
}

async function textCharacterCount(locator: Locator): Promise<number> {
  await locator.waitFor({ state: 'visible', timeout: 10_000 });
  return locator.evaluate((element) => {
    const text = element.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    return Array.from(text).length;
  });
}

async function inspectProviderUi(page: Page, provider: string): Promise<ProviderUiEvidence> {
  const thought = page
    .locator(
      `[data-testid^="observer-thought-"][data-source="provider"][data-provider-id="${provider}"]`,
    )
    .first();
  await thought.waitFor({ state: 'visible', timeout: 10_000 });

  const thoughtTestId = await thought.getAttribute('data-testid');
  const thoughtId = thoughtTestId?.replace(/^observer-thought-/, '');
  const seatText = await thought.locator('.observer-thought-seat').textContent();
  const seatNumber = Number.parseInt(seatText?.trim() ?? '', 10);
  if (!thoughtId || !Number.isInteger(seatNumber)) {
    throw new Error(`Could not resolve the ${provider} thought to an AI seat`);
  }

  const summaryCharacters = await textCharacterCount(thought.locator('.observer-thought-body > p'));
  if (summaryCharacters === 0) {
    throw new Error(`${provider} returned an empty decision summary`);
  }

  await page.getByTestId(`observer-seat-analysis-${seatNumber}`).click();
  const drawer = page.getByTestId('observer-analysis-drawer');
  await drawer.waitFor({ state: 'visible', timeout: 10_000 });

  const entry = drawer.getByTestId(`observer-analysis-entry-${thoughtId}`);
  await entry.waitFor({ state: 'visible', timeout: 10_000 });
  const entryProvider = await entry.getAttribute('data-provider-id');
  if (entryProvider !== provider) {
    throw new Error(`Expected ${provider} analysis but received ${entryProvider ?? 'unknown'}`);
  }

  const visibleAnalysisCharacters = await textCharacterCount(
    drawer.getByTestId(`observer-analysis-visible-${thoughtId}`).locator('p'),
  );
  if (visibleAnalysisCharacters === 0) {
    throw new Error(`${provider} returned an empty visible analysis`);
  }

  await page.getByTestId('observer-analysis-close').click();
  await drawer.waitFor({ state: 'hidden', timeout: 10_000 });

  return {
    provider,
    summaryCharacters,
    visibleAnalysisCharacters,
  };
}

async function main(): Promise<void> {
  const usageBefore = await readUsage();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      colorScheme: 'dark',
      locale: 'zh-CN',
      reducedMotion: 'reduce',
      viewport: { width: 1440, height: 1000 },
    });

    await page.goto(webUrl, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('home-observer-tab').click();
    await page.getByLabel('建房邀请码').fill(inviteCode);
    await page.getByTestId('observer-preset-6').click();

    for (let seatNumber = 1; seatNumber <= 6; seatNumber += 1) {
      const provider = expectedProviders[(seatNumber - 1) % expectedProviders.length];
      await page.getByTestId(`observer-seat-${seatNumber}-model`).selectOption(provider);
    }

    await page.getByTestId('home-submit').click();
    await page.waitForURL(/\/room\/[A-Z0-9_-]+\?mode=live$/, { timeout: 20_000 });
    await page.getByTestId('observer-connection-mode').waitFor({ state: 'visible' });
    await page
      .locator('[data-testid="observer-thinking-stage"][data-status="thinking"]')
      .waitFor({ state: 'visible', timeout: 60_000 });

    await page.waitForFunction(
      (providers) => {
        const providerThoughts = [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid^="observer-thought-"][data-source="provider"]',
          ),
        ];
        return providers.every((provider) =>
          providerThoughts.some((thought) => thought.dataset.providerId === provider),
        );
      },
      expectedProviders,
      { timeout: 150_000 },
    );

    const pause = page.getByTestId('observer-pause-toggle');
    await pause.click();
    await page
      .locator('[data-testid="observer-pause-toggle"][aria-label="继续 AI 观战对局"]')
      .waitFor({ state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>('[data-testid="observer-thinking-stage"]')?.dataset
          .status !== 'thinking',
      undefined,
      { timeout: 150_000 },
    );

    const providerEvidence: ProviderUiEvidence[] = [];
    for (const provider of expectedProviders) {
      providerEvidence.push(await inspectProviderUi(page, provider));
    }

    const usage = usageDelta(await readUsage(), usageBefore);
    const expectedUsage = usage?.providerUsage?.filter((item) =>
      expectedProviders.includes((item.providerId ?? '') as 'kimi' | 'deepseek'),
    );
    const usageOk =
      usage === undefined ||
      (expectedUsage?.length === expectedProviders.length &&
        expectedUsage.every((item) => (item.succeeded ?? 0) >= 1) &&
        (usage.failed ?? Number.POSITIVE_INFINITY) <= maxFailedAttempts);
    const ok =
      providerEvidence.every(
        (item) => item.summaryCharacters > 0 && item.visibleAnalysisCharacters > 0,
      ) && usageOk;
    console.log(
      JSON.stringify({
        ok,
        roomUrl: new URL(page.url()).pathname,
        providers: providerEvidence,
        usage: usage
          ? {
              calls: usage.calls ?? null,
              succeeded: usage.succeeded ?? null,
              failed: usage.failed ?? null,
              allowedFailedAttempts: maxFailedAttempts,
              providers: expectedUsage?.map((item) => ({
                providerId: item.providerId,
                calls: item.calls,
                succeeded: item.succeeded,
                failed: item.failed,
              })),
            }
          : null,
      }),
    );
    if (!ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

void main();
