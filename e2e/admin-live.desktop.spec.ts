import { expect, test } from '@playwright/test';

import { expectNoHorizontalOverflow } from './support/layout';
import { auditPage, expectAuditClean } from './support/page-audit';

interface ProviderResponse {
  readonly slug: string;
  readonly name: string;
  readonly modelId: string;
  readonly configured: boolean;
  readonly status: string;
  readonly usage: {
    readonly calls: number;
    readonly succeeded: number;
    readonly failed: number;
    readonly costCents: number;
    readonly averageLatencyMs: number;
  };
}

interface UsageResponse {
  readonly calls: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly costCents: number;
  readonly averageLatencyMs: number;
  readonly providers: number;
}

test('model administration renders only truthful Kimi and DeepSeek runtime data', async ({
  page,
}) => {
  const audit = auditPage(page);
  await page.goto('/admin/models');

  await expect(page.getByTestId('admin-empty-state')).toContainText('尚未读取真实供应商数据');
  await expect(page.locator('.provider-row')).toHaveCount(0);
  await page.getByTestId('admin-key').fill('dev-admin-key');

  const providersResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && response.url().endsWith('/api/v1/admin/providers'),
  );
  const usageResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && response.url().endsWith('/api/v1/admin/usage'),
  );
  await page.getByRole('button', { name: '读取实时后台' }).click();

  const [providersResponse, usageResponse] = await Promise.all([
    providersResponsePromise,
    usageResponsePromise,
  ]);
  expect(providersResponse.status()).toBe(200);
  expect(usageResponse.status()).toBe(200);

  const providers = (await providersResponse.json()) as readonly ProviderResponse[];
  const usage = (await usageResponse.json()) as UsageResponse;
  expect(providers.map((provider) => provider.slug)).toEqual(['deepseek', 'kimi']);
  expect(providers.map((provider) => provider.modelId)).toEqual(['deepseek-v4-flash', 'kimi-k2.6']);
  expect(
    providers.every(
      (provider) =>
        provider.configured === false &&
        provider.status === 'missing-credential' &&
        provider.usage.calls === 0 &&
        provider.usage.succeeded === 0 &&
        provider.usage.failed === 0 &&
        provider.usage.costCents === 0 &&
        provider.usage.averageLatencyMs === 0,
    ),
  ).toBe(true);
  expect(usage).toMatchObject({
    calls: 0,
    succeeded: 0,
    failed: 0,
    costCents: 0,
    averageLatencyMs: 0,
    providers: 2,
  });

  await expect(page.getByTestId('admin-data-source')).toContainText('已同步 2 个可用供应商');
  await expect(page.locator('.provider-row')).toHaveCount(2);
  await expect(page.getByText('DeepSeek', { exact: true })).toBeVisible();
  await expect(page.getByText('Kimi', { exact: true })).toBeVisible();
  await expect(page.getByText('deepseek-v4-flash', { exact: true })).toBeVisible();
  await expect(page.getByText('kimi-k2.6', { exact: true })).toBeVisible();
  await expect(page.getByText('MiMo', { exact: true })).toHaveCount(0);
  await expect(page.getByText('千问', { exact: true })).toHaveCount(0);
  await expect(page.getByText('GLM', { exact: true })).toHaveCount(0);
  await expect(page.getByText('豆包', { exact: true })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, 'truthful model administration');
  expectAuditClean(audit);
});
