/**
 * Injuries and recovery end to end (WRK6-08), the owner's test script on desktop, phone and
 * phone-webkit, in a real new game on the default world as Altura with a known seed
 * (`HEALTH_E2E_SEED`, found by `packages/engine/test/support/findHealthSeed.ts`):
 *
 * 1. World > Workers > Injured is empty: a new world starts healthy.
 * 2. Skip days 30. Altura's show nights stop it first (each show is cancelled from the Calendar, as
 *    a player who does not want to book it would), then it stops with "<name> was injured" and a
 *    "Roster" button. The button opens Roster > Injuries, which marks the injury seen, so the day
 *    button reads Next day again.
 * 3. Workers > Injured lists the worker with the injury, the body part and the return date.
 * 4. Their Health tab shows the injury card; the Time out Why? names the days, the severity and
 *    the medical care; the hurt part's bar says "Injured"; the profile's chip says Injured.
 * 5. Skipping past the return date: the card is gone (Fit to work), the injury is in the history
 *    and the chip reads Available.
 *
 * Every screen has no sideways scroll; Health and the Injured view have no serious axe findings.
 * Screenshots go to `E2E_SHOTS=<folder>` when it is set.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { cancelTonightsShow, skipDaysOnce } from './helpers/booking';
import { HEALTH_E2E_SEED, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const PROMOTION = 'Altura Wrestling Entertainment';

/** A new game builds the default world in the worker, then plays a month: one long test. */
const FLOW_TIMEOUT_MS = 420_000;

/** Skip days asked for at first, as in the owner's script. */
const FIRST_SKIP_DAYS = 30;

/** Show nights the seed can meet in a skip before it stops for the injury. */
const MAX_STOPS = 10;

const SHOTS_DIR = process.env['E2E_SHOTS'];

