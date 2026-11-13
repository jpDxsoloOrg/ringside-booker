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
