/**
 * The in-game shell on desktop and phone, entered through the dev-only `/dev/enter-shell` helper.
 * Desktop: every sidebar link opens its screen with a matching heading and focus on it. Phone: the
 * bottom tab bar, the More sheet listing every section, and no screen scrolling sideways or
 * hiding behind the tab bar. Unemployed: the promotion sections are gone on both. And Tab from a
 * page load reaches "Skip to content" first.
 */
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { enterShell, navigateInApp } from './helpers/shell';
import { gameRoutes } from './routes-under-test';

const ALL_SECTIONS = ['Office', 'World', 'Your promotion', 'Creative', 'Business'];
const PROMOTION_SECTIONS = ['Your promotion', 'Creative', 'Business'];

function sidebar(page: Page) {
  return page.getByRole('navigation', { name: 'Main' });
}

function bottomNav(page: Page) {
  return page.getByRole('navigation', { name: 'Primary' });
}

async function openMoreSheet(page: Page) {
  await bottomNav(page).getByRole('button', { name: 'More' }).click();
  const sheet = page.getByRole('dialog', { name: 'Menu' });
  await expect(sheet).toBeVisible();
  return sheet;
}

test.describe('shell on desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop layout only');

  test('shows the sidebar and no bottom bar', async ({ page }) => {
    await enterShell(page);

    await expect(sidebar(page)).toBeVisible();
    await expect(bottomNav(page)).toHaveCount(0);
    for (const section of ALL_SECTIONS) {
      await expect(
        sidebar(page).getByRole('heading', { name: section, exact: true }),
      ).toBeVisible();
    }
    await expectNoSeriousA11yViolations(page);
  });

  test('every sidebar link opens its screen and moves focus to the heading', async ({ page }) => {
    await enterShell(page);

    const links = sidebar(page).getByRole('link');
    const labels = await links.allTextContents();
    expect([...labels].sort()).toEqual(gameRoutes.map((route) => route.heading ?? '').sort());

    // The shell opens on the first item (Dashboard), so visit it last, coming from another page.
    const visitOrder = [...labels.slice(1), ...labels.slice(0, 1)];
    for (const label of visitOrder) {
      await sidebar(page).getByRole('link', { name: label, exact: true }).click();

      const heading = page.getByRole('heading', { level: 1 });
      await expect(heading).toHaveText(label);
      await expect(heading).toBeFocused();
      await expect(page).toHaveTitle(`${label} · Ringside Booker`);
      await expect(sidebar(page).getByRole('link', { name: label, exact: true })).toHaveAttribute(
        'aria-current',
        'page',
      );
      const route = gameRoutes.find((candidate) => candidate.heading === label);
      expect(route, `A route under test for "${label}"`).toBeDefined();
      await expect(page).toHaveURL(new RegExp(`${route?.path ?? ''}$`));
    }
  });

  test('hides the promotion sections while unemployed', async ({ page }) => {
    await enterShell(page, { employed: false });

    await expect(sidebar(page).getByRole('heading', { name: 'World', exact: true })).toBeVisible();
    for (const section of PROMOTION_SECTIONS) {
      await expect(sidebar(page).getByRole('heading', { name: section, exact: true })).toHaveCount(
        0,
      );
    }
  });

  test('sends a fresh /game link to the title screen', async ({ page }) => {
    await page.goto('/game/roster');

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Load or start a game first.')).toBeVisible();
  });
});

test.describe('shell on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone layout only');

  test('shows the bottom tab bar and no sidebar', async ({ page }) => {
    await enterShell(page);

    await expect(bottomNav(page)).toBeVisible();
    await expect(sidebar(page)).toHaveCount(0);
    await expect(bottomNav(page).getByRole('link')).toHaveText([
      'Office',
      'Roster',
      'Booking',
      'Calendar',
    ]);
    await expect(bottomNav(page).getByRole('button', { name: 'More' })).toBeVisible();

    // The bar sits on the bottom edge of the viewport.
    const viewport = page.viewportSize();
    const box = await bottomNav(page).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(viewport?.height);
  });

  test('More lists every section, and tapping Titles navigates and closes it', async ({ page }) => {
    await enterShell(page);

    const sheet = await openMoreSheet(page);
    for (const section of ALL_SECTIONS) {
      await expect(sheet.getByRole('heading', { name: section, exact: true })).toBeVisible();
    }
    await expect(sheet.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Main menu' })).toBeVisible();
    await expectNoSeriousA11yViolations(page, { include: ['[role="dialog"]'] });

    await sheet.getByRole('link', { name: 'Titles', exact: true }).click();

    await expect(page).toHaveURL(/\/game\/titles$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Titles');
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  });

  test('no screen scrolls sideways or hides behind the tab bar', async ({ page }) => {
    await enterShell(page);

    for (const route of gameRoutes) {
      await navigateInApp(page, route.path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading ?? '');
      await expectNoHorizontalScroll(page);

      // Scrolled to the end, the last of the content still clears the bar.
      await page.evaluate(() => {
        window.scrollTo(0, document.documentElement.scrollHeight);
      });
      const contentBottom = await page.evaluate(() => {
        const content = document.querySelector('#main > *');
        return content === null ? 0 : content.getBoundingClientRect().bottom;
      });
      const barBox = await bottomNav(page).boundingBox();
      expect(contentBottom, `${route.path} content ends above the tab bar`).toBeLessThanOrEqual(
        Math.ceil(barBox?.y ?? 0),
      );
    }
  });

  test('falls back to World screens and hides promotion sections while unemployed', async ({
    page,
  }) => {
    await enterShell(page, { employed: false });

    await expect(bottomNav(page).getByRole('link')).toHaveText([
      'Office',
      'Workers',
      'Inbox',
      'News',
    ]);
    const sheet = await openMoreSheet(page);
    await expect(sheet.getByRole('heading', { name: 'World', exact: true })).toBeVisible();
    for (const section of PROMOTION_SECTIONS) {
      await expect(sheet.getByRole('heading', { name: section, exact: true })).toHaveCount(0);
    }
  });
});

test.describe('skip link', () => {
  // Safari-family browsers only Tab to links with Option+Tab, unless the setting is changed.
  test.skip(({ browserName }) => browserName === 'webkit', 'WebKit skips links on Tab');

  test('is the first Tab stop on the title screen', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.keyboard.press('Tab');

    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  });

  test('is the first Tab stop in the shell and moves focus to the content', async ({ page }) => {
    await enterShell(page);

    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Skip to content' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeInViewport();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    await expect(page).toHaveURL(/\/game\/office$/);
  });
});
