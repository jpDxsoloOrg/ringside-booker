import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

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
