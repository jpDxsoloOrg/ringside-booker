/**
 * The top bar's status and day control against the real engine and day pipeline in the worker,
 * entered through the sample save. Desktop: Next day moves the date chip and a 7-day skip stops
 * at the player's unbooked show with its summary. Phone: the compact bar holds the date and the day button on one line, the
 * status sheet opens from the date, the skip sheet is a bottom sheet, and the progress overlay and
 * its Stop button fit the screen.
 */
import type { Locator, Page } from '@playwright/test';
import { allowConsoleError, expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromSampleSave } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

/** The sample world's date, and the days after it, as the date chip writes them. */
const SAMPLE_DATE_LONG = 'Friday, April 10, 2026';
const NEXT_DATE_LONG = 'Saturday, April 11, 2026';
const WEEK_LATER_LONG = 'Saturday, April 18, 2026';
/** The sample world's next weekly show, which the player has not booked. */
const SHOW_DATE_LONG = 'Thursday, April 16, 2026';
const SHOW_REASON = "Your show 'Test Weekly' has no card yet";
const SAMPLE_DATE_SHORT = 'Apr 10, 2026';

/** UI scales the phone bar is checked at: the default, a step up and the largest. */
const PHONE_BAR_SCALES = ['1', '1.25', '1.5'] as const;

/** The self-hosted font files. Blocking them leaves the fallback fonts, which run wider. */
const WEB_FONT_FILES = /\.woff2?$/;

/** The smallest touch target, 2.75rem at the default 16px root size. */
const TAP_TARGET_MIN_PX = 44;

/** The longest skip, so there is time to see the overlay and stop it. */
const LONG_SKIP_DAYS = '3650';

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The element did not lay out');
  return box;
}

function viewportOf(page: Page): { width: number; height: number } {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('The page has no viewport size');
  return viewport;
}

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  const box = await boxOf(locator);
  const viewport = viewportOf(page);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

/**
 * The bug's icon is drawn whole (at least its 1em size, not squashed by a shrinking bar) and
 * inside the bug, so a bug down to its dot and icon still shows what it does.
 */
async function expectIconWhole(button: Locator): Promise<void> {
  const icon = button.locator('svg');
  const fontSize = await icon.evaluate((svg) => parseFloat(getComputedStyle(svg).fontSize));
  const iconBox = await boxOf(icon);
  const buttonBox = await boxOf(button);
  expect(iconBox.width).toBeGreaterThanOrEqual(fontSize - 0.5);
  expect(iconBox.x).toBeGreaterThanOrEqual(buttonBox.x);
  expect(iconBox.x + iconBox.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width);
}

/** Where the overlay and its Stop button sat the moment the overlay opened. */
interface OverlayOpening {
  readonly overlay: Box;
  readonly stop: Box;
  readonly text: string;
}

declare global {
  interface Window {
    __overlayOpening?: OverlayOpening;
  }
}

/** Runs in the page: records the overlay's layout as soon as its dialog opens. */
function recordOverlayOpening(): void {
  const dialog = document.querySelector('[data-testid="advance-overlay"]');
  if (!(dialog instanceof HTMLDialogElement)) throw new Error('No progress overlay in the page');
  const toBox = (element: Element): Box => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  };
  const observer = new MutationObserver(() => {
    if (!dialog.open) return;
    const stop = dialog.querySelector('button');
    if (stop === null) return;
    window.__overlayOpening = {
      overlay: toBox(dialog),
      stop: toBox(stop),
      text: dialog.textContent,
    };
    observer.disconnect();
  });
  observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
}

function dayButton(page: Page, name: string): Locator {
  return page.getByTestId('day-control').getByRole('button', { name });
}

/** Sets the UI scale on the settings screen; it is stored, so the next load starts with it. */
async function setUiScale(page: Page, scale: string): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('slider', { name: 'UI scale' }).fill(scale);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')))
    .toBe(scale);
}

