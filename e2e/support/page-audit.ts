import { expect, type Page, type Request, type Response } from '@playwright/test';

const CRITICAL_RESOURCE_TYPES = new Set([
  'document',
  'fetch',
  'font',
  'image',
  'script',
  'stylesheet',
  'websocket',
  'xhr',
]);

export interface PageAudit {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly criticalFailures: string[];
}

interface AuditOptions {
  readonly ignoreUrls?: readonly RegExp[];
}

interface CleanAuditOptions {
  readonly allowedConsoleErrors?: readonly RegExp[];
}

function isIgnored(url: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(url));
}

function isCritical(request: Request): boolean {
  return CRITICAL_RESOURCE_TYPES.has(request.resourceType());
}

function isExpectedNextNavigationAbort(request: Request, reason: string): boolean {
  if (request.resourceType() !== 'fetch' || reason !== 'net::ERR_ABORTED') return false;
  try {
    return new URL(request.url()).searchParams.has('_rsc');
  } catch {
    return false;
  }
}

export function auditPage(page: Page, options: AuditOptions = {}): PageAudit {
  const audit: PageAudit = {
    consoleErrors: [],
    pageErrors: [],
    criticalFailures: [],
  };
  const ignoreUrls = options.ignoreUrls ?? [];

  page.on('console', (message) => {
    if (message.type() === 'error') {
      audit.consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    audit.pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    if (!isCritical(request) || isIgnored(request.url(), ignoreUrls)) return;
    const reason = request.failure()?.errorText ?? 'unknown failure';
    if (isExpectedNextNavigationAbort(request, reason)) return;
    audit.criticalFailures.push(
      `${request.resourceType()} ${request.method()} ${request.url()} — ${reason}`,
    );
  });
  page.on('response', (response: Response) => {
    const request = response.request();
    if (response.status() < 400 || !isCritical(request) || isIgnored(response.url(), ignoreUrls)) {
      return;
    }
    audit.criticalFailures.push(`${request.resourceType()} ${response.status()} ${response.url()}`);
  });
  page.on('websocket', (socket) => {
    socket.on('socketerror', (error) => {
      if (!isIgnored(socket.url(), ignoreUrls)) {
        audit.criticalFailures.push(`websocket ${socket.url()} — ${error}`);
      }
    });
  });

  return audit;
}

export function expectAuditClean(audit: PageAudit, options: CleanAuditOptions = {}): void {
  const unexpectedConsoleErrors = audit.consoleErrors.filter(
    (message) => !(options.allowedConsoleErrors ?? []).some((pattern) => pattern.test(message)),
  );
  expect.soft(unexpectedConsoleErrors, 'unexpected browser console errors').toEqual([]);
  expect.soft(audit.pageErrors, 'uncaught browser page errors').toEqual([]);
  expect.soft(audit.criticalFailures, 'failed critical network resources').toEqual([]);
}
