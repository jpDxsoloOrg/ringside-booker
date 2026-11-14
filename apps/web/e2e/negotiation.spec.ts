/**
 * Contract negotiation end to end (ECO5-06, the owner's script from ECO5-08), on desktop, phone
 * and phone-webkit, in new games on the default world:
 *
 * Altura (money in full, so amounts compare exactly):
 * 1. Contracts › Free agents lists who Altura may talk to, each with an Ask; the first ask's Why?
 *    names its tunables (`contracts.value.` / `contracts.ask.`).
 * 2. Make offer on a free agent with a monthly ask: Use their ask reads "Likely to accept", 60% of
 *    the wage reads "Will counter". Submit offer, Next day: the day bar stops on the counter and
 *    Offers shows "Countered" with their terms and "Answer by" a week away.
 * 3. Contracts on the day bar opens the talks; Accept counter ("They'll decide on <date>"). Day by
 *    day until then: "Signed", the worker is on Active, and Finances › Ledger has
 *    "Signing bonus: <name>" for exactly the bonus they countered with.
 * 4. Another free agent gets 40% of their ask, Next day: "Walked away"; their Make offer is
 *    disabled and the reason beside it names the cooldown date.
 * 5. Expiring › Renew on the first row: the sheet shows the current deal; their ask goes in; once
 *    signed, the contract's end date on Active is later than before.
 *
 * Hardpan (reach under 35): the Written option and the Exclusive switch are disabled with the
 * reach reason, and the ask is per appearance.
 *
 * On a phone: no sideways scroll on both tabs and with the sheet open, the sheet fills the screen
 * with its footer in view while the form scrolls, fields and footer buttons are 44px or taller, a
 * Why? opens as a bottom sheet, and axe finds nothing serious on the sheet or either tab.
 *
 * The "With WRK3, SOC1 or WRK8" test skips with a message until those features are on main.
 * Viewport screenshots go to `E2E_SHOTS=<folder>` when it is set.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { cancelTonightsShow } from './helpers/booking';
import { addIsoDays, contractRows, dayButton, gameDate } from './helpers/contracts';
import { startDefaultWorldGame } from './helpers/game';
import { expectFormFieldsAtLeast16px, expectNoHorizontalScroll } from './helpers/layout';
import { centsOf, useFullMoney } from './helpers/money';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const PROMOTION = 'Altura Wrestling Entertainment';
const SMALL_PROMOTION = 'Hardpan Pro Wrestling';
const FLOW_TIMEOUT_MS = 600_000;
const SHOTS_DIR = process.env['E2E_SHOTS'];

/** Touch targets on a phone (`--tap-pad-block`). */
const MIN_TAP_PX = 44;

/** The walk-away cooldown (`contracts.walkAway.cooldownDays`). */
const COOLDOWN_DAYS = 30;

/** How long a counter-offer waits for your answer (`contracts.counter.expiryDays`). */
const COUNTER_EXPIRY_DAYS = 7;

/** Days to wait for a reaction or a review before giving up. */
const MAX_WAIT_DAYS = 6;

/** What a screen that isn't built yet says (the nav's placeholders). */
const PLACEHOLDER_TEXT = "This screen isn't built yet";