test.describe('day control', () => {
  test('desktop: Next day moves the date, and a 7-day skip stops at the unbooked show', async ({
    page,
  }, testInfo) => {
    test.skip(isPhone(testInfo), 'The desktop top bar');
    await enterGameFromSampleSave(page);

    const dateChip = page.getByTestId('date-chip');
    await expect(dateChip).toContainText(SAMPLE_DATE_LONG);
    await expect(dateChip).toContainText('Season 2');
    await expect(page.getByTestId('cash-chip')).toBeVisible();
    await expect(page.getByTestId('popularity-chip')).toBeVisible();
    await expectNoSeriousA11yViolations(page);

    await dayButton(page, 'Next day').click();
    await expect(dateChip).toContainText(NEXT_DATE_LONG);

    await page.getByRole('button', { name: 'Skip days' }).click();
    const sheet = page.getByRole('dialog', { name: 'Skip days' });
    await expect(sheet).toHaveAttribute('data-side', 'right');
    await sheet.getByRole('button', { name: '7 days' }).click();
    await expect(sheet).toContainText(`Until ${WEEK_LATER_LONG}`);
    await sheet.getByRole('button', { name: 'Start' }).click();

    const summary = page.getByRole('region', { name: 'Last advance' });
    // The show-day gate stops the skip before the player's show on Thursday the 16th.
    await expect(summary).toContainText(`Advanced 5 days to ${SHOW_DATE_LONG}`);
    await expect(summary).toContainText(SHOW_REASON);
    await expect(summary.getByRole('link', { name: 'Go to the show' })).toBeVisible();
    await expect(dayButton(page, 'Go to the show')).toBeVisible();
    await expect(dateChip).toContainText(SHOW_DATE_LONG);
    await expectNoSeriousA11yViolations(page);
  });

  test('phone: one-line bar, status sheet, bottom skip sheet and an overlay that fits', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'The phone top bar');
    await enterGameFromSampleSave(page);

    await test.step('the bar shows the date and the day button on one line', async () => {
      const dateButton = page.getByTestId('status-date');
      const nextDay = dayButton(page, 'Next day');
      await expect(dateButton).toContainText(SAMPLE_DATE_SHORT);
      await expect(nextDay).toBeVisible();
      const dateBox = await boxOf(dateButton);
      const buttonBox = await boxOf(nextDay);
      const middle = (box: Box) => box.y + box.height / 2;
      expect(Math.abs(middle(dateBox) - middle(buttonBox))).toBeLessThan(4);
      await expectInsideViewport(page, dateButton);
      await expectInsideViewport(page, nextDay);
      await expectIconWhole(nextDay);
      await expect(page.getByRole('banner').getByTestId('cash-chip')).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });

    await test.step('the date opens the status sheet with the season', async () => {
      await page.getByTestId('status-date').click();
      const statusSheet = page.getByRole('dialog', { name: 'Status' });
      await expect(statusSheet).toHaveAttribute('data-side', 'bottom');
      await expect(statusSheet.getByTestId('date-chip')).toContainText('Season 2');
      await expect(statusSheet.getByTestId('cash-chip')).toBeVisible();
      await expect(statusSheet.getByTestId('popularity-chip')).toBeVisible();
      await statusSheet.getByRole('button', { name: 'Skip days' }).click();
    });

    await test.step('Skip days is a bottom sheet', async () => {
      const skipSheet = page.getByRole('dialog', { name: 'Skip days' });
      await expect(skipSheet).toHaveAttribute('data-side', 'bottom');
      await skipSheet.getByLabel('Days to skip').fill(LONG_SKIP_DAYS);
      await expectNoHorizontalScroll(page);
      await page.evaluate(recordOverlayOpening);
      await skipSheet.getByRole('button', { name: 'Start' }).click();
    });

    await test.step('the progress overlay fits, with Stop in reach', async () => {
      // The tiny sample world can run ten years in well under a second, so the overlay's layout
      // is recorded by the page the moment it opens rather than looked for afterwards.
      const opened = await page.waitForFunction(() => window.__overlayOpening ?? null);
      const layout = await opened.jsonValue();
      if (layout === null) throw new Error('The progress overlay never opened');
      const viewport = viewportOf(page);
      for (const box of [layout.overlay, layout.stop]) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.y).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      }
      expect(layout.stop.height).toBeGreaterThanOrEqual(44);
      expect(layout.text).toMatch(/Day [\d,]+ of 3,650/);

      const overlay = page.getByTestId('advance-overlay');
      const stop = overlay.getByRole('button', { name: 'Stop' });
      if (await stop.isVisible()) {
        try {
          await stop.click({ timeout: 2000 });
        } catch {
          // The skip finished between the check and the click; the summary below still applies.
        }
      }
      await expect(overlay).toBeHidden();
    });

    await test.step('the summary says how far it got and fits the screen', async () => {
      const summary = page.getByRole('region', { name: 'Last advance' });
      await expect(summary).toContainText(/Advanced [\d,]+ days to/);
      await expectNoHorizontalScroll(page);
    });
  });

  // A large UI scale on a 390px phone leaves the bar short of room, and the fallback fonts that
  // show until the web fonts load run wider still. The day button gives way (its label shortens,
  // then hides behind the dot and the icon, which stay whole), then the date drops its year, so
  // the bar never pushes the page sideways.
  for (const fonts of ['web fonts', 'fallback fonts'] as const) {
    for (const scale of PHONE_BAR_SCALES) {
      test(`phone: the bar fits at ${scale}x UI scale with the ${fonts}`, async ({
        page,
      }, testInfo) => {
        test.skip(!isPhone(testInfo), 'The phone top bar');
        if (fonts === 'fallback fonts') {
          // Chromium logs each blocked request as an error; only these are expected.
          allowConsoleError('net::ERR_BLOCKED_BY_CLIENT');
          await page.route(WEB_FONT_FILES, (route) => route.abort('blockedbyclient'));
        }
        await setUiScale(page, scale);
        await enterGameFromSampleSave(page);

        const dateButton = page.getByTestId('status-date');
        const nextDay = dayButton(page, 'Next day');
        await expect(dateButton).toContainText(SAMPLE_DATE_SHORT);
        await expect(nextDay).toBeVisible();
        await expectInsideViewport(page, dateButton);
        await expectInsideViewport(page, nextDay);
        expect((await boxOf(nextDay)).width).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);
        await expectIconWhole(nextDay);
        await expectNoHorizontalScroll(page);
      });
    }
  }
});
