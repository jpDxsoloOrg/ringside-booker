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

  test('phone: at 150% UI scale the news ticker stays inside its strip', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'The docked ticker over the phone tab bar');
    await page.goto('/settings');
    await page.getByRole('slider', { name: 'UI scale' }).fill('1.5');
    await expect.poll(() => uiScaleOnPage(page)).toBe('1.5');
    await enterShell(page);
    const ticker = page.getByRole('region', { name: 'News ticker' });
    await expect(ticker).toHaveAttribute('data-motion', 'crawl');
    await expect(page.getByTestId('next-day')).toBeVisible();
    await expectNoHorizontalScroll(page);

    const fit = await ticker.evaluate((strip) => {
      const box = (element: Element | null) => {
        const rect = element?.getBoundingClientRect();
        return { left: rect?.left ?? -1, right: rect?.right ?? Infinity, width: rect?.width ?? 0 };
      };
      const badge = strip.firstElementChild;
      return {
        viewportWidth: document.documentElement.clientWidth,
        strip: box(strip),
        badge: box(badge),
        badgeClipped: badge === null || badge.scrollWidth > badge.clientWidth,
        headlines: box(strip.querySelector('[data-part="viewport"]')),
        pause: box(strip.querySelector('button')),
      };
    });
    // The strip spans the phone and nothing in it reaches past its edges.
    expect(fit.strip.left).toBeGreaterThanOrEqual(0);
    expect(fit.strip.right).toBeLessThanOrEqual(fit.viewportWidth);
    for (const part of [fit.badge, fit.headlines, fit.pause]) {
      expect(part.left).toBeGreaterThanOrEqual(fit.strip.left);
      expect(part.right).toBeLessThanOrEqual(fit.strip.right);
    }
    // The badge wraps its words rather than crowding out the headlines or cutting itself off.
    expect(fit.badgeClipped).toBe(false);
    expect(fit.headlines.width).toBeGreaterThan(fit.badge.width);
  });

  for (const scale of ['1', '1.5'] as const) {
    test(`phone: with reduced motion at ${String(Number(scale) * 100)}% every ticker headline is shown whole`, async ({
      page,
    }, testInfo) => {
      test.skip(!isPhone(testInfo), 'The docked ticker over the phone tab bar');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/settings');
      await page.getByRole('slider', { name: 'UI scale' }).fill(scale);
      await expect.poll(() => uiScaleOnPage(page)).toBe(scale);
      await enterShell(page);
      await expect(page.getByTestId('next-day')).toBeVisible();

      // One headline at a time, wrapped to fit, with buttons to step through the rest (UI-34).
      const ticker = page.getByRole('region', { name: 'News ticker' });
      await expect(ticker).toHaveAttribute('data-motion', 'static');
      await expect(ticker).toHaveAttribute('data-stepping', 'on');
      // The hidden headlines keep their room in the strip, so count the list items, not the roles.
      const headlineCount = await ticker.locator('li').count();
      expect(headlineCount).toBeGreaterThan(1);
      const next = ticker.getByRole('button', { name: 'Next headline' });
      await expect(ticker.getByRole('button', { name: 'Previous headline' })).toBeVisible();
      await expectNoHorizontalScroll(page);

      const seen = new Set<string>();
      for (let step = 0; step < headlineCount; step += 1) {
        const fit = await page.getByTestId('ticker-slot').evaluate((slot) => {
          const box = (element: Element | null) => {
            const rect = element?.getBoundingClientRect();
            return {
              top: rect?.top ?? Infinity,
              bottom: rect?.bottom ?? -Infinity,
              left: rect?.left ?? Infinity,
              right: rect?.right ?? -Infinity,
            };
          };
          const current = slot.querySelector('li[data-current="true"]');
          const clipped = (element: Element | null) =>
            element === null ||
            element.scrollHeight > element.clientHeight + 1 ||
            element.scrollWidth > element.clientWidth + 1;
          const main = document.querySelector('main');
          return {
            text: current?.textContent ?? '',
            viewportWidth: document.documentElement.clientWidth,
            slot: box(slot),
            window: box(slot.querySelector('[data-part="viewport"]')),
            item: box(current),
            // Nothing overflows the headline, its clipping window or the strip.
            headlineClipped:
              clipped(current) ||
              clipped(slot.querySelector('[data-part="viewport"]')) ||
              clipped(slot),
            tabBarTop: box(document.querySelector('nav[aria-label="Primary"]')).top,
            mainPaddingBottom: main === null ? 0 : parseFloat(getComputedStyle(main).paddingBottom),
            slotHeight: slot.getBoundingClientRect().height,
          };
        });
        const where = `headline ${String(step + 1)}: ${fit.text}`;
        expect(fit.text, where).not.toBe('');
        expect(fit.headlineClipped, where).toBe(false);
        // The headline sits wholly inside its window, the window inside the strip, the strip on screen.
        expect(fit.item.top, where).toBeGreaterThanOrEqual(fit.window.top - 1);
        expect(fit.item.bottom, where).toBeLessThanOrEqual(fit.window.bottom + 1);
        expect(fit.item.left, where).toBeGreaterThanOrEqual(fit.window.left - 1);
        expect(fit.item.right, where).toBeLessThanOrEqual(fit.window.right + 1);
        expect(fit.window.top, where).toBeGreaterThanOrEqual(fit.slot.top - 1);
        expect(fit.window.bottom, where).toBeLessThanOrEqual(fit.slot.bottom + 1);
        expect(fit.slot.left).toBeGreaterThanOrEqual(0);
        expect(fit.slot.right).toBeLessThanOrEqual(fit.viewportWidth);
        // The strip still rides on the tab bar, and the content is padded to clear all of it.
        expect(Math.abs(fit.slot.bottom - fit.tabBarTop)).toBeLessThanOrEqual(1);
        expect(fit.mainPaddingBottom).toBeGreaterThanOrEqual(fit.slotHeight);
        seen.add(fit.text);
        await next.click();
      }
      expect(seen.size, 'every headline was reached').toBe(headlineCount);
    });
  }

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