async function shot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${testInfo.project.name}.png` });
}

/** A list row: a table row on desktop, a card on a phone. */
const rows = contractRows;

function sheetNamed(page: Page, name: string | RegExp): Locator {
  return page.getByRole('dialog', { name });
}

function meter(sheet: Locator): Locator {
  return sheet.getByRole('meter', { name: 'Their likely reaction' });
}

function wageField(sheet: Locator): Locator {
  return sheet.getByRole('textbox', { name: 'Monthly wage' });
}

/** "Jan 8, 2027", as the screens print a game date. */
function dateText(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Whole dollars in a money field ("41,300" → 41300). */
async function dollarsIn(field: Locator): Promise<number> {
  return Number(((await field.inputValue()) || '0').replace(/\D/g, ''));
}

/**
 * Moves one day on, clearing a show-day stop by cancelling the show and a hurt-worker stop by
 * visiting the roster. A Contracts stop (a counter-offer, expiry notices) is left for the caller.
 */
async function nextDay(page: Page): Promise<void> {
  for (let tries = 0; tries < 6; tries += 1) {
    const button = dayButton(page, /^(Next day|(Tonight: )?Go to the show|Contracts|Roster)$/);
    await expect(button).toBeVisible({ timeout: 20_000 });
    // A phone shows a short label and keeps the full one in the accessible name.
    const name = (await button.getAttribute('aria-label')) ?? (await button.textContent()) ?? '';
    if (name.includes('Go to the show')) {
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
async function clearExpiringIfStopped(page: Page): Promise<void> {
  const contracts = dayButton(page, 'Contracts');
  if (!(await contracts.isVisible())) return;
  await contracts.click();
  const banner = page.getByRole('region', { name: 'New expiry notices' });
  if (await banner.isVisible()) {
    await banner.getByRole('button', { name: 'Mark all seen' }).click();
    await expect(dayButton(page, 'Contracts')).toBeHidden({ timeout: 15_000 });
  }
}

/** Free agents with a monthly ask that you may make an offer to now. */
function writtenFreeAgents(page: Page): Locator {
  return rows(page)
    .filter({ has: page.getByRole('button', { name: 'Make offer', disabled: false }) })
    .filter({ hasText: /\/mo/ });
}

/** Opens a row's Make offer and returns the worker's name and the sheet. */
async function makeOfferTo(page: Page, row: Locator): Promise<{ name: string; sheet: Locator }> {
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

async function expectReaction(sheet: Locator, label: RegExp): Promise<void> {
  await expect(meter(sheet)).toHaveAttribute('aria-valuetext', label, { timeout: 20_000 });
}

/** A bottom sheet reaches the bottom edge of the screen. */
async function expectBottomSheet(page: Page, panel: Locator): Promise<void> {
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 2);
}

/** Opens a Why?, checks it reads cleanly (a bottom sheet on a phone) and returns the panel. */
async function openWhy(
  page: Page,
  button: Locator,
  title: string | RegExp,
  phone: boolean,
): Promise<Locator> {
  await button.click();
  const panel = page.getByRole('dialog', { name: title });
  await expect(panel.getByRole('tree')).toBeVisible({ timeout: 20_000 });
  await expect(panel).not.toContainText(/undefined|NaN/);
  if (phone) await expectBottomSheet(page, panel);
  return panel;
}

async function closeWhy(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Close' }).click();
  await expect(panel).toBeHidden();
}

/** Every visible element in `targets` is at least 44px tall. */
async function expectTapHeight(targets: Locator, what: string): Promise<void> {
  const count = await targets.count();
  let checked = 0;
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    const name = (await target.getAttribute('aria-label')) ?? (await target.textContent()) ?? '';
    expect(
      box?.height ?? 0,
      `${what} "${name.trim()}" is tall enough to tap`,
    ).toBeGreaterThanOrEqual(MIN_TAP_PX - 0.5);
    checked += 1;
  }
  expect(checked, `some ${what} were measured`).toBeGreaterThan(0);
}

/**
 * The phone checks on an open Negotiation Sheet: it fills the screen, its footer stays in view
 * while the form scrolls, and its fields and footer buttons are easy to tap.
 */
async function expectPhoneSheet(page: Page, sheet: Locator): Promise<void> {
  const viewport = page.viewportSize();
  const box = await sheet.boundingBox();
  expect(box?.y ?? 99, 'the sheet starts at the top').toBeLessThanOrEqual(1);
  expect(box?.height ?? 0, 'the sheet fills the screen').toBeGreaterThanOrEqual(
    (viewport?.height ?? 0) - 2,
  );
  const footer = sheet.locator('[data-sheet-footer]');
  const submit = footer.getByRole('button', { name: /^(Submit offer|Offer renewal)$/ });
  const body = sheet.locator('[data-sheet-body]');
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(submit).toBeInViewport();
  await body.evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(submit).toBeInViewport();
  await expectTapHeight(sheet.getByRole('textbox'), 'Field');
  await expectTapHeight(sheet.getByRole('combobox'), 'Picker');
  await expectTapHeight(footer.getByRole('button'), 'Footer button');
  await expectFormFieldsAtLeast16px(page);
}

/** Offers' closed talks: true when `name`'s talks show `status` there. */
async function closedTalksShow(page: Page, name: string, status: RegExp): Promise<boolean> {
  await navigateInApp(page, '/game/contracts?tab=offers');
  await page.getByRole('switch', { name: 'Closed talks' }).check();
  return rows(page).filter({ hasText: name }).filter({ hasText: status }).first().isVisible();
}

/** Moves day by day until `done` holds (at most {@link MAX_WAIT_DAYS} days). */
async function advanceUntil(page: Page, what: string, done: () => Promise<boolean>) {
  for (let day = 0; day < MAX_WAIT_DAYS; day += 1) {
    await clearExpiringIfStopped(page);
    await nextDay(page);
    if (await done()) return;
  }
  expect(false, what).toBe(true);
}

/** The ISO end date of `name`'s contract on Active (today + the days left it shows). */
async function activeEndDate(page: Page, name: string): Promise<string> {
  await navigateInApp(page, '/game/contracts?tab=active');
  const row = rows(page).filter({ hasText: name }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  const left = row.getByText(/^\d+ days?$/).first();
  await expect(left).toBeVisible();
  const days = Number(/^(\d+)/.exec((await left.textContent()) ?? '')?.[1] ?? 'NaN');
  expect(Number.isNaN(days), `${name}'s days left`).toBe(false);
  return addIsoDays(await gameDate(page), days);
}

