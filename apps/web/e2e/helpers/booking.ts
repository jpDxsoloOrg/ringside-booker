import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { navigateInApp } from './shell';

/** The summary banner a finished advance leaves under the top bar. */
function lastAdvance(page: Page) {
  return page.getByRole('region', { name: 'Last advance' });
}

/** "Advanced 5 days to …" → 5; "Stayed on …" → 0. */
function daysAdvancedFrom(headline: string): number {
  const match = /Advanced ([\d,]+) days? to/i.exec(headline);
  return match === null ? 0 : Number((match[1] ?? '0').replace(/,/g, ''));
}

/**
 * Skips `days` days once through the Skip days sheet: the top bar's button on desktop, the status
 * sheet's on a phone. Waits for the summary of this advance and returns how many days it moved,
 * which is fewer when the show-day gate stopped it.
 */
export async function skipDaysOnce(page: Page, days: number, phone: boolean): Promise<number> {
  const summary = lastAdvance(page);
  const before = (await summary.count()) > 0 ? await summary.textContent() : null;

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
  await sheet.getByLabel('Days to skip').fill(String(days));
  await sheet.getByRole('button', { name: 'Start' }).click();

  await expect(summary).toBeVisible();
  await expect.poll(() => summary.textContent()).not.toBe(before);
  await expect(page.getByTestId('advance-overlay')).toBeHidden();
  return daysAdvancedFrom((await summary.textContent()) ?? '');
}

/**
 * Cancels the player's show that stands on today's date, from the Calendar's show sheet, the way
 * a player clears the show-day stop without booking it. The gate itself is never switched off.
 */
export async function cancelTonightsShow(page: Page): Promise<void> {
  await navigateInApp(page, '/game/calendar');
  await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();
  // Today is the grid's current day on desktop and the agenda's marked day on a phone.
  const today = page.locator('[role="gridcell"][aria-current="date"], li[data-today="true"]');
  const chip = today.locator('button[data-own="true"]:not([data-status="cancelled"])').first();
  const name = (await chip.getAttribute('title')) ?? '';
  await chip.click();

  const sheet = page.getByRole('dialog', { name, exact: true });
  await sheet.getByRole('button', { name: 'Cancel show' }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /^Cancel / }));
  await confirm.getByRole('button', { name: 'Cancel show' }).click();
  await expect(sheet.getByRole('button', { name: 'Cancel show' })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
}

/**
 * Skips `days` days in all. Whenever the show-day gate stops the skip on one of the player's
 * shows, that show is cancelled from the Calendar and the skip carries on with the days left.
 * Leaves the page on whatever screen the last step was on (the Calendar after a cancel).
 */
export async function skipDaysCancellingShows(
  page: Page,
  days: number,
  phone: boolean,
): Promise<void> {
  let left = days;
  // Every stop costs one cancelled show, so a week cannot need more rounds than it has days.
  for (let round = 0; left > 0 && round <= days; round += 1) {
    const moved = await skipDaysOnce(page, left, phone);
    left -= moved;
    if (left > 0) await cancelTonightsShow(page);
  }
  expect(left, 'every day of the skip ran').toBe(0);
}
