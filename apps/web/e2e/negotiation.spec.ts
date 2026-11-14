/**
 * Contract negotiation end to end (ECO5-06), on desktop, phone and phone-webkit, in a new game on
 * the default world as Altura:
 *
 * 1. Contracts › Free agents lists who Altura may talk to, each ask with a Why?.
 * 2. Make offer opens the Negotiation Sheet (full height on a phone); Use their ask fills the form
 *    and the meter reads "Likely to accept"; a much lower wage changes the label. Submit offer.
 * 3. A second free agent gets a low offer and counters the next day: the day bar stops with
 *    Contracts, which opens those talks, and Accept counter clears the stop (two taps).
 * 4. Days pass; the first worker signs ("Signed" on Offers' closed talks).
 * 5. Expiring: Renew on a contract opens the sheet for a renewal; their ask goes in; days pass and
 *    the renewal is signed.
 *
 * Every screen has no sideways scroll; the sheet's fields are 16px or more on a phone. Viewport
 * screenshots go to `E2E_SHOTS=<folder>` when it is set.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { cancelTonightsShow } from './helpers/booking';
import { dayButton } from './helpers/contracts';
import { startDefaultWorldGame } from './helpers/game';
import { expectFormFieldsAtLeast16px, expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const PROMOTION = 'Altura Wrestling Entertainment';
const FLOW_TIMEOUT_MS = 600_000;
const SHOTS_DIR = process.env['E2E_SHOTS'];

async function shot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${testInfo.project.name}.png` });
}

/** A list row: a table row on desktop, a card on a phone. */
function rows(page: Page): Locator {
  return page.getByRole('main').locator('tbody tr[data-row-id], li[data-row-id]');
}

function sheetNamed(page: Page, name: string | RegExp): Locator {
  return page.getByRole('dialog', { name });
}

/** Moves one day on, clearing a show-day stop by cancelling the show, a hurt-worker stop by
 * visiting the roster, and leaving any other stop for the caller. Returns the day bar's button. */
async function nextDay(page: Page): Promise<void> {
  for (let tries = 0; tries < 6; tries += 1) {
    const button = dayButton(page, /^(Next day|(Tonight: )?Go to the show|Contracts|Roster)$/);
    await expect(button).toBeVisible({ timeout: 20_000 });
    // A phone shows a short label and keeps the full one in the accessible name.
    const name = (await button.getAttribute('aria-label')) ?? (await button.textContent()) ?? '';
    if (/Go to the show/.test(name)) {
      await cancelTonightsShow(page);
      continue;
    }
    if (name.includes('Roster')) {
      await button.click();
      await expect(dayButton(page, 'Roster')).toBeHidden({ timeout: 15_000 });
      continue;
    }
    if (name.includes('Contracts')) return;
    const status = page.getByTestId('top-bar-status');
    const before = await status.textContent();
    await button.click();
    await expect(page.getByTestId('advance-overlay')).toBeHidden({ timeout: 20_000 });
    await expect(status).not.toHaveText(before ?? '', { timeout: 20_000 });
    // The stops are read again once the day has moved; let the day bar catch up before the next
    // press, so a button that turned into Contracts is not pressed as Next day.
    await page.waitForTimeout(500);
    return;
  }
}

/** Clears an expiry-notice stop if it is the one showing (the default world meets one ~29 days in). */
async function clearExpiringIfStopped(page: Page): Promise<boolean> {
  const contracts = dayButton(page, 'Contracts');
  if (!(await contracts.isVisible())) return false;
  await contracts.click();
  const banner = page.getByRole('region', { name: 'New expiry notices' });
  if (await banner.isVisible()) {
    await banner.getByRole('button', { name: 'Mark all seen' }).click();
    await expect(dayButton(page, 'Contracts')).toBeHidden({ timeout: 15_000 });
    return true;
  }
  return false;
}

async function openTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(`^${name}`) }).click();
}

