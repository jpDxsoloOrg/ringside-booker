import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  autoFillCard,
  gameDate,
  openBookingForTonight,
  pickWinnersAndRunShow,
  SHOW_STOP,
  waitForAdvanceToEnd,
  waitForDayBarSettled,
} from './booking';
import { clearDayStop, dayButton, openSkipDays } from './contracts';

/**
 * Moving time through a game whose own shows must really run: a televised show that doesn't run
 * is a missed airing (ECO8-07), so a TV deal only pays when its show is booked and run.
 */

/**
 * Books tonight's show with Auto-fill, picks a winner for every match and runs it (EVT2 / EVT10:
 * "Go live", then Sim the rest of the show). Leaves the page on the show's results.
 */
export async function runTonightsShow(page: Page, phone: boolean): Promise<void> {
  await openBookingForTonight(page);
  const sheet = await autoFillCard(page);
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
  await pickWinnersAndRunShow(page, phone);
  await waitForDayBarSettled(page);
}

export interface SkipRunningShowsOptions {
  /**
   * Called on each of the player's show nights on the way. Return true to run the show (the
   * default), false to cancel it from the Calendar instead.
   */
  readonly runShow?: (date: string) => boolean;
  /** At most this many stops before the skip fails as stuck. 40 by default. */
  readonly maxStops?: number;
}

/**
 * Skips to the start of `date` (Skip days with "Stop on a date"), running each of the player's
 * shows on the way (or cancelling it, when `options.runShow` says so) and clearing every other
 * stop the way a player would (expiring contracts, an injury, a news alert). When the skip lands
 * on a day that stops, that stop is left for the caller unless it is a show the caller wants run:
 * `date` itself has not run.
 */
export async function skipToDateRunningShows(
  page: Page,
  date: string,
  phone: boolean,
  options: SkipRunningShowsOptions = {},
): Promise<void> {
  const runShow = options.runShow ?? (() => true);
  const maxStops = options.maxStops ?? 40;
  for (let stops = 0; (await gameDate(page)) < date; stops += 1) {
    expect(stops, `the skip to ${date} keeps stopping`).toBeLessThan(maxStops);
    await waitForDayBarSettled(page);
    if (await dayButton(page, SHOW_STOP).isVisible()) {
      if (runShow(await gameDate(page))) {
        await runTonightsShow(page, phone);
        continue;
      }
    }
    // A show the caller does not want is cancelled here, with the other stops.
    if (await clearDayStop(page)) continue;
    const summary = page.getByRole('region', { name: 'Last advance' });
    const before = (await summary.count()) > 0 ? await summary.textContent() : null;
    const startDate = await gameDate(page);
    await openSkipDays(page, phone);
    const sheet = page.getByRole('dialog', { name: 'Skip days' });
    await sheet.getByLabel('Days to skip').fill('120');
    await sheet.getByRole('radio', { name: 'Stop on a date' }).check();
    await sheet.getByLabel('Stop on', { exact: true }).fill(date);
    await sheet.getByRole('button', { name: 'Start' }).click();
    await expect(sheet).toBeHidden();
    await waitForAdvanceToEnd(page, startDate, before);
  }
  expect(await gameDate(page)).toBe(date);
}
