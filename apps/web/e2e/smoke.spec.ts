import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromInjurySave } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { enterShell, navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';
import { routesUnderTest } from './routes-under-test';

/** Loading the injury save and running a day of the default world. */
const HEALTH_SMOKE_TIMEOUT_MS = 120_000;

test.describe('smoke', () => {
  for (const route of routesUnderTest) {
    test(`${route.name} (${route.path}) loads and fits the viewport`, async ({ page }) => {
      if (route.needsWorld) {
        // In-game routes need a loaded world: enter the shell, then move inside the app.
        await enterShell(page);
        await navigateInApp(page, route.path);
      } else {
        await page.goto(route.path);
      }

      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      if (route.heading !== undefined) {
        await expect(page.locator('h1')).toHaveText(route.heading);
      }
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });
  }
});

/** The UI scales the health screens are checked at. */
const HEALTH_UI_SCALES = ['1', '1.5'] as const;

/**
 * The health screens with a world behind them (WRK6-08): the injury save's next day hurts one of
 * the player's own, so Workers > Injured has a row and that worker's Health tab has an injury
 * card. Each has one h1, no sideways scroll and no serious axe findings, at 100% and 150%.
 */
test.describe('health screens in a game', () => {
  for (const scale of HEALTH_UI_SCALES) {
    test(`Workers > Injured and the Health tab fit at ${String(Number(scale) * 100)}% UI scale`, async ({
      page,
    }) => {
      test.setTimeout(HEALTH_SMOKE_TIMEOUT_MS);
      await page.goto('/settings');
      await page.getByRole('slider', { name: 'UI scale' }).fill(scale);
      await expect.poll(() => uiScaleOnPage(page)).toBe(scale);
      await enterGameFromInjurySave(page);
      await page.getByTestId('day-control').getByRole('button', { name: 'Next day' }).click();
      await expect(
        page.getByTestId('day-control').getByRole('button', { name: 'Roster' }),
      ).toBeVisible({ timeout: 30_000 });

      await navigateInApp(page, '/game/workers?availability=injured');
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveText('Workers');
      const healthLink = page.getByRole('main').locator('a[href^="/game/workers/per_"]').first();
      await expect(healthLink).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);

      const href = (await healthLink.getAttribute('href')) ?? '';
      await navigateInApp(page, `${href.split('?')[0] ?? href}?tab=health`);
      await expect(page.getByRole('region', { name: 'Condition' })).toBeVisible();
      await expect(page.getByText('Time out', { exact: true })).toBeVisible();
      await expect(page.locator('h1')).toHaveCount(1);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });
  }
});

/** The UI scale `<html>` carries, as SettingsEffects and main.tsx set it. */
async function uiScaleOnPage(page: Page): Promise<string> {
  return page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale'));
}

test.describe('settings', () => {
  test('at 150% UI scale the settings, title and dashboard still fit the viewport', async ({
    page,
  }) => {
    await page.goto('/settings');
    await page.getByRole('slider', { name: 'UI scale' }).fill('1.5');
    await expect(page.locator('output')).toHaveText('150%');
    await expect.poll(() => uiScaleOnPage(page)).toBe('1.5');
    await expectNoHorizontalScroll(page);

    // A fresh load reads the stored scale before the first render.
    await page.goto('/');
    await expect(page.locator('h1')).toHaveText('Ringside Booker');
    expect(await uiScaleOnPage(page)).toBe('1.5');
    await expectNoHorizontalScroll(page);

    await enterShell(page);
    expect(await uiScaleOnPage(page)).toBe('1.5');
    // The faked seat has no world, so the Office gives the engine's reason calmly, not a crash.
    await expect(
      page.getByRole('heading', { level: 2, name: "The Office can't be shown" }),
    ).toBeVisible();
    await expect(page.getByText('No game is loaded')).toBeVisible();
    // The top bar's end draws once the engine answers, after the dashboard. Wait for the day
    // button so the whole bar is measured, not the moment before it fills in.
    await expect(page.getByTestId('next-day')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('the dark theme and the chosen preferences survive a reload', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('radio', { name: 'Reduce motion' }).check();
    await page.getByRole('radio', { name: 'Full', exact: true }).check();

    await page.reload();

    await expect(page.locator('h1')).toHaveText('Settings');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'on');
    await expect(page.getByRole('radio', { name: 'Reduce motion' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Full', exact: true })).toBeChecked();
  });

  test('opens from the game and goes back to the screen it left', async ({ page }, testInfo) => {
    await enterShell(page);
    await navigateInApp(page, '/game/roster');
    if (isPhone(testInfo)) {
      await page.getByRole('button', { name: 'More' }).click();
      await page
        .getByRole('dialog', { name: 'Menu' })
        .getByRole('link', { name: 'Settings' })
        .click();
    } else {
      await page.getByTestId('sidebar').getByRole('link', { name: 'Settings' }).click();
    }
    await expect(page.locator('h1')).toHaveText('Settings');

    await page.getByRole('link', { name: 'Back to game' }).click();
    await expect(page).toHaveURL(/\/game\/roster$/);
    await expect(page.locator('h1')).toHaveText('Roster');
  });
});