async function shot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${testInfo.project.name}.png` });
}

function dayButton(page: Page, name: string | RegExp): Locator {
  return page.getByTestId('day-control').getByRole('button', { name });
}

function lastAdvance(page: Page): Locator {
  return page.getByRole('region', { name: 'Last advance' });
}

/**
 * Skips `days` days in all, cancelling each of the player's shows that stops the day (the game can
 * start on a show night). With `untilInjury` it returns true as soon as the day stops for an own
 * injury, leaving that stop up; otherwise an injury stop is cleared from its Roster button and
 * the skip carries on. Returns false when every day ran.
 */
async function skipDays(
  page: Page,
  days: number,
  phone: boolean,
  untilInjury: boolean,
): Promise<boolean> {
  const roster = dayButton(page, 'Roster');
  const show = dayButton(page, 'Go to the show');
  let left = days;
  for (let stops = 0; ; stops += 1) {
    expect(stops, 'the skip keeps stopping').toBeLessThan(MAX_STOPS);
    await expect(dayButton(page, /^(Next day|Go to the show|Roster)$/)).toBeVisible();
    if (await roster.isVisible()) {
      if (untilInjury) return true;
      await roster.click();
      await expect(dayButton(page, 'Next day')).toBeVisible({ timeout: 15_000 });
    } else if (await show.isVisible()) {
      await cancelTonightsShow(page);
      await expect(show).toBeHidden();
    } else if (left === 0) {
      return false;
    } else {
      const moved = await skipDaysOnce(page, left, phone);
      left -= moved;
      // A skip that stopped short stopped for something: wait for the day button to say what.
      if (left > 0) await expect(dayButton(page, 'Next day')).toBeHidden();
    }
  }
}

/** The injured worker's row in Workers > Injured: a table row on desktop, a card on a phone. */
function injuredRow(page: Page, name: string): Locator {
  return page
    .getByRole('main')
    .locator('tr, li[data-row-id]')
    .filter({ has: page.getByRole('link', { name, exact: true }) });
}

async function openHealthTab(page: Page, name: string): Promise<void> {
  await injuredRow(page, name).getByRole('link', { name, exact: true }).click();
  await expect(page).toHaveURL(/\/game\/workers\/per_/);
  await page.getByRole('tab', { name: 'Health' }).click();
  await expect(page).toHaveURL(/\?tab=health$/);
  await expect(page.getByRole('region', { name: 'Condition' })).toBeVisible();
}

/** The profile header's availability chip (a button, so its reason can be reached). */
function availabilityChip(page: Page): Locator {
  return page.getByRole('main').locator('button[data-status]').first();
}

test.describe('injuries and recovery', () => {
  test('a skip stops for an Altura injury; who is out, why, and the way back', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PROMOTION, { seed: HEALTH_E2E_SEED });

    await test.step('Workers > Injured: nobody is hurt in a new world', async () => {
      await navigateInApp(page, '/game/workers');
      await expect(page.locator('h1')).toHaveText('Workers');
      await page.getByRole('button', { name: 'Injured', exact: true }).click();
      await expect(page).toHaveURL(/\?availability=injured$/);
      await expect(page.getByText('Nobody is injured', { exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });

    let name = '';
    await test.step('Skip 30 days: it stops for the injury with a Roster button', async () => {
      expect(await skipDays(page, FIRST_SKIP_DAYS, phone, true), 'an own injury stop').toBe(true);
      const reason = lastAdvance(page).getByText(/ was injured \(/);
      await expect(reason).toBeVisible();
      // "Rook Halvorsen was injured (Back spasms, out until Jan 10, 2027)".
      name = ((await reason.textContent()) ?? '').split(' was injured (')[0]?.trim() ?? '';
      expect(name, 'the injured worker is named').not.toBe('');
      await expectNoHorizontalScroll(page);
      await shot(page, 'health-flow-stop', testInfo);

      await dayButton(page, 'Roster').click();
      await expect(page).toHaveURL(/\/game\/roster\?tab=injuries$/);
      await expect(page.getByRole('tabpanel').getByRole('link', { name })).toBeVisible();
      await expect(dayButton(page, 'Next day')).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalScroll(page);
    });

    await test.step('Workers > Injured lists them with the part and the return date', async () => {
      await navigateInApp(page, '/game/workers?availability=injured');
      await expect(page.locator('h1')).toHaveText('Workers');
      const row = injuredRow(page, name);
      await expect(row).toBeVisible();
      await expect(row).toContainText(/ · (Head|Neck|Back|Arms|Torso|Legs)/);
      await expect(row).toContainText(/\w{3} \d{1,2}, \d{4} · (\d+ days left|Back tomorrow)/);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'health-flow-injured', testInfo);
    });

    let daysLeft = 0;
    await test.step('Health: the injury card, its Time out Why? and the hurt part', async () => {
      await openHealthTab(page, name);
      await expect(availabilityChip(page)).toHaveAttribute('data-status', 'injured');
      const card = page.getByRole('main').locator('section').filter({ hasText: 'Time out' });
      await expect(card).toBeVisible();
      const left =
        (await card
          .getByRole('term')
          .filter({ hasText: 'Days left' })
          .locator('xpath=following-sibling::dd')
          .textContent()) ?? '';
      daysLeft = left === 'Back tomorrow' ? 1 : Number(/\d+/.exec(left)?.[0] ?? '0');
      expect(daysLeft, 'days left on the card').toBeGreaterThan(0);

      const condition = page.getByRole('region', { name: 'Condition' });
      await expect(condition.getByText('Injured', { exact: true })).toHaveCount(1);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'health-flow-card', testInfo);

      await card.getByRole('button', { name: /^Why is Time out \d+ days?\?$/ }).click();
      const why = page.getByRole('dialog', { name: 'Time out' });
      await expect(why).toBeVisible();
      // Settled on screen (it slides in), not half off the edge.
      await expect(why).toBeInViewport({ ratio: 0.95 });
      await expect(why).toContainText('days');
      await expect(why).toContainText(/(Minor|Moderate|Severe) injury/);
      await expect(why).toContainText('Medical care');
      await expectNoHorizontalScroll(page);
      await shot(page, 'health-flow-time-out-why', testInfo);
      await page.keyboard.press('Escape');
      await expect(why).toBeHidden();
    });

    await test.step('Past the return date: fit, in the history, Available', async () => {
      const url = page.url();
      await skipDays(page, daysLeft + 1, phone, false);
      await navigateInApp(page, new URL(url).pathname + new URL(url).search);
      await expect(page.getByRole('heading', { name: 'Fit to work' })).toBeVisible();
      const history = page.getByRole('region', { name: 'Injury history' });
      await expect(history.getByText(/days? out|\d+ days?/).first()).toBeVisible();
      await expect(history.locator('tr, li[data-row-id]').nth(0)).toBeVisible();
      await expect(availabilityChip(page)).toHaveAttribute('data-status', 'available');
      await expect(availabilityChip(page)).toContainText('Available');
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'health-flow-healed', testInfo);
    });
  });
});
