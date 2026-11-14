import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { cancelTonightsShow, gameDate, waitForAdvanceToEnd } from './booking';

/** The day bar's button with this name. */
export function dayButton(page: Page, name: string | RegExp): Locator {
  return page.getByTestId('day-control').getByRole('button', { name });
}

/**
 * Clears the expiring-contract stop (ECO4-04) the way a player does: the day bar's Contracts
 * button opens the Expiring tab, and Mark all seen clears every waiting notice, so the button
 * reads Next day again. A long skip on the default world meets the first one about a month in.
 */
export async function clearExpiringContracts(page: Page): Promise<void> {
  await dayButton(page, 'Contracts').click();
  await expect(page).toHaveURL(/\/game\/contracts\?tab=expiring$/);
  const banner = page.getByRole('region', { name: 'New expiry notices' });
  await banner.getByRole('button', { name: 'Mark all seen' }).click();
  await expect(dayButton(page, 'Contracts')).toBeHidden({ timeout: 15_000 });
}

/**
 * Opens Business > Contracts from the shell: the sidebar link on desktop, the More sheet on a
 * phone. Waits for the heading.
 */
export async function openContracts(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('link', { name: /^Contracts\b/ })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      // "Contracts", or "Contracts 2 want to leave" with its badge.
      .getByRole('link', { name: /^Contracts\b/ })
      .click();
  }
  await expect(page).toHaveURL(/\/game\/contracts(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Contracts' })).toBeVisible();
}

/** The contract rows on screen: table rows on desktop, cards on a phone. */
export function contractRows(page: Page): Locator {
  return page.getByRole('main').locator('tbody tr[data-row-id], li[data-row-id]');
}

/** The game's date (ISO), from the top bar. */
export { gameDate };

/** The ISO date `days` days after `date`. */
export function addIsoDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The day bar's buttons when the day stops (or doesn't). */
const DAY_BUTTONS = /^(Next day|(Tonight: )?Go to the show|Contracts|Roster)$/;

export interface StopHandlers {
  /** Called on the first expiring-contract stop instead of clearing it; true clears the rest. */
  readonly onContractsStop?: () => Promise<void>;
}

/**
 * Clears whatever stops the day the way a player who isn't booking would: the player's show
 * tonight is cancelled from the Calendar, an injury stop is opened from Roster, and expiry
 * notices are marked seen. Returns false when nothing stops the day.
 */
export async function clearDayStop(page: Page, handlers: StopHandlers = {}): Promise<boolean> {
  await expect(dayButton(page, DAY_BUTTONS)).toBeVisible({ timeout: 15_000 });
  const contracts = dayButton(page, 'Contracts');
  const roster = dayButton(page, 'Roster');
  const show = dayButton(page, /Go to the show$/);
  if (await contracts.isVisible()) {
    if (handlers.onContractsStop === undefined) await clearExpiringContracts(page);
    else await handlers.onContractsStop();
    return true;
  }
  if (await roster.isVisible()) {
    await roster.click();
    await expect(roster).toBeHidden({ timeout: 15_000 });
    return true;
  }
  if (await show.isVisible()) {
    await cancelTonightsShow(page);
    await expect(show).toBeHidden();
    return true;
  }
  return false;
}

/** The day bar's button when the day stops on your show night. */
const SHOW_STOP = /Go to the show$/;

/**
 * Clears the day's stops other than your show night (an injury, expiring contracts) the way a
 * player does, once the day bar has read them, and leaves the show night for the caller to book.
 * Returns true when your show night is waiting. A show can leave such a stop behind (a worker hurt
 * in it), and it turns Skip days off until it is cleared.
 */
export async function clearOtherStops(page: Page): Promise<boolean> {
  await expect(page.getByTestId('day-control')).not.toHaveAttribute('aria-busy', 'true');
  // Each pass clears one stop; a day has only a few kinds.
  for (let pass = 0; pass < 5; pass += 1) {
    if (await dayButton(page, SHOW_STOP).isVisible()) return true;
    if (!(await clearDayStop(page))) return false;
  }
  return dayButton(page, SHOW_STOP).isVisible();
}

/**
 * Skips to the start of `date` (Skip days with "Stop on a date"), clearing each stop on the way
 * with {@link clearDayStop}. Leaves the day's own stop, if it has one, for the caller.
 */
export async function skipToDateThroughStops(
  page: Page,
  date: string,
  phone: boolean,
  handlers: StopHandlers = {},
  maxStops = 60,
): Promise<void> {
  for (let stops = 0; (await gameDate(page)) < date; stops += 1) {
    expect(stops, 'the skip keeps stopping').toBeLessThan(maxStops);
    if (await clearDayStop(page, handlers)) continue;
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
    // A skip that stopped short stopped for something: wait for the day bar to say what.
    if ((await gameDate(page)) < date) await expect(dayButton(page, 'Next day')).toBeHidden();
  }
  expect(await gameDate(page)).toBe(date);
}

/** Opens the Skip days sheet: the top bar's button on desktop, the status sheet's on a phone. */
export async function openSkipDays(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page.getByRole('banner').getByTestId('status-date').click();
    await page
      .getByRole('dialog', { name: 'Status' })
      .getByRole('button', { name: 'Skip days' })
      .click();
  } else {
    await page.getByRole('banner').getByRole('button', { name: 'Skip days' }).click();
  }
  await expect(page.getByRole('dialog', { name: 'Skip days' })).toBeVisible();
}
