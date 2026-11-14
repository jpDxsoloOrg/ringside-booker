/**
 * ECO5-09 end to end, on desktop, phone and phone-webkit, in a new game on the default world as
 * Altura:
 *
 * 1. Workers filtered to free agents (women, sorted by age) → a free agent's profile → Offer
 *    contract opens the Negotiation Sheet over the profile (the URL keeps the profile and adds
 *    `person=`); Use their ask, Submit offer, Close: still the profile. Back to Workers returns to
 *    the same filtered, sorted list.
 * 2. Contracts › Free agents sorted by Ask (a header click on desktop, "Sort by" on a phone): the
 *    sort is in the URL and the asks run from lowest up; a reload keeps the order.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { contractRows } from './helpers/contracts';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { centsOf, useFullMoney } from './helpers/money';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const PROMOTION = 'Altura Wrestling Entertainment';
const FLOW_TIMEOUT_MS = 300_000;
const WORKERS_LIST = '/game/workers?employer=free&gender=female&sort=age%3Aasc';

/** The monthly asks on the first rows of Free agents, in cents, in the order shown. */
async function monthlyAsks(page: Page, count: number): Promise<number[]> {
  const asks: number[] = [];
  const rows = contractRows(page);
  for (let index = 0; index < count; index += 1) {
    const text = (await rows.nth(index).textContent()) ?? '';
    const ask = /(\$[\d,]+)\/mo/.exec(text)?.[1];
    if (ask !== undefined) asks.push(centsOf(ask));
  }
  return asks;
}

async function sortByAsk(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page.getByRole('combobox', { name: 'Sort by' }).click();
    await page.getByRole('option', { name: 'Ask' }).click();
    return;
  }
  await page.getByRole('main').getByRole('button', { name: /^Ask/ }).click();
}

function sheet(page: Page): Locator {
  return page.getByRole('dialog');
}

test.describe('Contracts sort and filter (ECO5-09)', () => {
  test('offer from a filtered Workers list without leaving it; sort Free agents by Ask', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await useFullMoney(page);
    await startDefaultWorldGame(page, PROMOTION, { phone });

    await test.step('Workers → profile → Offer contract over the profile → Back', async () => {
      await navigateInApp(page, WORKERS_LIST);
      const link = contractRows(page).first().getByRole('link').first();
      await expect(link).toBeVisible({ timeout: 30_000 });
      await link.click();
      await expect(page).toHaveURL(/\/game\/workers\/per_\w+$/);
      const profilePath = new URL(page.url()).pathname;

      await page.getByRole('button', { name: 'Offer contract' }).click({ timeout: 20_000 });
      await expect(page).toHaveURL(new RegExp(`${profilePath}\\?person=per_\\w+$`));
      const talks = sheet(page);
      await talks.getByRole('button', { name: 'Use their ask' }).click({ timeout: 20_000 });
      await talks.getByRole('button', { name: 'Submit offer' }).click();
      await expect(talks.getByText(/They'll answer after the next day/)).toBeVisible({
        timeout: 20_000,
      });
      await expectNoHorizontalScroll(page);
      await talks.getByRole('button', { name: 'Close' }).click();
      await expect(talks).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`${profilePath}$`));

      await page.getByRole('link', { name: 'Back to Workers' }).click();
      await expect(page).toHaveURL(new RegExp(`${WORKERS_LIST.replace(/[?]/g, '\\?')}$`));
    });

    await test.step('Free agents sorted by Ask, lowest first, kept on a reload', async () => {
      await navigateInApp(page, '/game/contracts?tab=free-agents');
      await expect(contractRows(page).first()).toBeVisible({ timeout: 30_000 });
      await sortByAsk(page, phone);
      await expect(page).toHaveURL(/sort=ask%3A(asc|desc)/);
      if (page.url().includes('sort=ask%3Adesc')) {
        if (phone) {
          await page
            .getByRole('button', { name: /descending|ascending/i })
            .first()
            .click();
        } else {
          await sortByAsk(page, phone);
        }
      }
      await expect(page).toHaveURL(/sort=ask%3Aasc/);
      const asks = await monthlyAsks(page, 5);
      expect(asks.length).toBeGreaterThan(1);
      expect(asks).toEqual([...asks].sort((left, right) => left - right));

      await page.reload();
      await expect(contractRows(page).first()).toBeVisible({ timeout: 30_000 });
      expect(await monthlyAsks(page, 5)).toEqual(asks);
    });
  });
});
