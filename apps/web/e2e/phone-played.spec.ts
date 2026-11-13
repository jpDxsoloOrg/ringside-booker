/**
 * Every screen with real game data, at phone widths (UI-30). The smoke sweep uses a tiny faked
 * world; this one loads the played save (a default-world game three weeks in, with booked and run
 * shows) so long tables, ledgers and calendars are measured too. At 390px and 360px each route,
 * each of its tabs and the main sheets must fit the viewport with no sideways scroll, every text
 * field must be at least 16px (iOS zooms in on smaller ones) and no stylesheet may keep a range
 * media query (iOS before 16.4 drops them). Phone projects only, Chromium and WebKit.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { enterGameFromPlayedSave } from './helpers/game';
import {
  expectFormFieldsAtLeast16px,
  expectNoHorizontalScroll,
  expectNoRangeMediaQueries,
} from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';
import { gameRoutes } from './routes-under-test';

/** The phone widths checked: a common iPhone, then a small Android phone. */
const PHONE_SIZES = [
  { width: 390, height: 844 },
  { width: 360, height: 740 },
] as const;

/** The page fits and its fields are big enough; `where` names the screen in the failure. */
async function expectPhoneFit(page: Page, where: string): Promise<void> {
  await test.step(where, async () => {
    await expectNoHorizontalScroll(page);
    await expectFormFieldsAtLeast16px(page);
  });
}

/** Opens each tab on the screen after the first (already showing) and checks it fits. */
async function checkEachTab(page: Page, screen: string): Promise<void> {
  const tabs = page.getByRole('main').getByRole('tab');
  const count = await tabs.count();
  for (let index = 1; index < count; index += 1) {
    const tab = tabs.nth(index);
    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expectPhoneFit(page, `${screen}, tab ${(await tab.textContent()) ?? String(index)}`);
  }
}

/** Opens the first in-app link whose path starts with `prefix`, if the screen has one. */
async function openFirstLink(page: Page, prefix: string): Promise<boolean> {
  const links = page.locator(`main a[href^="${prefix}"]`);
  // Event history has no list yet, so its show results are only checked once it does.
  if ((await links.count()) === 0) return false;
  const href = await links.first().getAttribute('href');
  if (href === null) return false;
  await navigateInApp(page, href);
  await expect(page.locator('h1')).toHaveCount(1);
  return true;
}

test.describe('phone layout with a played save', () => {
  // Every route at two widths, with a real engine underneath: longer than the default budget.
  test.describe.configure({ timeout: 240_000 });

  for (const size of PHONE_SIZES) {
    test(`every screen fits at ${String(size.width)}px`, async ({ page }, testInfo) => {
      test.skip(!isPhone(testInfo), 'Phone widths only.');
      await page.setViewportSize(size);
      await enterGameFromPlayedSave(page);
      await expectNoRangeMediaQueries(page);

      for (const route of gameRoutes) {
        await navigateInApp(page, route.path);
        if (route.heading !== undefined) {
          await expect(page.locator('h1')).toHaveText(route.heading);
        }
        await expectPhoneFit(page, route.name);
        await checkEachTab(page, route.name);
      }

      await navigateInApp(page, '/game/workers');
      await expect(page.locator('h1')).toHaveText('Workers');
      if (await openFirstLink(page, '/game/workers/')) {
        await expectPhoneFit(page, 'worker profile');
        await checkEachTab(page, 'worker profile');
      }

      await navigateInApp(page, '/game/event-history');
      if (await openFirstLink(page, '/game/event-history/')) {
        await expectPhoneFit(page, 'show results');
      }

      await navigateInApp(page, '/game/calendar');
      await expect(page.locator('h1')).toHaveText('Calendar');
      const show = page
        .getByRole('main')
        .getByRole('button', { name: /Altura/ })
        .first();
      await show.click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectPhoneFit(page, 'calendar show sheet');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'More' }).click();
      await expect(page.getByRole('dialog', { name: 'Menu' })).toBeVisible();
      await expectPhoneFit(page, 'nav drawer');
      await page.keyboard.press('Escape');

      for (const path of ['/settings', '/load', '/new', '/']) {
        await page.goto(path);
        await expect(page.locator('h1')).toHaveCount(1);
        await expectPhoneFit(page, path);
      }
    });
  }
});
