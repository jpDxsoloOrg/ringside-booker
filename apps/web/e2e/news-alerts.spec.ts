/**
 * News alerts stop long skips, and the stop is always cleared from where it sends the player
 * (DAY1-05), on desktop, phone and phone-webkit. The news save (`fixtures/build-news-save.ts`) has
 * three of the player's wrestlers reaching ten years in the ring over the next three weeks and no
 * more shows (the champion's 100 days with the title lands in the second week too). The player turns on "My roster" in the News alerts sheet; then each 30-day skip stops
 * on "Open news" with the "News: …" reason, the button opens the story and clears the alert, and
 * Next day comes back. After the third stop a skip runs its full length.
 *
 * Every view fits the viewport with no serious axe findings, and both sheets are bottom sheets on
 * a phone.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromNewsSave } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

/** The anniversaries post on three Mondays: the skips stop on the Tuesdays after them. */
const STOP_DATES = [
  'Tuesday, April 14, 2026',
  'Tuesday, April 21, 2026',
  'Tuesday, April 28, 2026',
];
const LAST_SKIP_END = 'Thursday, May 28, 2026';
const NEWS_REASON = /News: Milestone – /;

function dayControl(page: Page): Locator {
  return page.getByTestId('day-control');
}

function dayButton(page: Page, name: string): Locator {
  return dayControl(page).getByRole('button', { name });
}

/** Waits until the day button says what today holds (UI-35), then checks its label. */
async function expectDayButton(page: Page, name: string): Promise<void> {
  await expect(dayControl(page)).toHaveAttribute('data-settled', 'true', { timeout: 30_000 });
  await expect(dayButton(page, name)).toBeVisible();
}

/** Opens the Skip days sheet: the top bar's button on desktop, the status sheet's on a phone. */
async function openSkipSheet(page: Page, phone: boolean): Promise<Locator> {
  if (phone) {
    await page.getByRole('banner').getByTestId('status-date').click();
    await page
      .getByRole('dialog', { name: 'Status' })
      .getByRole('button', { name: 'Skip days' })
      .click();
  } else {
    await page.getByRole('banner').getByRole('button', { name: 'Skip days' }).click();
  }
  const sheet = page.getByRole('dialog', { name: 'Skip days' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Skips 30 days from the chip and waits for the advance to end. */
async function skipThirtyDays(page: Page, phone: boolean): Promise<Locator> {
  const sheet = await openSkipSheet(page, phone);
  await sheet.getByRole('button', { name: '30 days' }).click();
  await sheet.getByRole('button', { name: 'Start' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId('advance-overlay')).toBeHidden();
  return page.getByRole('region', { name: 'Last advance' });
}

test.describe('news alerts', () => {
  test('turn on an alert, and skip through three news stops to the end', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    const phone = isPhone(testInfo);
    await enterGameFromNewsSave(page);

    await test.step('the News alerts sheet turns on My roster', async () => {
      await navigateInApp(page, '/game/news');
      await page.getByRole('button', { name: 'Alerts' }).click();
      const alerts = page.getByRole('dialog', { name: 'News alerts' });
      await expect(alerts).toHaveAttribute('data-side', phone ? 'bottom' : 'right');
      await expect(alerts.getByRole('switch', { name: 'Front-page stories' })).toBeChecked();
      const roster = alerts.getByRole('switch', { name: 'My roster' });
      await expect(roster).not.toBeChecked();
      await expect(
        alerts.getByRole('switch', { name: 'Stop long skips for these stories' }),
      ).toBeChecked();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await roster.click();
      await alerts.getByRole('button', { name: 'Save' }).click();
      await expect(alerts).toBeHidden();
    });

    await test.step('the Skip sheet offers the targets, and Alert settings shows the change', async () => {
      const sheet = await openSkipSheet(page, phone);
      await expect(sheet).toHaveAttribute('data-side', phone ? 'bottom' : 'right');
      for (const name of ['7 days', '30 days', '90 days', 'Until the 1st of next month']) {
        await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible();
      }
      await expect(
        sheet.getByRole('button', { name: 'Until the 1st of next month' }),
      ).toHaveAccessibleDescription('Fri 1 May 2026 · 21 days');
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);

      const link = sheet.getByRole('button', { name: 'Alert settings' });
      await link.click();
      const alerts = page.getByRole('dialog', { name: 'News alerts' });
      await expect(alerts.getByRole('switch', { name: 'My roster' })).toBeChecked();
      await alerts.getByRole('button', { name: 'Cancel' }).click();
      await expect(alerts).toBeHidden();
      await expect(link).toBeFocused();
      await sheet.getByRole('button', { name: 'Cancel' }).click();
      await expect(sheet).toBeHidden();
    });

    for (const [index, stopDate] of STOP_DATES.entries()) {
      await test.step(`news stop ${String(index + 1)}: Open news clears it`, async () => {
        const summary = await skipThirtyDays(page, phone);
        await expect(summary).toContainText(`to ${stopDate}`);
        await expect(summary).toContainText(NEWS_REASON);
        await expectDayButton(page, 'Open news');
        if (index === 0) {
          await expectNoHorizontalScroll(page);
          await expectNoSeriousA11yViolations(page);
        }

        await dayButton(page, 'Open news').click();
        // The screen clears the alert and drops `alert=1`, keeping the story open.
        await expect(page).toHaveURL(/\/game\/news\?story=nws_[a-z0-9]+$/);
        // A career anniversary, or a reign milestone of the player's champion the same week.
        const story = page.getByRole('dialog', { name: /(years in the ring|days holding)/ });
        await expect(story).toBeVisible();
        // The story sheet is modal; once it closes the day bar is back in reach.
        await story.getByRole('button', { name: 'Close' }).click();
        await expect(story).toBeHidden();
        await expectDayButton(page, 'Next day');
      });
    }

    await test.step('with every alert read, a skip runs its full length', async () => {
      const summary = await skipThirtyDays(page, phone);
      await expect(summary).toContainText(`Advanced 30 days to ${LAST_SKIP_END}`);
      await expect(summary).not.toContainText(NEWS_REASON);
      await expectDayButton(page, 'Next day');
      await expectNoHorizontalScroll(page);
    });
  });
});