/** Opens a row's Make offer and returns the worker's name and the sheet. */
async function makeOfferTo(page: Page, index: number): Promise<{ name: string; sheet: Locator }> {
  const row = rows(page)
    .filter({ has: page.getByRole('button', { name: 'Make offer' }) })
    .nth(index);
  const name = ((await row.getByRole('link').first().textContent()) ?? '').trim();
  expect(name).not.toBe('');
  await row.getByRole('button', { name: 'Make offer' }).click();
  const sheet = sheetNamed(page, name);
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Use their ask' })).toBeVisible({
    timeout: 20_000,
  });
  return { name, sheet };
}

function meter(sheet: Locator): Locator {
  return sheet.getByRole('meter', { name: 'Their likely reaction' });
}

test.describe('contract negotiation', () => {
  test('sign a free agent, answer a counter from the day bar, renew an expiring contract', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PROMOTION, { phone });
    await navigateInApp(page, '/game/contracts?tab=free-agents');

    let signed = '';
    await test.step('Free agents: asks with a Why?, Make offer, the meter follows the offer', async () => {
      await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalScroll(page);
      await shot(page, 'free-agents', testInfo);
      const why = rows(page)
        .first()
        .getByRole('button', { name: /^Why is .+'s ask/ });
      await why.click();
      const panel = page.getByRole('dialog', { name: /'s ask$/ });
      await expect(panel.getByRole('tree')).toBeVisible({ timeout: 20_000 });
      await panel.getByRole('button', { name: 'Close' }).click();
      await expect(panel).toBeHidden();

      const { name, sheet } = await makeOfferTo(page, 0);
      signed = name;
      await sheet.getByRole('button', { name: 'Use their ask' }).click();
      await expect(meter(sheet)).toHaveAttribute('aria-valuetext', /^Likely to accept/, {
        timeout: 20_000,
      });
      const wage = sheet.getByRole('textbox', { name: /^(Monthly wage|Fee per appearance)$/ });
      await wage.fill('1');
      await expect(meter(sheet)).toHaveAttribute('aria-valuetext', /^Will (walk away|reject)/, {
        timeout: 20_000,
      });
      await expect(
        sheet.getByRole('button', { name: /^Why will (walk away|reject)\?$/ }),
      ).toBeVisible();
      if (phone) await expectFormFieldsAtLeast16px(page);
      await expectNoHorizontalScroll(page);
      await shot(page, 'negotiation-sheet', testInfo);
      await sheet.getByRole('button', { name: 'Use their ask' }).click();
      await expect(meter(sheet)).toHaveAttribute('aria-valuetext', /^Likely to accept/, {
        timeout: 20_000,
      });
      await expectNoSeriousA11yViolations(page);
      await sheet.getByRole('button', { name: 'Submit offer' }).click();
      await expect(sheet.getByText(/They'll answer after the next day/)).toBeVisible({
        timeout: 20_000,
      });
      await expect(sheet.getByText(/^Considering your offer/)).toBeVisible();
      await sheet.getByRole('button', { name: 'Close' }).click();
    });

    await test.step('A low offer is countered; Contracts then Accept counter clears the stop', async () => {
      await expect(rows(page).first()).toBeVisible();
      const { sheet } = await makeOfferTo(page, 0);
      await sheet.getByRole('button', { name: 'Use their ask' }).click();
      const wage = sheet.getByRole('textbox', { name: /^(Monthly wage|Fee per appearance)$/ });
      const asked = Number(((await wage.inputValue()) || '0').replace(/\D/g, ''));
      await wage.fill(String(Math.round(asked * 0.62)));
      await expect(meter(sheet)).toHaveAttribute('aria-valuetext', /^Will counter/, {
        timeout: 20_000,
      });
      await sheet.getByRole('button', { name: 'Submit offer' }).click();
      await expect(sheet.getByText(/^Considering your offer/)).toBeVisible({ timeout: 20_000 });
      await sheet.getByRole('button', { name: 'Close' }).click();

      // The next day they counter, and the day bar stops on it.
      let stopped = false;
      for (let day = 0; day < 4 && !stopped; day += 1) {
        await nextDay(page);
        const contracts = dayButton(page, 'Contracts');
        if (await contracts.isVisible()) {
          await contracts.click();
          await expect(page).toHaveURL(/\/game\/contracts\?tab=(offers|expiring)/);
          if (/negotiation=neg_/.test(page.url())) {
            stopped = true;
          } else {
            const banner = page.getByRole('region', { name: 'New expiry notices' });
            await banner.getByRole('button', { name: 'Mark all seen' }).click();
            await expect(dayButton(page, 'Contracts')).toBeHidden({ timeout: 15_000 });
          }
        }
      }
      expect(stopped, 'the counter-offer stopped the day').toBe(true);
      await expect(page).toHaveURL(/\/game\/contracts\?tab=offers&negotiation=neg_\w+$/);
      // The talks are the only dialog open.
      const talks = page.getByRole('dialog');
      await expect(talks.getByText(/^Countered: answer by /)).toBeVisible({ timeout: 20_000 });
      await expect(talks.getByRole('button', { name: 'Accept counter' })).toBeVisible({
        timeout: 20_000,
      });
      await expect(talks.getByRole('button', { name: 'Send revised offer' })).toBeVisible();
      await expect(talks.getByRole('button', { name: 'End talks' })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, 'negotiation-countered', testInfo);
      await talks.getByRole('button', { name: 'Accept counter' }).click();
      await expect(talks.getByText(/They'll decide on /)).toBeVisible({ timeout: 20_000 });
      await talks.getByRole('button', { name: 'Close' }).click();
      // Two taps (Contracts, Accept counter) and the day moves again.
      await expect(dayButton(page, 'Next day')).toBeVisible({ timeout: 15_000 });
    });

    await test.step('Days pass and the first offer is signed', async () => {
      let done = false;
      for (let day = 0; day < 6 && !done; day += 1) {
        await clearExpiringIfStopped(page);
        await nextDay(page);
        await navigateInApp(page, '/game/contracts?tab=offers');
        await page.getByRole('switch', { name: 'Closed talks' }).check();
        done = await rows(page)
          .filter({ hasText: signed })
          .filter({ hasText: 'Signed' })
          .isVisible();
      }
      expect(done, `${signed} signed`).toBe(true);
      await expectNoHorizontalScroll(page);
      await shot(page, 'offers-closed', testInfo);
    });

    await test.step('Expiring: Renew opens the sheet for a renewal, and it is signed', async () => {
      await clearExpiringIfStopped(page);
      await navigateInApp(page, '/game/contracts?tab=expiring');
      await expect(
        page.getByText(/Contracts end on their date unless you renew them/),
      ).toBeVisible();
      const renew = rows(page).getByRole('button', { name: 'Renew', exact: true }).first();
      await expect(renew).toBeVisible({ timeout: 20_000 });
      await shot(page, 'expiring-renew', testInfo);
      await renew.click();
      const sheet = sheetNamed(page, /^Renew /);
      await expect(sheet.getByRole('button', { name: 'Use their ask' })).toBeVisible({
        timeout: 20_000,
      });
      const renewed = ((await sheet.getByRole('heading').first().textContent()) ?? '')
        .replace(/^Renew /, '')
        .trim();
      await sheet.getByRole('button', { name: 'Use their ask' }).click();
      await expect(meter(sheet)).toHaveAttribute('aria-valuetext', /^Likely to accept/, {
        timeout: 20_000,
      });
      await expectNoHorizontalScroll(page);
      await shot(page, 'renewal-sheet', testInfo);
      await sheet.getByRole('button', { name: 'Offer renewal' }).click();
      await expect(sheet.getByText(/^Considering your offer/)).toBeVisible({ timeout: 20_000 });
      await sheet.getByRole('button', { name: 'Close' }).click();

      let done = false;
      for (let day = 0; day < 6 && !done; day += 1) {
        await clearExpiringIfStopped(page);
        await nextDay(page);
        await navigateInApp(page, '/game/contracts?tab=offers');
        await page.getByRole('switch', { name: 'Closed talks' }).check();
        done = await rows(page)
          .filter({ hasText: renewed })
          .filter({ hasText: 'Signed' })
          .isVisible();
      }
      expect(done, `${renewed}'s renewal signed`).toBe(true);
    });

    if (phone) {
      await test.step('No sideways scroll at 360px either', async () => {
        await page.setViewportSize({ width: 360, height: 780 });
        await openTab(page, 'Free agents');
        await expect(rows(page).first()).toBeVisible();
        await expectNoHorizontalScroll(page);
      });
    }
  });
});