test.describe('contract negotiation', () => {
  test('counter, signing bonus, walk-away and a renewal as Altura', async ({ page }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await useFullMoney(page);
    await startDefaultWorldGame(page, PROMOTION, { phone });
    await navigateInApp(page, '/game/contracts?tab=free-agents');

    await test.step('Free agents: every row has an Ask, and its Why? names the tunables', async () => {
      await expect(rows(page).first()).toBeVisible({ timeout: 30_000 });
      await expect(rows(page).first()).toContainText(/\$[\d,]+(\/mo| an appearance)/);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'free-agents', testInfo);
      const why = rows(page)
        .first()
        .getByRole('button', { name: /^Why is .+'s ask/ });
      const panel = await openWhy(page, why, /'s ask$/, phone);
      await panel.getByRole('button', { name: 'Expand all' }).click();
      await expect(panel.getByText(/contracts\.(value|ask)\./).first()).toBeVisible();
      await closeWhy(panel);
    });

    let signed = '';
    let agreedBonus = 0;
    await test.step('60% of the ask: Will counter; Next day: Countered with their terms', async () => {
      const { name, sheet } = await makeOfferTo(page, writtenFreeAgents(page).nth(1));
      signed = name;
      await sheet.getByRole('button', { name: 'Use their ask' }).click();
      await expectReaction(sheet, /^Likely to accept/);
      const asked = await dollarsIn(wageField(sheet));
      expect(asked).toBeGreaterThan(0);
      await expectNoHorizontalScroll(page);
      if (phone) {
        await expectPhoneSheet(page, sheet);
        const why = sheet.getByRole('button', { name: 'Why likely to accept?' });
        await closeWhy(await openWhy(page, why, 'Their reaction', phone));
      }
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'negotiation-sheet', testInfo);

      const offered = Math.round(asked * 0.6);
      await wageField(sheet).fill(String(offered));
      await expectReaction(sheet, /^Will counter/);
      await sheet.getByRole('button', { name: 'Submit offer' }).click();
      await expect(sheet.getByText(/They'll answer after the next day/)).toBeVisible({
        timeout: 20_000,
      });
      await sheet.getByRole('button', { name: 'Close' }).click();
      await expect(sheet).toBeHidden();

      // The next day they counter, and the day bar stops on it.
      const submittedOn = await gameDate(page);
      await nextDay(page);
      await expect(dayButton(page, 'Contracts')).toBeVisible({ timeout: 20_000 });
      await navigateInApp(page, '/game/contracts?tab=offers');
      const row = rows(page).filter({ hasText: name });
      await expect(row).toContainText(/Countered: answer by /, { timeout: 20_000 });
      await expect(row).toContainText(/Their counter: \$[\d,]+ a month/);
      const terms = (await row.textContent()) ?? '';
      const wage = centsOf(/Their counter: (\$[\d,]+)/.exec(terms)?.[1] ?? '');
      expect(wage, 'their counter is above your offer').toBeGreaterThan(offered * 100);
      expect(wage, 'and no more than their ask').toBeLessThanOrEqual(asked * 100);
      agreedBonus = centsOf(/(\$[\d,]+) to sign/.exec(terms)?.[1] ?? '$0');
      expect(agreedBonus, 'the counter asks for a signing bonus').toBeGreaterThan(0);
      // A week from the day they weighed your offer (the day it was sent, run by Next day).
      const answerBy = dateText(addIsoDays(submittedOn, COUNTER_EXPIRY_DAYS));
      await expect(row).toContainText(`Answer by ${answerBy}`);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'offers-countered', testInfo);
    });

    await test.step('Accept counter from the day bar; once signed, Active and the Ledger agree', async () => {
      await dayButton(page, 'Contracts').click();
      await expect(page).toHaveURL(/\/game\/contracts\?tab=offers&negotiation=neg_\w+$/);
      const talks = sheetNamed(page, signed);
      await expect(talks.getByRole('button', { name: 'Accept counter' })).toBeVisible({
        timeout: 20_000,
      });
      await talks.getByRole('button', { name: 'Accept counter' }).click();
      await expect(talks.getByText(/They'll decide on /)).toBeVisible({ timeout: 20_000 });
      await talks.getByRole('button', { name: 'Close' }).click();
      await expect(dayButton(page, 'Next day')).toBeVisible({ timeout: 15_000 });

      await advanceUntil(page, `${signed} signed`, () => closedTalksShow(page, signed, /Signed/));
      await expectNoHorizontalScroll(page);
      await shot(page, 'offers-signed', testInfo);

      await navigateInApp(page, '/game/contracts?tab=active');
      await expect(rows(page).filter({ hasText: signed }).first()).toBeVisible({
        timeout: 20_000,
      });

      await navigateInApp(page, '/game/finances?tab=ledger&category=signingBonuses');
      const ledgerRow = page
        .getByRole('main')
        .locator('tr, li[data-row-id]')
        .filter({ hasText: `Signing bonus: ${signed}` })
        .first();
      await expect(ledgerRow).toBeVisible({ timeout: 20_000 });
      expect(Math.abs(centsOf((await ledgerRow.textContent()) ?? ''))).toBe(agreedBonus);
      await shot(page, 'ledger-signing-bonus', testInfo);
    });

    await test.step('40% of the ask: Walked away, and Make offer waits for the cooldown', async () => {
      await navigateInApp(page, '/game/contracts?tab=free-agents');
      await expect(writtenFreeAgents(page).first()).toBeVisible({ timeout: 20_000 });
      const { name, sheet } = await makeOfferTo(page, writtenFreeAgents(page).first());
      await sheet.getByRole('button', { name: 'Use their ask' }).click();
      await expectReaction(sheet, /^Likely to accept/);
      const asked = await dollarsIn(wageField(sheet));
      await wageField(sheet).fill(String(Math.round(asked * 0.4)));
      await expectReaction(sheet, /^Will (walk away|reject)/);
      // With the signing bonus still at their ask, 40% of the wage can land just above the
      // walk-away line (0.45 of the ask's value): drop the bonus too.
      if (
        !((await meter(sheet).getAttribute('aria-valuetext')) ?? '').startsWith('Will walk away')
      ) {
        await sheet.getByRole('textbox', { name: 'Signing bonus' }).fill('0');
      }
      await expectReaction(sheet, /^Will walk away/);
      await sheet.getByRole('button', { name: 'Submit offer' }).click();
      await expect(sheet.getByText(/They'll answer after the next day/)).toBeVisible({
        timeout: 20_000,
      });
      await sheet.getByRole('button', { name: 'Close' }).click();
      const submittedOn = await gameDate(page);
      await advanceUntil(page, `${name} walked away`, () =>
        closedTalksShow(page, name, /Walked away/),
      );
      // The cooldown runs from the day they weighed your offer (the day it was sent).
      const until = dateText(addIsoDays(submittedOn, COOLDOWN_DAYS));
      await expect(rows(page).filter({ hasText: name }).first()).toContainText(
        `Walked away: try again after ${until}`,
      );

      await navigateInApp(page, '/game/contracts?tab=free-agents');
      const row = rows(page).filter({ hasText: name }).first();
      await expect(row).toBeVisible({ timeout: 20_000 });
      await expect(row.getByRole('button', { name: 'Make offer' })).toBeDisabled();
      await expect(row).toContainText(`Walked away from talks with you: try again after ${until}`);
      await expectNoHorizontalScroll(page);
      await shot(page, 'free-agents-cooldown', testInfo);
    });

    await test.step('Expiring › Renew: the current deal shows, and the end date moves on', async () => {
      await clearExpiringIfStopped(page);
      await navigateInApp(page, '/game/contracts?tab=expiring');
      const renew = rows(page).first().getByRole('button', { name: 'Renew', exact: true });
      await expect(renew).toBeVisible({ timeout: 20_000 });
      await renew.click();
      const sheet = sheetNamed(page, /^Renew /);
      await expect(sheet.getByRole('button', { name: 'Use their ask' })).toBeVisible({
        timeout: 20_000,
      });
      const renewed = ((await sheet.getByRole('heading').first().textContent()) ?? '')
        .replace(/^Renew /, '')
        .trim();
      expect(renewed).not.toBe('');
      const now = sheet.getByText(/^Now: \$[\d,]+(\/mo| per show).* until /);
      await expect(now).toBeVisible();
      const nowText = (await now.textContent()) ?? '';
      await sheet.getByRole('button', { name: 'Use their ask' }).click();
      await expectReaction(sheet, /^Likely to accept/);
      if (nowText.includes('/mo') && (await wageField(sheet).isVisible())) {
        // "Won't take less than their current deal with you."
        expect(await dollarsIn(wageField(sheet))).toBeGreaterThanOrEqual(centsOf(nowText) / 100);
      }
      await expectNoHorizontalScroll(page);
      if (phone) await expectPhoneSheet(page, sheet);
      await shot(page, 'renewal-sheet', testInfo);
      await sheet.getByRole('button', { name: 'Offer renewal' }).click();
      await expect(sheet.getByText(/^Considering your offer/)).toBeVisible({ timeout: 20_000 });
      await sheet.getByRole('button', { name: 'Close' }).click();

      const endedBefore = await activeEndDate(page, renewed);
      await advanceUntil(page, `${renewed}'s renewal signed`, () =>
        closedTalksShow(page, renewed, /Signed/),
      );
      const endsAfter = await activeEndDate(page, renewed);
      expect(endsAfter > endedBefore, `${renewed}'s contract now ends after ${endedBefore}`).toBe(
        true,
      );
    });

    if (phone) {
      await test.step('No sideways scroll at 360px either', async () => {
        await page.setViewportSize({ width: 360, height: 780 });
        for (const tab of ['free-agents', 'offers']) {
          await navigateInApp(page, `/game/contracts?tab=${tab}`);
          await expect(page.getByRole('heading', { level: 1, name: 'Contracts' })).toBeVisible();
          await expect(rows(page).first()).toBeVisible({ timeout: 20_000 });
          await expectNoHorizontalScroll(page);
        }
      });
    }
  });

  test('Hardpan: written and exclusive deals need more reach', async ({ page }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, SMALL_PROMOTION, { phone });
    await navigateInApp(page, '/game/contracts?tab=free-agents');
    const first = rows(page)
      .filter({ has: page.getByRole('button', { name: 'Make offer' }) })
      .first();
    await expect(first).toBeVisible({ timeout: 30_000 });
    await expect(first).toContainText(/ an appearance/);
    const { sheet } = await makeOfferTo(page, first);
    const reach = /Written contracts need a reach of 35; yours is \d+/;
    const written = sheet.getByRole('radio', { name: 'Written' });
    await expect(written).toHaveAttribute('aria-disabled', 'true');
    await expect(written).toHaveAccessibleDescription(reach);
    const exclusive = sheet.getByRole('switch', { name: 'Exclusive' });
    await expect(exclusive).toBeDisabled();
    await expect(exclusive).toHaveAccessibleDescription(/need a reach of 35; yours is \d+/);
    await expect(sheet.getByRole('textbox', { name: 'Fee per appearance' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Use their ask' }).click();
    await expectReaction(sheet, /^Likely to accept/);
    await expectNoHorizontalScroll(page);
    await shot(page, 'hardpan-sheet', testInfo);
  });

  test('With WRK3, SOC1 or WRK8: the partner steps', async ({ page }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PROMOTION, { phone });
    const missing: string[] = [];

    await navigateInApp(page, '/game/workers');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if ((await page.getByRole('button', { name: /^Compare/ }).count()) === 0) {
      missing.push('WRK3 (Workers › Compare with Make offer)');
    } else {
      // WRK3: compare two free agents; Make offer in a column opens the Negotiation Sheet.
      throw new Error('WRK3 is on main: write the Compare › Make offer step (ECO5-08 step 9).');
    }

    await navigateInApp(page, '/game/inbox');
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
    if (await page.getByText(PLACEHOLDER_TEXT).isVisible()) {
      missing.push('SOC1 (a counter-offer as an Inbox decision)');
    } else {
      // SOC1: the counter arrives as an Inbox decision whose Accept matches the Offers tab's.
      throw new Error('SOC1 is on main: write the Inbox counter-offer step (ECO5-08).');
    }

    await navigateInApp(page, '/game/contracts?tab=free-agents');
    const link = rows(page).first().getByRole('link').first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();
    await expect(page).toHaveURL(/\/game\/workers\/per_/);
    await expect(page.getByRole('button', { name: 'Offer contract' })).toBeVisible({
      timeout: 20_000,
    });
    if ((await page.getByRole('tab', { name: 'Morale' }).count()) === 0) {
      missing.push('WRK8 (morale that moves: a Morale line in the renewal ask)');
    } else {
      // WRK8: a worker below the unhappy threshold shows a Morale line in the renewal ask's Why?.
      throw new Error('WRK8 is on main: write the unhappy renewal step (ECO5-08 step 8).');
    }

    test.skip(missing.length > 0, `Needs ${missing.join('; ')}: not on main yet.`);
  });
});
