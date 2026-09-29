import path from 'node:path';

import { type Browser, type BrowserContext, expect, type Page, test as base } from '@playwright/test';

import { APP_ORIGIN } from './ApiFlow';

const SCREENSHOT_DIR = path.join('e2e', 'screenshots');

/**
 * Desktop Chromium may expose navigator.share; E2E always takes the download / clipboard path so the
 * files can be inspected. (A real share sheet cannot be driven from Playwright.)
 */
const disableWebShare = async (context: BrowserContext): Promise<void> => {
  await context.addInitScript(() => {
    const proto = Navigator.prototype as unknown as Record<string, unknown>;

    delete proto.share;
    delete proto.canShare;
  });
};

/** Fresh context = new anonymous session (no cookies), same viewport as the current project. */
export const newIsolatedContext = async (browser: Browser, page: Page): Promise<BrowserContext> => {
  const context = await browser.newContext({
    baseURL: APP_ORIGIN,
    viewport: page.viewportSize() ?? undefined,
  });

  await disableWebShare(context);

  return context;
};

export const test = base.extend({
  context: async ({ context }, provide) => {
    await disableWebShare(context);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await provide(context);
  },
});

export const expectNoHorizontalOverflow = async (page: Page, screen: string): Promise<void> => {
  const size = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));

  expect(
    size.scrollWidth,
    `${screen}: scrollWidth ${size.scrollWidth} > clientWidth ${size.clientWidth}`,
  ).toBeLessThanOrEqual(size.clientWidth);
};

export const saveScreenshot = async (page: Page, screen: string): Promise<void> => {
  const width = page.viewportSize()?.width ?? 0;

  await page.screenshot({ path: path.join(SCREENSHOT_DIR, `e2e-${screen}-${width}.png`), fullPage: true });
};

/** Collects the bodies of every /api/ response while `isActive()` is true. */
export const collectApiBodies = (page: Page, isActive: () => boolean) => {
  const pending: Promise<string>[] = [];

  page.on('response', (response) => {
    if (!isActive() || !new URL(response.url()).pathname.startsWith('/api/')) {
      return;
    }

    pending.push(
      response
        .text()
        .then((body) => `${response.request().method()} ${response.url()} ${response.status()}\n${body}`)
        .catch(() => ''),
    );
  });

  return { read: () => Promise.all(pending) };
};
