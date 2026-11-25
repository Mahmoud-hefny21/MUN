import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

export async function verifyBrowser(base, session, memberSession) {
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
          const dock = await nav.boundingBox();
          assert.ok(Math.abs(dock.y + dock.height - 900) <= 1);
          for (const tab of await nav.getByRole('link').all()) {
            const target = await tab.boundingBox();
            assert.ok(target.width >= 44 && target.height >= 44);
          }
        }
        if (screenshotDir && [320, 390, 768, 1440].includes(width)) {
          await page.screenshot({ path: screenshotDir + '/' + route + '-' + width + '.png', fullPage: true });
        }
      }
    }
    await page.goto(base + '/#home');
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => { location.hash = 'admin'; });
    const boardSections = page.getByRole('navigation', { name: 'Board sections' });
    await boardSections.getByRole('link', { name: 'Roles & access' }).click();
    assert.equal(await page.getByRole('heading', { name: 'Publish activity' }).count(), 0);
    await page.getByLabel('Role name').fill('Browser editor');
    await page.getByLabel('Manage quizzes and resources').check();
    await page.getByRole('button', { name: 'Create role' }).click();
    await page.getByRole('status').filter({ hasText: 'Role created.' }).waitFor();
    await page.getByLabel('Google email').fill('browser-invite@gmail.com');
    const invite = page.locator('form[data-action="member-email"]');
    await invite.getByLabel('Role').selectOption('Browser editor');
    await invite.getByRole('button', { name: 'Save role by email' }).click();
    await page.getByText(/browser-invite@gmail.com/).waitFor();
    await boardSections.getByRole('link', { name: 'Activities' }).click();
    await page.getByRole('heading', { name: 'Record attendance' }).waitFor();
    await page.goBack();
    await page.getByRole('heading', { name: 'Create a role' }).waitFor();
    await page.evaluate(() => { location.hash = 'assistant'; });
    await page.getByRole('textbox', { name: 'Your question' }).fill('rules of procedure');
    assert.equal(await page.getByRole('navigation', { name: 'Member navigation' }).isVisible(), true);
    await page.getByRole('button', { name: 'Ask assistant' }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const send = await page.getByRole('button', { name: 'Ask assistant' }).boundingBox();
    const tabs = await page.getByRole('navigation', { name: 'Member navigation' }).boundingBox();
    assert.ok(send.y + send.height <= tabs.y);
    await page.getByRole('button', { name: 'Ask assistant' }).click();
    await page.getByText('General Assembly Rules of Procedure', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'New chat' }).click();
    assert.equal(await page.getByText('General Assembly Rules of Procedure', { exact: true }).count(), 0);
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
    await context.addCookies([{ name: 'mun_session', value: memberSession.split('=')[1], url: base, httpOnly: true }]);
    await page.goto(base + '/?browser=member#home');
    await page.getByRole('heading', { name: /Welcome, delegate/ }).waitFor();
    await page.setViewportSize({ width: 1200, height: 800 });
    assert.equal(await page.locator('#board-link').isVisible(), false);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.getByRole('navigation', { name: 'Member navigation' }).getByRole('link', { name: 'Feed' }).click();
    await page.getByText(/Vote recorded/).waitFor();
    await page.evaluate(() => { location.hash = 'quiz'; });
    await page.getByText(/Correct. You earned 3 points/).waitFor();
    await page.evaluate(() => { location.hash = 'profile'; });
    await page.getByRole('heading', { name: 'My Profile' }).waitFor();
    assert.equal(await page.locator('#content a[href="#admin"]').count(), 0);
    for (const route of ['admin', 'admin/roles']) {
      await page.evaluate(hash => { location.hash = hash; }, route);
      await page.waitForURL(/#home$/);
      await page.getByRole('heading', { name: /Welcome, delegate/ }).waitFor();
    }
    assert.equal(await page.getByRole('heading', { name: 'Create a role' }).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
}
