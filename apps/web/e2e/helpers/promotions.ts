import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openPromotions } from './game';

/**
 * Opens World > Promotions, then `promotion`'s profile (by its full name) and its `tab` ("Shows",
 * "Decision log", ...). The list is a grid on desktop and cards on a phone; either way the name is
 * a link. Waits for the profile's heading and the tab to be selected.
 */
export async function openPromotionTab(
  page: Page,
  promotion: string,
  tab: string,
  phone: boolean,
): Promise<void> {
  await openPromotions(page, phone);
  await page.getByRole('main').getByRole('link', { name: promotion, exact: true }).first().click();
  await expect(page).toHaveURL(/\/game\/promotions\/pro_[a-z0-9]+(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: promotion })).toBeVisible();
  const tabButton = page.getByRole('tab', { name: tab, exact: true });
  await tabButton.click();
  await expect(tabButton).toHaveAttribute('aria-selected', 'true');
}
