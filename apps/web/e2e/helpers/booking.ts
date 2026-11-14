import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeWithEscape } from './overlays';
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
 * Waits until the day bar and the date beside it are current: after a day passes they keep the
 * last answer on screen, marked `aria-busy`, until the new one arrives. Read before that, the bar
 * can still say Next day when the day has already stopped for something.
 */
export async function expectDayBarSettled(page: Page): Promise<void> {
  await expect(page.locator('[data-testid="day-control"][aria-busy="true"]')).toHaveCount(0, {
    timeout: 15_000,
  });
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
  await expectDayBarSettled(page);
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
  // The confirm hides the sheet under it from role locators, so wait for it to go first: until
  // then the sheet's own Cancel show button reads as gone whether or not the show was cancelled.
  await expect(confirm).toBeHidden();
  await expect(sheet.getByRole('button', { name: 'Cancel show' })).toBeHidden();
  await closeWithEscape(page, sheet);
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

/* ---------------------------------------------------------------- the booking screen */

/** The reasons sheet Auto-fill opens: "Filled 6 slots", "Filled 1 slot", "Nothing was filled". */
export function autoFillSheet(page: Page) {
  return page.getByRole('dialog', { name: /^(Filled \d+ slots?|Nothing was filled)$/ });
}

/**
 * Presses **Auto-fill empty slots** on the Booking screen's Auto-fill panel and waits for the
 * reasons sheet, which it returns open. The caller closes it (its Done button).
 */
export async function autoFillCard(page: Page) {
  const panel = page.getByRole('region', { name: 'Auto-fill' });
  const fill = panel.getByRole('button', { name: 'Auto-fill empty slots' });
  await expect(fill).toBeEnabled();
  await fill.click();
  const sheet = autoFillSheet(page);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The row menu buttons of the card's filled slots, in running order. */
function slotMenus(page: Page) {
  return page.getByRole('main').getByRole('button', { name: /^Actions for slot \d+$/ });
}

/**
 * Picks side 1 as the winner of every match on the card, through each row's menu (Winner ▸ Side 1).
 * Talking segments have no Winner item and are left alone. Returns how many winners it picked.
 */
export async function pickWinners(page: Page, phone = false): Promise<number> {
  let picked = 0;
  const count = await slotMenus(page).count();
  for (let index = 0; index < count; index += 1) {
    const trigger = slotMenus(page).nth(index);
    const name = (await trigger.getAttribute('aria-label')) ?? '';
    await trigger.click();
    const menu = page.getByRole('menu', { name });
    await expect(menu).toBeVisible();
    const winner = menu.getByRole('menuitem', { name: 'Winner' });
    if ((await winner.count()) === 0) {
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      continue;
    }
    const sideOne = page.getByRole('menuitem', { name: /^Side 1: / });
    if (phone) await winner.tap();
    else await winner.click();
    // The item waits for the match type's way of winning to load.
    await expect(sideOne).toBeEnabled();
    if (phone) await sideOne.tap();
    else await sideOne.click();
    await expect(menu).toBeHidden();
    picked += 1;
  }
  return picked;
}

/**
 * Picks a winner for every match (see {@link pickWinners}), then runs tonight's show with **Run
 * the show** (EVT2-09: there is no Lock card): the side column's button on desktop, the sticky
 * bar's on a phone. Waits for the show's results page, which opens once it has run.
 */
export async function pickWinnersAndRunShow(page: Page, phone = false): Promise<void> {
  await pickWinners(page, phone);
  const run = page.getByRole('main').getByRole('button', { name: 'Run the show' }).last();
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page).toHaveURL(/\/game\/event-history\/evi_/);
}
