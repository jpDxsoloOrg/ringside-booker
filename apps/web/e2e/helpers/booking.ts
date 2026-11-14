import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { closeWithEscape } from './overlays';
import { navigateInApp } from './shell';

/**
 * The show-day stop's button (EVT10-02): "Go live" (or "Back to the show" part-way through) under
 * the Live setting, the default; "Go to the show" under Auto. On a phone the short label is
 * "Tonight" and the accessible name "Tonight: <label>", which still ends with the label.
 */
export const SHOW_STOP_LABELS = '(?:Go to the show|Go live|Back to the show)';

/** Matches the show-day stop's button by its accessible name. */
export const SHOW_STOP = new RegExp(`${SHOW_STOP_LABELS}$`);

/** Matches the day bar's button when it is Next day, the show-day stop, or one of `others`. */
export function dayBarButtons(...others: readonly string[]): RegExp {
  return new RegExp(
    `^(Next day|(Tonight: )?${SHOW_STOP_LABELS}${others.map((other) => `|${other}`).join('')})$`,
  );
}

/** The summary banner a finished advance leaves under the top bar. */
function lastAdvance(page: Page) {
  return page.getByRole('region', { name: 'Last advance' });
}

/** The game's date (ISO), from the top bar. */
export async function gameDate(page: Page): Promise<string> {
  const time = page.getByRole('banner').locator('time[datetime]').first();
  return (await time.getAttribute('datetime')) ?? '';
}

