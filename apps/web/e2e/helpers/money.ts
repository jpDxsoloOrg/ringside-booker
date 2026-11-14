import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Money from the e2e side: reading amounts as the screens print them, and the top bar's cash.
 */

/** Money in full ("$28,000" rather than "$28K"), so exact amounts can be compared. */
export async function useFullMoney(page: Page): Promise<void> {
  await page.goto('/settings');
  const full = page
    .getByRole('group', { name: 'Money' })
    .getByRole('radio', { name: 'Full', exact: true });
  await full.check();
  await expect(full).toBeChecked();
}

/** The first amount in `text` ("$85,000", "−$1,250.50"), in cents. */
export function centsOf(text: string): number {
  const match = /([−-])?\$([\d,]+)(?:\.(\d{2}))?/.exec(text);
  if (match === null) throw new Error(`No money in "${text}"`);
  const value = Number((match[2] ?? '0').replace(/,/g, '')) * 100 + Number(match[3] ?? '0');
  return match[1] === undefined ? value : -value;
}

/** The cash in the top bar (in its status sheet on a phone), in cents. */
export async function topBarCash(page: Page, phone: boolean): Promise<number> {
  if (!phone) {
    return centsOf((await page.getByRole('banner').getByTestId('cash-chip').textContent()) ?? '');
  }
  await page.getByRole('banner').getByTestId('status-date').click();
  const sheet = page.getByRole('dialog', { name: 'Status' });
  const text = (await sheet.getByTestId('cash-chip').textContent()) ?? '';
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  return centsOf(text);
}
