/**
 * Contracts end to end (ECO4-04), on desktop, phone and phone-webkit, in a new game on the default
 * world as Altura:
 *
 * 1. Business > Contracts lists Altura's contracts on the Active tab with kind, wage and end date.
 * 2. A contract opens in a sheet (a bottom sheet on a phone); Release shows the severance with its
 *    Why? and the cash after; confirming announces it with a link to the ledger, and the worker is
 *    on the Ended tab as Released.
 * 3. A long skip stops about a month in for a contract about to end. The day bar's button reads
 *    Contracts and opens the Expiring tab, where Mark all seen clears the stop: the button reads
 *    Next day again and the skip carries on.
 *
 * (A worker who wants to leave cannot happen in a new default world yet: nothing lowers morale
 * before WRK8. `contractStops.test.tsx` clears that stop with Grant and Refuse in the real shell.)
 *
 * Every screen has no sideways scroll; the Contracts screen has no serious axe findings.
 * Viewport screenshots go to `E2E_SHOTS=<folder>` when it is set.
 */
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { cancelTonightsShow, skipDaysOnce } from './helpers/booking';
import { dayButton } from './helpers/contracts';
import { startDefaultWorldGame } from './helpers/game';
import { expectFormFieldsAtLeast16px, expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const PROMOTION = 'Altura Wrestling Entertainment';

/** A new game builds the default world in the worker, then plays about a month. */
const FLOW_TIMEOUT_MS = 480_000;

/** Long enough to meet the first expiring contract (about 30 days in). */
const SKIP_DAYS = 45;

/** Steps (a skip or a cancelled show night: Altura runs about two shows a week) before the contract stop. */
const MAX_STOPS = 40;

const SHOTS_DIR = process.env['E2E_SHOTS'];

async function shot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${testInfo.project.name}.png` });
}

async function openContracts(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('link', { name: 'Contracts', exact: true })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Contracts', exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/game\/contracts(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Contracts' })).toBeVisible();
}

/** A contract's row: a table row on desktop, a card on a phone. */
function contractRows(page: Page) {
  return page.getByRole('main').locator('tbody tr[data-row-id], li[data-row-id]');
}

test.describe('contracts', () => {
  test('list, release with a Why?, and the expiring stop cleared from the day bar', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PROMOTION, { phone });

    let released = '';
    await test.step('Active lists Altura’s contracts with kind, wage and end date', async () => {
      await openContracts(page, phone);
      await expect(page.getByText(/^\d+ contracts · .+ a month · \d+ expiring soon/)).toBeVisible({
        timeout: 15_000,
      });
      const rows = contractRows(page);
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeGreaterThan(40);
      const first = rows.first();
      await expect(first).toContainText(/Written|Per appearance|Development|Tour/);
      await expect(first).toContainText(/\/mo|per show/);
      await expect(first).toContainText(/\d{4}\s*\d+ days?|No end date/);
      await expectNoHorizontalScroll(page);
      if (phone) await expectFormFieldsAtLeast16px(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'contracts-active', testInfo);
    });

    await test.step('Release from the sheet: severance with a Why?, then Ended', async () => {
      // A lower-card worker: cheap to let go, and never a champion.
      const row = contractRows(page)
        .filter({ hasText: /Lower card wrestler/ })
        .first();
      released = (
        (await row
          .getByRole(phone ? 'button' : 'link')
          .first()
          .textContent()) ?? ''
      ).trim();
      expect(released).not.toBe('');
      if (phone) await row.getByRole('button', { name: released, exact: true }).click();
      else await row.click({ position: { x: 4, y: 4 } });
      const sheet = page.getByRole('dialog', { name: released, exact: true });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('region', { name: 'Terms' })).toBeVisible();
      // Renew (ECO5-06) sits in the footer; outside the renewal window it says when talks open.
      await expect(sheet.getByRole('button', { name: 'Renew', exact: true })).toBeVisible();
      await expect(sheet).toBeInViewport({ ratio: 0.5 });
      await expectNoHorizontalScroll(page);
      await shot(page, 'contracts-sheet', testInfo);

      await sheet.getByRole('button', { name: 'Release', exact: true }).click();
      const confirm = page.getByRole('alertdialog', { name: `Release ${released}?` });
      await expect(confirm.getByText('Cash after')).toBeVisible();
      const why = confirm.getByRole('button', {
        name: new RegExp(`^Why is ${released}'s severance`),
      });
      await expect(why).toBeVisible();
      await shot(page, 'contracts-release', testInfo);
      await confirm.getByRole('button', { name: 'Release', exact: true }).click();
      await expect(confirm).toBeHidden();
      await expect(
        page.getByRole('status').getByText(`Released ${released}. Severance`, { exact: false }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'See it in the ledger' })).toBeVisible();

      await page.getByRole('tab', { name: 'Ended' }).click();
      await expect(page).toHaveURL(/\?tab=ended/);
      const ended = contractRows(page).filter({ hasText: released });
      await expect(ended).toContainText('Released');
      await expectNoHorizontalScroll(page);
      await shot(page, 'contracts-ended', testInfo);
    });

    await test.step('A long skip stops for an expiring contract; Contracts clears it', async () => {
      let left = SKIP_DAYS;
      let cleared = false;
      for (let stops = 0; left > 0; stops += 1) {
        expect(stops, 'the skip keeps stopping').toBeLessThan(MAX_STOPS);
        const contracts = dayButton(page, 'Contracts');
        const show = dayButton(page, /Go to the show$/);
        // A random new world can hurt one of Altura's workers on the way: that stop is cleared too.
        const roster = dayButton(page, 'Roster');
        await expect(
          dayButton(page, /^(Next day|(Tonight: )?Go to the show|Contracts|Roster)$/),
        ).toBeVisible({
          timeout: 15_000,
        });
        if (await contracts.isVisible()) {
          await shot(page, 'contracts-stop', testInfo);
          await contracts.click();
          await expect(page).toHaveURL(/\/game\/contracts\?tab=expiring$/);
          const banner = page.getByRole('region', { name: 'New expiry notices' });
          await expect(banner).toContainText(
            /close to (its|their) end date\. Skips stop until you’ve seen them\./,
          );
          await expect(contractRows(page).filter({ hasText: 'New' }).first()).toBeVisible();
          await expectNoHorizontalScroll(page);
          await expectNoSeriousA11yViolations(page);
          await shot(page, 'contracts-expiring', testInfo);
          await banner.getByRole('button', { name: 'Mark all seen' }).click();
          await expect(dayButton(page, 'Next day')).toBeVisible({ timeout: 15_000 });
          cleared = true;
          break;
        } else if (await roster.isVisible()) {
          await roster.click();
          await expect(roster).toBeHidden({ timeout: 15_000 });
        } else if (await show.isVisible()) {
          await cancelTonightsShow(page);
          await expect(show).toBeHidden();
        } else {
          left -= await skipDaysOnce(page, left, phone);
          if (left > 0) await expect(dayButton(page, 'Next day')).toBeHidden();
        }
      }
      expect(cleared, 'the skip stopped for an expiring contract').toBe(true);
    });

    if (phone) {
      await test.step('No sideways scroll at 360px either', async () => {
        await page.setViewportSize({ width: 360, height: 780 });
        await expectNoHorizontalScroll(page);
        await page.getByRole('tab', { name: 'Active' }).click();
        await expect(contractRows(page).first()).toBeVisible();
        await expectNoHorizontalScroll(page);
        await shot(page, 'contracts-active-360', testInfo);
      });
    }
  });
});
