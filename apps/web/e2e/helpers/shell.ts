import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** The dev helper's promotion parameter: any value means "runs a promotion". */
export const DEV_PROMOTION_PARAM = 'pro_dev';

export interface EnterShellOptions {
  /** Whether the faked seat runs a promotion. True by default. */
  readonly employed?: boolean;
}

/**
 * Opens the in-game shell with a faked loaded world, through the dev-only `/dev/enter-shell`
 * route (registered in the e2e build), and waits for the office to show.
 */
export async function enterShell(page: Page, options: EnterShellOptions = {}): Promise<void> {
  const employed = options.employed ?? true;
  await page.goto(
    employed ? `/dev/enter-shell?promotion=${DEV_PROMOTION_PARAM}` : '/dev/enter-shell',
  );
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/**
 * Moves to another in-game path without reloading, so the faked world stays loaded. A full
 * `page.goto` would start a fresh app with no world, and the guard would send it to the title.
 */
export async function navigateInApp(page: Page, path: string): Promise<void> {
  await page.evaluate((targetPath) => {
    window.history.pushState(null, '', targetPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  // A screen may add its own query once it opens (Booking selects a show: `?event=`), so a
  // query the path did not ask for is allowed after it.
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  await expect(page).toHaveURL(new RegExp(`${escaped}${path.includes('?') ? '' : '(\\?.*)?'}$`));
}

/**
 * Skips days through the Skip days sheet's "Stop on a date" (the top bar's button on desktop, the
 * status sheet's on a phone) so the game stops at the start of `date` (`YYYY-MM-DD`): the day
 * before it has run, `date` itself has not. A skip still stops early for the player's shows and
 * decisions; the caller deals with that stop and calls this again. Waits for the advance to end.
 */
export async function skipToDate(page: Page, date: string, phone: boolean): Promise<void> {
  const summary = page.getByRole('region', { name: 'Last advance' });
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
  // Long enough to reach the date; the stop date ends the skip first.
  await sheet.getByLabel('Days to skip').fill('90');
  await sheet.getByRole('radio', { name: 'Stop on a date' }).check();
  await sheet.getByLabel('Stop on', { exact: true }).fill(date);
  await sheet.getByRole('button', { name: 'Start' }).click();
  await expect(sheet).toBeHidden();
  await expect(summary).toBeVisible();
  await expect.poll(() => summary.textContent()).not.toBe(before);
  await expect(page.getByTestId('advance-overlay')).toBeHidden();
}
