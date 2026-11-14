/**
 * Contracts end to end (ECO4-04, ECO4-06: the owner's test script), on desktop, phone and
 * phone-webkit.
 *
 * In a new game on the default world as Altura (money shown in full, so amounts compare exactly):
 *
 * 1. Business > Contracts: Active lists Altura's contracts with kind, wage and end date; Expiring
 *    lists only contracts ending within 60 days, soonest first.
 * 2. A lower-card contract opens in a sheet (a bottom sheet on a phone). Release shows the
 *    severance with its Why? (naming `contracts.severance.fullMonths`) and the cash after;
 *    confirming takes exactly that from the top bar's cash, the worker is on Ended as Released,
 *    and Finances > Ledger has a Severance row for the same amount.
 * 3. Rules: the automatic renewal stopgap is switched off, so contracts really run out. (ECO5-05
 *    retires the stopgap and the switch with it; the step then has nothing to switch.)
 * 4. Skip 120 days: it stops about a month in with "Contract expiring soon: <name>"; the day bar's
 *    Contracts button opens the Expiring tab, where Mark all seen clears the stop.
 * 5. Skipping on to the soonest end date and pressing Next day: the summary says "<name>'s
 *    contract expired", the worker is on Ended as Expired, and the projected payroll is lower.
 *
 * In the played save (three weeks of the default world as Altura): an Altura worker's profile has
 * a Contract tab with the terms and Release; a rival's worker shows kind and dates with "Terms
 * private" and no money.
 *
 * In the contracts save (`fixtures/build-contracts-save.ts`) two Altura workers want to leave:
 * nothing lowers morale in a new game before WRK8, so the save sets it and the engine raises the
 * requests. The day bar reads Contracts with "<name> wants to leave"; Refuse costs morale and
 * shows a daily walk-out chance with a Why?; Grant pays the agreed share of the severance (a
 * Severance ledger row) and the worker is on Ended as Quit.
 *
 * "With WRK8": the same requests reached by playing (demote a main-eventer, skip 30 days) are
 * skipped with a message until WRK8 (morale that moves) is on main.
 *
 * Every screen has no sideways scroll; screens and sheets have no serious axe findings. Viewport
 * screenshots go to `E2E_SHOTS=<folder>` when it is set.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { skipDaysOnce } from './helpers/booking';
import {
  addIsoDays,
  clearDayStop,
  contractRows,
  dayButton,
  gameDate,
  openContracts,
  skipToDateThroughStops,
} from './helpers/contracts';
import {
  enterGameFromContractsSave,
  enterGameFromPlayedSave,
  startDefaultWorldGame,
} from './helpers/game';
import { expectFormFieldsAtLeast16px, expectNoHorizontalScroll } from './helpers/layout';
import { centsOf, topBarCash, useFullMoney } from './helpers/money';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const PROMOTION = 'Altura Wrestling Entertainment';
const RIVAL = 'Hardpan Pro Wrestling';

/** A new game builds the default world in the worker, then plays about two months. */
const FLOW_TIMEOUT_MS = 900_000;

/** The Expiring tab's window (`contracts.expiring.windowDays`). */
const EXPIRING_WINDOW_DAYS = 60;

/** The owner's script asks for a 120-day skip; the first expiring contract stops it. */
const SKIP_DAYS = 120;

/** Stops (show nights, injuries) a skip can meet before the first expiring contract. */
const MAX_STOPS = 40;

/** Touch targets on a phone (`--tap-pad-block`). */
const MIN_TAP_PX = 44;

const NO_MINUTES = /minute/i;

const SHOTS_DIR = process.env['E2E_SHOTS'];

