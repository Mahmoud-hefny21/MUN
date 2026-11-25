import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

export async function verifyBrowser(base, session) {
  const browser = await chromium.launch({ executablePath: process.env.MUN_CHROMIUM_PATH });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'mun_session', value: session.split('=')[1], url: base, httpOnly: true }]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const widths = [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440, 1920, 2560];
  const routes = { home: /Welcome/, feed: /Club Feed/, fantasy: /Fantasy/, assistant: /MUN Assistant/, profile: /My Profile/, quiz: /Daily Quiz/, resources: /Resources/, notifications: /Inbox/, admin: /Board Workspace/ };
  const screenshotDir = process.env.MUN_SCREENSHOTS;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  try {
    await page.goto(base + '/');
    await page.getByRole('heading', { name: routes.home, level: 1 }).waitFor();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 });
      for (const [route, title] of Object.entries(routes)) {
        await page.evaluate(path => { location.hash = path; }, route);
        await page.getByRole('heading', { name: title, level: 1 }).waitFor();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, route + ' at ' + width);
        const nav = page.getByRole('navigation', { name: 'Member navigation' });
        assert.equal(await nav.isVisible(), width < 768 && route !== 'admin');
        if (width < 768 && route !== 'admin') {
          assert.deepEqual(await nav.getByRole('link').allTextContents(), ['Home', 'Feed', 'Fantasy', 'AI Assistant', 'Profile']);
        }
        if (screenshotDir && [320, 390, 768, 1440].includes(width)) {
          await page.screenshot({ path: screenshotDir + '/' + route + '-' + width + '.png', fullPage: true });
        }
      }
    }
    await page.goto(base + '/#home');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    const keys = await page.evaluate(async () => {
      const names = await caches.keys();
      return (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat();
    });
    assert.ok(keys.includes('/offline.html'));
    assert.ok(keys.every(path => !path.startsWith('/api/') && !path.startsWith('/auth/')));
    await context.setOffline(true);
    await page.reload();
    await page.getByRole('heading', { name: "You're offline" }).waitFor();
    await context.setOffline(false);
    await page.getByRole('link', { name: 'Try again' }).click();
    await page.getByRole('heading', { name: /Welcome/ }).waitFor();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.getByRole('link', { name: 'Continue with Google' }).waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