/** Whole days from one ISO date to a later one. */
function daysBetween(from: string, to: string): number {
  const DAY_MS = 86_400_000;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

/**
 * How long an advance may take. Even a one-day skip runs every rival's show night and an autosave,
 * and with several browsers sharing a busy machine that has gone past the default five seconds.
 */
const ADVANCE_TIMEOUT = { timeout: 20_000 } as const;

/**
 * Waits until the day bar says what today holds: its answers are current and the engine has no
 * advance, command or query on its way (`data-settled`, from `useShellStatus`). Before that the bar
 * can still read Next day for a day that stops, or show a stop a screen is already clearing.
 */
export async function waitForDayBarSettled(page: Page): Promise<void> {
  await expect(page.getByTestId('day-control')).toHaveAttribute(
    'data-settled',
    'true',
    ADVANCE_TIMEOUT,
  );
}

/**
 * Waits for the advance just started to finish: the date moved or the summary changed (an
 * advance that stopped before its first day only says so in the summary), then the day bar has
 * settled on the day's stops.
 */
export async function waitForAdvanceToEnd(
  page: Page,
  startDate: string,
  summaryBefore: string | null,
): Promise<void> {
  const summary = lastAdvance(page);
  await expect
    .poll(async () => {
      if ((await gameDate(page)) !== startDate) return true;
      const now = (await summary.count()) > 0 ? await summary.textContent() : null;
      return now !== summaryBefore;
    }, ADVANCE_TIMEOUT)
    .toBe(true);
  await expect(page.getByTestId('advance-overlay')).toBeHidden(ADVANCE_TIMEOUT);
  await waitForDayBarSettled(page);
}

/** The day bar's "Open news" button: a news alert the player turned on stopped the day (DAY1-05). */
export function openNewsButton(page: Page) {
  return page.getByTestId('day-control').getByRole('button', { name: 'Open news' });
}

/**
 * Clears a news alert stop the way a player does: "Open news" opens the story on the News screen,
 * which clears the alert, then the story is closed. Returns false when no news stop waits.
 */
export async function clearNewsStop(page: Page): Promise<boolean> {
  await waitForDayBarSettled(page);
  const openNews = openNewsButton(page);
  if (!(await openNews.isVisible())) return false;
  await openNews.click();
  await expect(page).toHaveURL(/\/game\/news\?story=/);
  const story = page.getByRole('dialog');
  await expect(story).toBeVisible();
  // The story sheet is modal, so the day bar is read once it closes.
  await story.getByRole('button', { name: 'Close' }).click();
  await expect(story).toBeHidden();
  await waitForDayBarSettled(page);
  await expect(openNews).toBeHidden(ADVANCE_TIMEOUT);
  return true;
}

/**
 * Skips `days` days once through the Skip days sheet: the top bar's button on desktop, the status
 * sheet's on a phone. Waits for the advance to finish and returns how many days it moved, which
 * is fewer when a stop (the show-day gate, a contract notice) ended it early.
 *
 * It reads the days from the top bar's date, not from the summary banner: a one-day skip with
 * nothing to report leaves no banner (it is only announced), and a banner left over from the
 * advance before would read as this one's.
 */
export async function skipDaysOnce(page: Page, days: number, phone: boolean): Promise<number> {
  const summary = lastAdvance(page);
  const before = (await summary.count()) > 0 ? await summary.textContent() : null;
  const startDate = await gameDate(page);

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

  await waitForAdvanceToEnd(page, startDate, before);
  return daysBetween(startDate, await gameDate(page));
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
  // Every stop costs one cancelled show or one news story read, and each moves at least a day
  // after it, so a skip cannot need more rounds than it has days.
  for (let round = 0; left > 0 && round <= days; round += 1) {
    const moved = await skipDaysOnce(page, left, phone);
    left -= moved;
    if (left > 0 && !(await clearNewsStop(page))) await cancelTonightsShow(page);
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
 * From the show night screen (EVT10-02), runs whatever is left with **Sim the rest of the show**
 * and opens the results from the Show's over panel.
 */
export async function simRestOfShow(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/game\/show-night\/evi_/);
  const sim = page.getByRole('button', { name: 'Sim the rest of the show' });
  await expect(sim).toBeEnabled();
  await sim.click();
  await page.getByRole('button', { name: 'See the results' }).click();
  await expect(page).toHaveURL(/\/game\/event-history\/evi_/);
}

/**
 * Picks a winner for every match (see {@link pickWinners}), then runs tonight's show (EVT2-09:
 * there is no Lock card) from the side column's button on desktop, the sticky bar's on a phone:
 * **Go live** and then Sim the rest on show night under the Live setting (EVT10-02), **Run the
 * show** under Auto. Waits for the show's results page.
 */
export async function pickWinnersAndRunShow(page: Page, phone = false): Promise<void> {
  await pickWinners(page, phone);
  const run = page
    .getByRole('main')
    .getByRole('button', { name: /^(Run the show|Go live)$/ })
    .last();
  await expect(run).toBeEnabled();
  const live = (await run.textContent())?.includes('Go live') === true;
  await run.click();
  if (live) {
    await simRestOfShow(page);
    return;
  }
  await expect(page).toHaveURL(/\/game\/event-history\/evi_/);
}

/**
 * Follows the Last advance banner's link to tonight's show and lands on its card in Booking: under
 * the Live setting the link is "Go live" and show night sends a show with no card (or one with
 * problems) on to Booking with "Book the card" (or "Fix the card"); under Auto, "Go to the show".
 */
export async function openTonightsCardFromSummary(page: Page): Promise<void> {
  const summary = page.getByRole('region', { name: 'Last advance' });
  await summary.getByRole('link', { name: /^(Go to the show|Go live)$/ }).click();
  await onToTonightsCard(page);
}

/** As {@link openTonightsCardFromSummary}, from the day bar's show-day button. */
export async function openBookingForTonight(page: Page): Promise<void> {
  await page.getByTestId('day-control').getByRole('button', { name: SHOW_STOP }).click();
  await onToTonightsCard(page);
}

/** From wherever a show-night way in landed (show night or Booking), on to the card in Booking. */
async function onToTonightsCard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/game\/(booking|show-night)/);
  if (page.url().includes('/game/show-night/')) {
    await page.getByRole('button', { name: /^(Book the card|Fix the card)$/ }).click();
  }
  await expect(page).toHaveURL(/\/game\/booking/);
}