async function shot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${testInfo.project.name}.png` });
}

/** A bottom sheet reaches the bottom edge of the screen. */
async function expectBottomSheet(page: Page, panel: Locator): Promise<void> {
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 2);
}

/**
 * Opens a Why? (a bottom sheet on a phone), checks it reads cleanly and returns the open panel,
 * titled `title`; the caller closes it with {@link closeWhy}.
 */
async function openWhy(page: Page, button: Locator, title: string, phone: boolean) {
  await button.click();
  const panel = page.getByRole('dialog', { name: title, exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText(/undefined|NaN/);
  await expect(panel).not.toContainText(NO_MINUTES);
  if (phone) await expectBottomSheet(page, panel);
  return panel;
}

async function closeWhy(page: Page, panel: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
}

/** Every visible button in `scope` is at least 44px tall. */
async function expectTapTargets(scope: Locator): Promise<void> {
  const buttons = scope.getByRole('button');
  const count = await buttons.count();
  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    const name = (await button.getAttribute('aria-label')) ?? (await button.textContent()) ?? '';
    expect(box?.height ?? 0, `"${name.trim()}" is tall enough to tap`).toBeGreaterThanOrEqual(
      MIN_TAP_PX - 0.5,
    );
  }
}

/** The name on a contract row: a link on desktop (the row opens the sheet), a button on a phone. */
async function rowName(row: Locator, phone: boolean): Promise<string> {
  return (
    (await row
      .getByRole(phone ? 'button' : 'link')
      .first()
      .textContent()) ?? ''
  ).trim();
}

/** The contract sheet named `name`. */
function contractSheet(page: Page, name: string): Locator {
  return page.getByRole('dialog', { name, exact: true });
}

/** Opens a row's contract sheet and returns it. */
async function openSheet(page: Page, row: Locator, name: string, phone: boolean) {
  if (phone) await row.getByRole('button', { name, exact: true }).click();
  else await row.click({ position: { x: 4, y: 4 } });
  const sheet = contractSheet(page, name);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** The ledger's rows (table rows on desktop, cards on a phone) that contain `text`. */
function ledgerRows(page: Page, text: string | RegExp): Locator {
  return page.getByRole('main').locator('tr, li[data-row-id]').filter({ hasText: text });
}

/** Finances > Ledger, Severance rows only. */
async function openSeveranceLedger(page: Page): Promise<void> {
  await navigateInApp(page, '/game/finances?tab=ledger&category=severance');
  await expect(page.getByRole('heading', { level: 1, name: 'Finances' })).toBeVisible();
}

/** Finances > Overview's projected monthly payroll, in cents. */
async function projectedPayroll(page: Page): Promise<number> {
  await navigateInApp(page, '/game/finances');
  await expect(page.getByRole('heading', { level: 1, name: 'Finances' })).toBeVisible();
  const card = page.getByRole('group', { name: 'Projected payroll' });
  await expect(card).toContainText('$', { timeout: 15_000 });
  return centsOf((await card.textContent()) ?? '');
}

/** The days left a contract row shows beside its end date ("59 days"). */
async function daysLeftOf(row: Locator): Promise<number> {
  const left = row.getByText(/^\d+ days?$/).first();
  await expect(left).toBeVisible();
  return Number(/^(\d+)/.exec((await left.textContent()) ?? '')?.[1] ?? 'NaN');
}

/** Opens every step of an open Why?, so the tunables under nested numbers show too. */
async function expandAll(panel: Locator): Promise<void> {
  await panel.getByRole('button', { name: 'Expand all' }).click();
}

test.describe('contracts', () => {
  test('list, release with a Why?, the expiring stop, and a contract running out', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await useFullMoney(page);
    await startDefaultWorldGame(page, PROMOTION, { phone });

    await test.step('Active lists Altura’s contracts with kind, wage and end date', async () => {
      await openContracts(page, phone);
      await expect(page.getByText(/^\d+ contracts · .+ a month · \d+ expiring soon/)).toBeVisible({
        timeout: 15_000,
      });
      const rows = contractRows(page);
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeGreaterThanOrEqual(50);
      const first = rows.first();
      await expect(first).toContainText(/Written|Per appearance|Development|Tour/);
      await expect(first).toContainText(/\/mo|per show/);
      await expect(first).toContainText(/\d{4}\s*\d+ days?|No end date/);
      // Cards on a phone, table rows on desktop.
      await expect(first).toHaveJSProperty('tagName', phone ? 'LI' : 'TR');
      await expectNoHorizontalScroll(page);
      if (phone) await expectFormFieldsAtLeast16px(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'contracts-active', testInfo);
    });

    let soonest = '';
    let soonestEndsOn = '';
    await test.step('Expiring lists only contracts ending within 60 days', async () => {
      await page.getByRole('tab', { name: 'Expiring' }).click();
      await expect(page).toHaveURL(/\?tab=expiring/);
      const rows = contractRows(page);
      await expect(rows.first()).toBeVisible({ timeout: 15_000 });
      const count = await rows.count();
      expect(count).toBeGreaterThanOrEqual(1);
      let previous = 0;
      for (let index = 0; index < count; index += 1) {
        const left = await daysLeftOf(rows.nth(index));
        expect(left).toBeLessThanOrEqual(EXPIRING_WINDOW_DAYS);
        expect(left, 'soonest first').toBeGreaterThanOrEqual(previous);
        previous = left;
      }
      const first = rows.first();
      soonest = await rowName(first, phone);
      expect(soonest).not.toBe('');
      soonestEndsOn = addIsoDays(await gameDate(page), await daysLeftOf(first));
      await expectNoHorizontalScroll(page);
      await shot(page, 'contracts-expiring-new-game', testInfo);
    });

    let payrollBefore = 0;
    await test.step('Release a lower-card worker: Why?, cash, Ended and the ledger', async () => {
      await page.getByRole('tab', { name: 'Active' }).click();
      const row = contractRows(page)
        .filter({ hasText: /Lower card wrestler/ })
        .filter({ hasNotText: soonest })
        .first();
      const released = await rowName(row, phone);
      expect(released).not.toBe('');
      const cashBefore = await topBarCash(page, phone);
      const sheet = await openSheet(page, row, released, phone);
      await expect(sheet.getByRole('region', { name: 'Terms' })).toBeVisible();
      await expect(sheet).toBeInViewport({ ratio: 0.5 });
      const release = sheet.getByRole('button', { name: 'Release', exact: true });
      if (phone) {
        await expectBottomSheet(page, sheet);
        await release.scrollIntoViewIfNeeded();
        await expect(release).toBeInViewport();
        await expectTapTargets(sheet);
      }
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page, { include: ['[role="dialog"]'] });
      await shot(page, 'contracts-sheet', testInfo);

      await release.click();
      const confirm = page.getByRole('alertdialog', { name: `Release ${released}?` });
      await expect(confirm.getByText('Cash after')).toBeVisible();
      const why = confirm.getByRole('button', {
        name: new RegExp(`^Why is ${released}'s severance`),
      });
      await expect(why).toBeVisible();
      const severance = centsOf((await why.getAttribute('aria-label')) ?? '');
      expect(severance).toBeGreaterThan(0);
      await expectNoHorizontalScroll(page);
      if (phone) await expectTapTargets(confirm);
      await shot(page, 'contracts-release', testInfo);
      const panel = await openWhy(page, why, `${released}'s severance`, phone);
      await expandAll(panel);
      await expect(panel.getByText('contracts.severance.fullMonths').first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      await shot(page, 'contracts-release-why', testInfo);
      await closeWhy(page, panel);
      await confirm.getByRole('button', { name: 'Release', exact: true }).click();
      await expect(confirm).toBeHidden();
      await expect(
        page.getByRole('status').getByText(`Released ${released}. Severance`, { exact: false }),
      ).toBeVisible();
      await expect(page.getByRole('link', { name: 'See it in the ledger' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(contractSheet(page, released)).toBeHidden();
      expect(await topBarCash(page, phone)).toBe(cashBefore - severance);

      await page.getByRole('tab', { name: 'Ended' }).click();
      await expect(page).toHaveURL(/\?tab=ended/);
      const ended = contractRows(page).filter({ hasText: released });
      await expect(ended).toContainText('Released');
      await expect(ended).toContainText(centsText(severance));
      await expectNoHorizontalScroll(page);
      await shot(page, 'contracts-ended', testInfo);

      await openSeveranceLedger(page);
      const ledgerRow = ledgerRows(page, released).first();
      await expect(ledgerRow).toBeVisible({ timeout: 15_000 });
      await expect(ledgerRow).toContainText('Severance');
      expect(Math.abs(centsOf((await ledgerRow.textContent()) ?? ''))).toBe(severance);
      await expectNoHorizontalScroll(page);
      await shot(page, 'contracts-ledger', testInfo);

      payrollBefore = await projectedPayroll(page);
    });

    await test.step('Rules: contracts stop renewing by themselves', async () => {
      await openContracts(page, phone);
      await page.getByRole('button', { name: 'Rules' }).click();
      const rules = page.getByRole('dialog', { name: 'Contract rules' });
      await expect(rules.getByRole('group', { name: 'Worker patience' })).toBeVisible();
      // The stopgap until contract talks: ECO5-05 retires it, and this switch with it.
      const renew = rules.getByRole('switch', { name: 'Renew my contracts automatically' });
      if ((await renew.count()) > 0) {
        // The switch follows the saved rule, so it flips once the engine has answered.
        await expect(renew).toBeChecked();
        await renew.click();
        await expect(renew).not.toBeChecked({ timeout: 15_000 });
      }
      await expectNoHorizontalScroll(page);
      await page.keyboard.press('Escape');
      await expect(rules).toBeHidden();
    });

    await test.step('Skip 120 days: it stops early for an expiring contract', async () => {
      const contracts = dayButton(page, 'Contracts');
      let left = SKIP_DAYS;
      for (let stops = 0; ; stops += 1) {
        expect(stops, 'the skip keeps stopping').toBeLessThan(MAX_STOPS);
        expect(left, 'the skip stopped for an expiring contract').toBeGreaterThan(0);
        await expect(dayButton(page, /./).first()).toBeVisible({ timeout: 15_000 });
        if (await contracts.isVisible()) break;
        if (await clearDayStop(page)) continue;
        left -= await skipDaysOnce(page, left, phone);
      }
      await expect(contracts).toHaveAccessibleDescription(/^Contract expiring soon: .+/);
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
      await expect(contracts).toBeHidden({ timeout: 15_000 });
      await expect(dayButton(page, /^(Next day|(Tonight: )?Go to the show|Roster)$/)).toBeVisible();
    });

    await test.step('The soonest contract runs out: Expired, and a lower payroll', async () => {
      await skipToDateThroughStops(page, soonestEndsOn, phone);
      // The end date's own show night or notice is cleared before the last day runs.
      while (await clearDayStop(page)) {
        expect(await gameDate(page)).toBe(soonestEndsOn);
      }
      await dayButton(page, 'Next day').click();
      const summary = page.getByRole('region', { name: 'Last advance' });
      await expect(summary).toContainText(`${soonest}'s contract expired`, { timeout: 15_000 });
      await shot(page, 'contracts-expired-summary', testInfo);

      await navigateInApp(page, '/game/contracts?tab=ended');
      const ended = contractRows(page).filter({ hasText: soonest });
      await expect(ended).toContainText('Expired', { timeout: 15_000 });
      await expectNoHorizontalScroll(page);
      expect(await projectedPayroll(page)).toBeLessThan(payrollBefore);
    });

    if (phone) {
      await test.step('No sideways scroll at 360px either', async () => {
        await page.setViewportSize({ width: 360, height: 780 });
        await navigateInApp(page, '/game/contracts?tab=active');
        await expect(contractRows(page).first()).toBeVisible({ timeout: 15_000 });
        await expectNoHorizontalScroll(page);
        await shot(page, 'contracts-active-360', testInfo);
      });
    }
  });

  test('profile Contract tab: own terms with Release, a rival’s terms private', async ({
    page,
  }, testInfo) => {
    const phone = isPhone(testInfo);
    await enterGameFromPlayedSave(page);

    await test.step('An Altura worker: terms, dates and Release', async () => {
      await openContracts(page, phone);
      const row = contractRows(page)
        .filter({ hasText: /wrestler/ })
        .first();
      await expect(row).toBeVisible({ timeout: 15_000 });
      const name = await rowName(row, phone);
      if (phone) {
        const sheet = await openSheet(page, row, name, phone);
        await sheet.getByRole('link', { name: `Open ${name}'s profile` }).click();
      } else {
        await row.getByRole('link', { name, exact: true }).click();
      }
      await expect(page).toHaveURL(/\/game\/workers\/per_/);
      await page.getByRole('tab', { name: 'Contract' }).click();
      await expect(page).toHaveURL(/\?tab=contract$/);
      const panel = page.getByRole('tabpanel');
      await expect(panel.getByRole('region', { name: 'Terms' })).toBeVisible({ timeout: 15_000 });
      await expect(panel.getByRole('region', { name: 'Terms' })).toContainText(/Wage\$[\d,.K]+/);
      await expect(panel.getByRole('region', { name: 'Dates' })).toContainText('Ends');
      await expect(panel.getByRole('button', { name: 'Release', exact: true })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'contracts-profile-own', testInfo);
    });

    await test.step('A rival’s worker: kind and dates, "Terms private", no money', async () => {
      await navigateInApp(page, '/game/workers');
      await expect(page.locator('h1')).toHaveText('Workers');
      if (phone) await page.getByRole('button', { name: /^Filters/ }).click();
      await page.getByRole('combobox', { name: 'Employer' }).click();
      await page.getByRole('option', { name: RIVAL, exact: true }).click();
      await expect(page).toHaveURL(/employer=pro_/);
      if (phone) await page.keyboard.press('Escape');
      const rows = page.getByRole('main').locator('tbody tr, li[data-row-id]');
      await expect(rows.first()).toContainText(RIVAL, { timeout: 15_000 });
      await rows.first().getByRole('link').first().click();
      await expect(page).toHaveURL(/\/game\/workers\/per_/);
      await page.getByRole('tab', { name: 'Contract' }).click();
      const panel = page.getByRole('tabpanel');
      await expect(panel.getByText('Terms private')).toBeVisible({ timeout: 15_000 });
      await expect(panel).toContainText(RIVAL);
      await expect(panel).toContainText(/Written|Per appearance|Development|Tour/);
      await expect(panel).not.toContainText('$');
      await expect(panel.getByRole('button', { name: 'Release', exact: true })).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await shot(page, 'contracts-profile-rival', testInfo);
    });
  });

  test('two workers want to leave: Refuse one, Grant the other', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await useFullMoney(page);
    await enterGameFromContractsSave(page);
    const contracts = dayButton(page, 'Contracts');

    await test.step('The day bar, the nav badge and Restless patience', async () => {
      await expect(contracts).toBeVisible({ timeout: 15_000 });
      await expect(contracts).toHaveAccessibleDescription(/^.+ wants to leave and 1 other$/);
      const nav = phone
        ? page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /^More/ })
        : page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /^Contracts/ });
      await expect(nav).toContainText('2');
      await openContracts(page, phone);
      await page.getByRole('button', { name: 'Rules' }).click();
      const rules = page.getByRole('dialog', { name: 'Contract rules' });
      await expect(rules.getByRole('radio', { name: /^Restless/ })).toBeChecked();
      await page.keyboard.press('Escape');
      await expect(rules).toBeHidden();
      await expect(contractRows(page).filter({ hasText: 'Wants to leave' })).toHaveCount(2);
      await expectNoHorizontalScroll(page);
      await shot(page, 'contracts-wants-to-leave', testInfo);
    });

    let refused = '';
    await test.step('Refuse: morale drops, a daily walk-out chance with a Why?', async () => {
      await contracts.click();
      await expect(page).toHaveURL(/tab=active&wantsToLeave=1&employment=emp_/);
      const sheet = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('region', { name: 'Release request' }) });
      await expect(sheet).toBeVisible();
      refused = ((await sheet.getAttribute('aria-label')) ?? '').trim();
      if (refused === '') refused = (await sheet.getByRole('heading').first().textContent()) ?? '';
      refused = refused.trim();
      const request = sheet.getByRole('region', { name: 'Release request' });
      await expect(request).toContainText(`${refused} wants to leave`);
      await expect(request.getByRole('heading', { name: 'Grant' })).toBeVisible({
        timeout: 15_000,
      });
      await expect(request.getByRole('heading', { name: 'Refuse' })).toBeVisible();
      const morale = sheet.getByRole('region', { name: 'Morale' });
      const moraleBefore = Number(
        ((await morale.locator('dd').first().textContent()) ?? '').replace('−', '-'),
      );
      if (phone) {
        await expectBottomSheet(page, sheet);
        await expectTapTargets(sheet);
      }
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page, { include: ['[role="dialog"]'] });
      await shot(page, 'contracts-request', testInfo);

      await request.getByRole('button', { name: 'Refuse', exact: true }).click();
      await expect(request).toContainText(`You refused ${refused}'s request to leave.`, {
        timeout: 15_000,
      });
      const after = Number(
        ((await morale.locator('dd').first().textContent()) ?? '').replace('−', '-'),
      );
      expect(after).toBeLessThan(moraleBefore);
      const why = request.getByRole('button', {
        name: new RegExp(`^Why is ${refused}'s daily walk-out chance`),
      });
      const panel = await openWhy(page, why, `${refused}'s daily walk-out chance`, phone);
      await expandAll(panel);
      await expect(panel.getByText(/^contracts\.walkout\./).first()).toBeVisible();
      await shot(page, 'contracts-walkout-why', testInfo);
      await closeWhy(page, panel);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    });

    await test.step('Grant: they quit with the agreed share of the severance', async () => {
      await expect(contracts).toHaveAccessibleDescription(/^.+ wants to leave$/);
      await contracts.click();
      const sheet = page
        .getByRole('dialog')
        .filter({ has: page.getByRole('region', { name: 'Release request' }) });
      await expect(sheet).toBeVisible();
      const request = sheet.getByRole('region', { name: 'Release request' });
      await expect(request).not.toContainText(refused);
      const headline = (await request.locator('p').first().textContent()) ?? '';
      const granted = headline.split(' wants to leave')[0]?.trim() ?? '';
      expect(granted).not.toBe('');
      const grantWhy = request.getByRole('button', {
        name: new RegExp(`^Why is Severance if you let ${granted} go`),
      });
      await expect(grantWhy).toBeVisible({ timeout: 15_000 });
      const amount = centsOf((await grantWhy.getAttribute('aria-label')) ?? '');
      const releaseWhy = sheet
        .getByRole('region', { name: 'Terms' })
        .getByRole('button', { name: new RegExp(`^Why is ${granted}'s severance today`) });
      const releaseToday = centsOf((await releaseWhy.getAttribute('aria-label')) ?? '');
      // An unhappy worker is glad to go: the agreed share is never more than releasing them.
      expect(amount).toBeGreaterThan(0);
      expect(amount).toBeLessThanOrEqual(releaseToday);
      const panel = await openWhy(page, grantWhy, `Severance if you let ${granted} go`, phone);
      await expect(panel).toContainText('Agreed share');
      await expandAll(panel);
      await expect(panel.getByText('contracts.quit.severanceShare').first()).toBeVisible();
      await closeWhy(page, panel);
      await request.getByRole('button', { name: 'Grant', exact: true }).click();
      const confirm = page.getByRole('alertdialog');
      await confirm.getByRole('button', { name: 'Grant', exact: true }).click();
      await expect(confirm).toBeHidden();
      await page.keyboard.press('Escape');
      await expect(dayButton(page, 'Next day')).toBeVisible({ timeout: 15_000 });

      await navigateInApp(page, '/game/contracts?tab=ended');
      await expect(contractRows(page).filter({ hasText: granted })).toContainText('Quit', {
        timeout: 15_000,
      });
      await openSeveranceLedger(page);
      const ledgerRow = ledgerRows(page, granted).first();
      await expect(ledgerRow).toBeVisible({ timeout: 15_000 });
      expect(Math.abs(centsOf((await ledgerRow.textContent()) ?? ''))).toBe(amount);
      await expectNoHorizontalScroll(page);
    });
  });

  test('With WRK8: a demoted main-eventer asks to leave by playing', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await enterGameFromPlayedSave(page);
    await openContracts(page, phone);
    const row = contractRows(page).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    const name = await rowName(row, phone);
    if (phone) {
      await (
        await openSheet(page, row, name, phone)
      )
        .getByRole('link', { name: `Open ${name}'s profile` })
        .click();
    } else {
      await row.getByRole('link', { name, exact: true }).click();
    }
    await expect(page).toHaveURL(/\/game\/workers\/per_/);
    test.skip(
      (await page.getByRole('tab', { name: 'Morale' }).count()) === 0,
      'Needs WRK8 (morale that moves, the Morale tab): nobody becomes unhappy by playing yet. ' +
        'The contracts save covers Grant and Refuse meanwhile.',
    );
    // WRK8: Rules > Restless, Roster > Set push > Enhancement on a main-eventer, skip 30 days,
    // then the same Refuse / Grant checks as the contracts save, plus "Refused a release
    // request" in the Morale tab's history. Written when WRK8 lands, against its real screens.
    throw new Error('WRK8 is on main: write this flow against its Morale tab (ECO4-06 step 7).');
  });
});

/** "$12,345" for an amount in cents, as the screens print it with money in full. */
function centsText(amount: number): string {
  const dollars = Math.floor(amount / 100);
  const rest = amount % 100;
  return `$${dollars.toLocaleString('en-US')}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`}`;
}
