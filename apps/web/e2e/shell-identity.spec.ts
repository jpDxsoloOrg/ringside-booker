/**
 * The shell in the visual identity (docs/design/visual-identity.md), on desktop and phone: the
 * sidebar's brand block and red-orange rail, the top bar's status strip and Next Day bug, the
 * phone's ticker riding above the tab bar, and the placeholder dashboard marked as sample data.
 * Each project attaches a full-page screenshot of the office, so the look can be judged from the
 * report (and the pull request) without running the app.
 */
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { enterShell } from './helpers/shell';
import { isPhone } from './helpers/viewport';

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, 'element is rendered').not.toBeNull();
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

/** The settled office: fonts loaded and the ticker held still, so screenshots are stable. */
async function settleOffice(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterShell(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

test.describe('shell identity', () => {
  test('top bar shows the status and the Next Day bug without overflowing', async ({
    page,
  }, testInfo) => {
    await settleOffice(page);

    const topBar = page.getByRole('banner');
    const status = topBar.getByRole('group', { name: 'Status (sample figures)' });
    const nextDay = topBar.getByRole('button', { name: 'Next day' });
    await expect(status).toBeVisible();
    await expect(nextDay).toBeVisible();
    await expect(nextDay).toBeInViewport({ ratio: 1 });
    await expect(nextDay).toHaveAttribute('aria-disabled', 'true');

    const overflow = await topBar.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, 'the top bar fits its width').toBeLessThanOrEqual(0);

    if (isPhone(testInfo)) {
      await expect(status).toContainText('Wk 11 · S2');
    } else {
      await expect(status).toContainText('Week 11 · Season 2');
      await expect(status).toContainText('Cash');
      await expect(status).toContainText('Popularity');
    }
    await expectNoHorizontalScroll(page);
  });

  test('a narrow desktop window keeps the date and Next Day in the top bar', async ({
    page,
  }, testInfo) => {
    test.skip(isPhone(testInfo), 'Desktop layout only');
    // Just above the phone breakpoint, the narrowest desktop layout.
    await page.setViewportSize({ width: 800, height: 900 });
    await settleOffice(page);

    const topBar = page.getByRole('banner');
    await expect(topBar.getByRole('button', { name: 'Next day' })).toBeInViewport({ ratio: 1 });
    await expect(topBar.getByText('Mar 14, 2031')).toBeVisible();
    await expect(topBar.getByText('Popularity')).toBeHidden();
    const overflow = await topBar.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, 'the top bar fits its width').toBeLessThanOrEqual(0);
    await expectNoHorizontalScroll(page);
  });

  test('a laptop-width window still marks the status figures as a sample', async ({
    page,
  }, testInfo) => {
    test.skip(isPhone(testInfo), 'Desktop layout only');
    await page.setViewportSize({ width: 1280, height: 800 });
    await settleOffice(page);

    const topBar = page.getByRole('banner');
    const status = topBar.getByRole('group', { name: 'Status (sample figures)' });
    await expect(status.getByText('Sample', { exact: true })).toBeVisible();
    await expect(status.getByText('Cash')).toBeVisible();
    await expect(topBar.getByRole('button', { name: 'Next day' })).toBeInViewport({ ratio: 1 });
    const overflow = await topBar.evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow, 'the top bar fits its width').toBeLessThanOrEqual(0);
    await expectNoHorizontalScroll(page);
  });

  test('desktop sidebar has the brand block and marks the current page with the rail', async ({
    page,
  }, testInfo) => {
    test.skip(isPhone(testInfo), 'Desktop layout only');
    await settleOffice(page);

    const promotion = page.getByTestId('promotion-block');
    await expect(promotion).toContainText('Longleaf Championship Wrestling');
    await expect(promotion).toContainText('Sample');

    const current = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Dashboard', exact: true });
    await expect(current).toHaveAttribute('aria-current', 'page');
    const rail = await current.evaluate((element) => getComputedStyle(element).boxShadow);
    expect(rail, 'the current item draws its rail').toContain('inset');
  });

  test('phone ticker sits right above the tab bar and the content clears both', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Phone layout only');
    await settleOffice(page);

    const ticker = page.getByTestId('ticker-slot');
    const tabBar = page.getByRole('navigation', { name: 'Primary' });
    await expect(ticker.getByRole('region', { name: 'News ticker' })).toBeVisible();
    const [tickerBox, tabBox] = await Promise.all([boxOf(ticker), boxOf(tabBar)]);
    expect(Math.abs(tickerBox.y + tickerBox.height - tabBox.y)).toBeLessThanOrEqual(1);

    await page.evaluate(() => {
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    const contentBottom = await page.evaluate(() => {
      const content = document.querySelector('#main > *');
      return content === null ? 0 : content.getBoundingClientRect().bottom;
    });
    const tickerTop = (await boxOf(ticker)).y;
    expect(contentBottom).toBeLessThanOrEqual(Math.ceil(tickerTop));
  });

  test('the office is a placeholder dashboard marked as sample data', async ({
    page,
  }, testInfo) => {
    await settleOffice(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('note')).toContainText('Sample data.');
    await expect(page.getByRole('group', { name: 'Key numbers' })).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: 'Longleaf Saturday Night' }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Champions', exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    const screenshot = await page.screenshot({ fullPage: !isPhone(testInfo) });
    await testInfo.attach(`office-${testInfo.project.name}.png`, {
      body: screenshot,
      contentType: 'image/png',
    });
  });
});
