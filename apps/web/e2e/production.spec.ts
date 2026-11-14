/**
 * Business > Production in a real game.
 *
 * - The sample save: the header cards (the show-quality ceiling first), the eight areas in their
 *   two groups, and raising Camera through the change dialog.
 * - A new Hardpan game (ECO7-06, the owner's script): the starting numbers, Camera 2 → 4 for
 *   $28,000 (cash and the ledger move), Writing 2 → 1 for free, a Hardpan Friday's production row,
 *   the overhead rows on 1 Feb matching the header, and the cash runway warning with its Why?.
 * - A new Altura game: the TV deal holds camera at 1, and marketing and back office at 0 drop the
 *   popularity ceiling from 95 to 20, leaving regions above it after a day.
 *
 * Every step fits a 390px phone with no sideways scroll (at 150% UI scale too) and passes the
 * accessibility scan; no screen talks about minutes.
 */
import { expect, test } from './fixtures';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { autoFillCard, cancelTonightsShow, pickWinnersAndRunShow } from './helpers/booking';
import { enterGameFromSampleSave, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';
import {
  areaRow,
  changeDialog,
  confirmChange,
  levelOf,
  openProduction,
  requestLevel,
} from './helpers/production';
import { navigateInApp, skipToDate } from './helpers/shell';

test.describe('Business > Production', () => {
  test('shows the areas and raises Camera through the change dialog', async ({
    page,
  }, testInfo) => {
    const phone = isPhone(testInfo);
    // Motion off, so the dialog is fully faded in when the accessibility scan reads its colours.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterGameFromSampleSave(page);
    await openProduction(page, phone);

    const header = page.getByRole('group', { name: 'Production at a glance' });
    await expect(header.getByRole('group', { name: 'Popularity ceiling' })).toBeVisible();
    await expect(header.getByRole('group', { name: 'Monthly overhead' })).toBeVisible();
    // EVT4's show-quality ceiling sits first, with its Why? and the bonus-slot line (ECO7-05).
    const ceilingCard = header.getByRole('group', { name: 'Show quality ceiling' });
    await expect(ceilingCard).toBeVisible();
    await expect(ceilingCard.getByText(/^Bonus slot on regular shows and bigger: /)).toBeVisible();
    await expect(
      ceilingCard.getByRole('button', { name: /^Why is Show quality ceiling/ }),
    ).toBeVisible();
    for (const group of ['On every show', 'Every month']) {
      await expect(
        page.getByRole('region', { name: group }).getByRole('heading', { level: 3 }),
      ).toHaveCount(4);
    }
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    const camera = page.getByRole('listitem', { name: 'Camera' });
    const meter = camera.getByRole('meter', { name: 'Camera level' });
    const from = Number(await meter.getAttribute('aria-valuenow'));
    await camera.getByRole('button', { name: 'Raise Camera' }).click();

    const dialog = page.getByRole('alertdialog', {
      name: `Camera: level ${String(from)} → ${String(from + 1)}`,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('One-time fee')).toBeVisible();
    await expect(dialog.getByText('Show quality ceiling')).toBeVisible();
    const confirm = dialog.getByRole('button', { name: /^Pay \$[\d,]+ and raise$/ });
    await expect(confirm).toBeEnabled();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(meter).toHaveAttribute('aria-valuenow', String(from + 1));
  });

  test('phone: the screen and the dialog fit at 150% UI scale', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'The phone layout at a large UI scale');
    await page.goto('/settings');
    await page.getByRole('slider', { name: 'UI scale' }).fill('1.5');
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')),
      )
      .toBe('1.5');
    await enterGameFromSampleSave(page);
    await openProduction(page, true);
    await expectNoHorizontalScroll(page);

    await page
      .getByRole('listitem', { name: 'Marketing' })
      .getByRole('button', { name: 'Lower Marketing' })
      .click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Lowering is free')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});

/* ------------------------------------------------------------- new games (ECO7-06) */

const HARDPAN = 'Hardpan Pro Wrestling';
const ALTURA = 'Altura Wrestling Entertainment';
/** The default world starts on Monday 4 Jan 2027; the overhead is charged on the 1st. */
const DAY_AFTER_FIRST_OVERHEAD = '2027-02-02';
const NO_MINUTES = /minute/i;
/** Where the owner's warning screenshots go, when asked for (E2E_SHOTS=<dir>). */
const SHOTS_DIR = process.env['E2E_SHOTS'];

async function shot(page: Page, name: string, testInfo: TestInfo): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${testInfo.project.name}.png` });
}

/** Money in full ("$28,000"), so the exact amounts of the owner's script can be read. */
async function useFullMoney(page: Page): Promise<void> {
  await page.goto('/settings');
  const money = page.getByRole('radiogroup', { name: 'Money' });
  await money.getByRole('radio', { name: /^Full/ }).check();
  await expect(money.getByRole('radio', { name: /^Full/ })).toBeChecked();
}

/** "$85,000" or "−$1,250" → cents. */
function centsOf(text: string): number {
  const match = /([−-])?\$([\d,]+)(?:\.(\d{2}))?/.exec(text);
  if (match === null) throw new Error(`No money in "${text}"`);
  const value = Number((match[2] ?? '0').replace(/,/g, '')) * 100 + Number(match[3] ?? '0');
  return match[1] === undefined ? value : -value;
}

/** The cash in the top bar (in its status sheet on a phone), in cents. */
async function topBarCash(page: Page, phone: boolean): Promise<number> {
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

function headerCard(page: Page, name: string | RegExp): Locator {
  return page
    .getByRole('group', { name: 'Production at a glance' })
    .getByRole('group', { name, exact: typeof name === 'string' });
}

function dayButton(page: Page, name: string | RegExp): Locator {
  return page.getByTestId('day-control').getByRole('button', { name });
}

/** Opens a Why?, checks it reads cleanly and returns the open panel; the caller closes it. */
async function openWhy(page: Page, button: Locator, title: string | RegExp): Promise<Locator> {
  await button.click();
  const panel = page.getByRole('dialog', { name: title });
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText(/undefined|NaN/);
  await expect(panel).not.toContainText(NO_MINUTES);
  return panel;
}

/** Closes the open Why? with Escape; focus goes back to the button that opened it. */
async function closeWhy(page: Page, panel: Locator, button: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(button).toBeFocused();
}

/** On a phone a Why? is a bottom sheet: it reaches the bottom edge of the screen. */
async function expectBottomSheet(page: Page, panel: Locator, phone: boolean): Promise<void> {
  if (!phone) return;
  const box = await panel.boundingBox();
  const viewport = page.viewportSize();
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual((viewport?.height ?? 0) - 2);
}

/** The ledger's rows (table rows on desktop, cards on a phone) that contain `text`. */
function ledgerRows(page: Page, text: string | RegExp): Locator {
  return page.getByRole('main').locator('tr, li[data-row-id]').filter({ hasText: text });
}

async function openLedger(page: Page, category: string): Promise<void> {
  await navigateInApp(page, `/game/finances?tab=ledger&category=${category}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Finances' })).toBeVisible();
}

/**
 * Skips to the start of `date`, dealing with the player's show nights on the way: the first one
 * is booked with Auto-fill and run (when `runFirstShow`), every other one is cancelled from the
 * Calendar. Returns true when a show was run.
 */
async function skipToDateThroughShows(
  page: Page,
  date: string,
  phone: boolean,
  runFirstShow: boolean,
): Promise<boolean> {
  let ran = false;
  for (let stops = 0; stops < 12; stops += 1) {
    await skipToDate(page, date, phone);
    const show = dayButton(page, /Go to the show$/);
    await expect(dayButton(page, /^(Next day|(Tonight: )?Go to the show|Roster)$/)).toBeVisible({
      timeout: 15_000,
    });
    if (await show.isVisible()) {
      if (runFirstShow && !ran) {
        await show.click();
        await expect(page).toHaveURL(/\/game\/booking/);
        const sheet = await autoFillCard(page);
        await sheet.getByRole('button', { name: 'Done' }).click();
        await expect(sheet).toBeHidden();
        await pickWinnersAndRunShow(page, phone);
        ran = true;
      } else {
        await cancelTonightsShow(page);
      }
      continue;
    }
    const roster = dayButton(page, 'Roster');
    if (await roster.isVisible()) {
      await roster.click();
      continue;
    }
    return ran;
  }
  throw new Error(`The skip to ${date} kept stopping`);
}

test.describe('Production in a new Hardpan game', () => {
  test('costs, a raise, a cut, the 1st of the month and the cash runway', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const phone = isPhone(testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await useFullMoney(page);
    await startDefaultWorldGame(page, HARDPAN);
    await openProduction(page, phone);

    await test.step('the starting numbers, each with a Why?', async () => {
      for (const group of ['On every show', 'Every month']) {
        await expect(
          page.getByRole('region', { name: group }).getByRole('heading', { level: 3 }),
        ).toHaveCount(4);
      }
      const ceiling = headerCard(page, 'Popularity ceiling');
      await expect(ceiling).toContainText('30');
      const overhead = headerCard(page, 'Monthly overhead');
      await expect(overhead).toContainText('$4,700');
      const shows = headerCard(page, 'Show production, next 4 weeks');
      await expect(shows).toContainText('$2,840');
      await expect(shows).toContainText('4 shows');
      await expect(headerCard(page, 'Show quality ceiling')).toContainText('47');
      // The cash runway waits for a week of play, and says so.
      const runway = headerCard(page, 'Cash runway');
      await expect(runway).toContainText('After a week');
      await expect(runway).toContainText(/^.*Fixed costs come to \$[\d,]+ a month\./);
      await expect(areaRow(page, 'Camera')).toContainText('$600');
      await expect(areaRow(page, 'Camera')).toContainText('per Hardpan Friday (minor)');
      await expect(areaRow(page, 'Music')).toContainText('No effect yet');
      await expect(page.getByRole('main')).not.toContainText(NO_MINUTES);

      const cameraWhy = areaRow(page, 'Camera').getByRole('button', { name: /^Why is .*\$600/ });
      const panel = await openWhy(page, cameraWhy, /Camera/);
      await expect(panel).toContainText('0.2 raised to the power 3');
      await expectBottomSheet(page, panel, phone);
      await closeWhy(page, panel, cameraWhy);

      const overheadWhy = overhead.getByRole('button', { name: /^Why is Monthly overhead/ });
      await closeWhy(page, await openWhy(page, overheadWhy, /Monthly overhead/), overheadWhy);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });

    await test.step('Camera 2 → 4: the fee, the after-values, and cash down by $28,000', async () => {
      const cashBefore = await topBarCash(page, phone);
      const dialog = await requestLevel(page, 'Camera', 4);
      await expect(dialog.getByText('One-time fee')).toBeVisible();
      await expect(dialog).toContainText('$28,000');
      const perShow = dialog.locator('[data-row="areaCost"]');
      await expect(perShow).toContainText('$600');
      await expect(perShow).toContainText('$4,800');
      await expect(dialog.locator('[data-row="upcomingShows"]')).toContainText('$19,640');
      await expect(dialog).toContainText('Show quality ceiling');
      await expect(dialog).toContainText('51');
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      const raise = areaRow(page, 'Camera').getByRole('button', { name: 'Raise Camera' });
      await confirmChange(page);
      // Focus goes back to the + that opened the dialog.
      await expect(raise).toBeFocused();
      expect(await levelOf(page, 'Camera')).toBe(4);
      expect(await topBarCash(page, phone)).toBe(cashBefore - 2_800_000);
    });

    await test.step('Writing 2 → 1 is free and the overhead falls to $2,950', async () => {
      const dialog = await requestLevel(page, 'Writing', 1);
      await expect(dialog.getByText('Lowering is free')).toBeVisible();
      await expect(dialog.locator('[data-row="monthlyOverhead"]')).toContainText('$2,950');
      await confirmChange(page);
      await expect(headerCard(page, 'Monthly overhead')).toContainText('$2,950');
    });

    await test.step('the ledger has the upgrade fee with its Why?', async () => {
      await openLedger(page, 'production');
      const row = ledgerRows(page, 'Camera upgrade').first();
      await expect(row).toContainText('$28,000');
      const why = row.getByRole('button', { name: /^Why/ });
      const panel = await openWhy(page, why, /./);
      await expect(panel).toContainText('Camera');
      await closeWhy(page, panel, why);
    });

    await test.step('skip to 2 Feb: a Hardpan Friday and the overhead rows on the 1st', async () => {
      const ran = await skipToDateThroughShows(page, DAY_AFTER_FIRST_OVERHEAD, phone, !phone);
      await openLedger(page, 'production');
      if (ran) {
        // EVT3: the show's production at camera 4: $60 + $4,800 + $50.
        const show = ledgerRows(page, 'Show production: Hardpan Friday').first();
        await expect(show).toContainText('$4,910');
      }
      const production = ledgerRows(page, 'Production overhead').first();
      await expect(production).toContainText('$750');
      await expect(production).toContainText(/1 Feb/);
      await openLedger(page, 'marketing');
      await expect(ledgerRows(page, 'Marketing overhead').first()).toContainText('$1,200');
      await openLedger(page, 'backOffice');
      await expect(ledgerRows(page, 'Back office overhead').first()).toContainText('$1,000');
    });

    await test.step('Finances: the Monthly overhead and Cash runway cards, and the warning', async () => {
      await navigateInApp(page, '/game/finances');
      const overhead = page.getByRole('group', { name: 'Monthly overhead' });
      await expect(overhead).toContainText('$2,950');
      const runway = page.getByRole('group', { name: 'Cash runway' });
      await expect(runway).toContainText('A month at this rate');
      for (const line of ['Wages', 'Medical', 'Production overhead', 'Show production']) {
        await expect(runway.getByText(line, { exact: true })).toBeVisible();
      }
      // Hardpan's cancelled shows earned nothing, so the money only goes out.
      const warning = page.getByRole('region', { name: 'Cash warning' });
      await expect(warning).toContainText(
        /At this rate you run out of cash in (about \d+ months?|less than a month)\./,
      );
      const why = warning.getByRole('button', { name: /^Why is Months of cash left/ });
      const panel = await openWhy(page, why, /Months of cash left/);
      await expect(panel).toContainText('Cash now');
      await expect(panel).toContainText('Wages');
      await expectBottomSheet(page, panel, phone);
      await closeWhy(page, panel, why);
      await expect(page.getByRole('main')).not.toContainText(NO_MINUTES);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'cash-warning-finances', testInfo);

      await openProduction(page, phone);
      await expect(page.getByRole('region', { name: 'Cash warning' })).toBeVisible();
      await expect(headerCard(page, 'Cash runway')).toContainText(
        /Losing money|Running out of cash/,
      );
      await expectNoHorizontalScroll(page);
      await shot(page, 'cash-warning-production', testInfo);
    });
  });
});

test.describe('Production in a new Altura game', () => {
  test('the TV deal holds camera at 1; no marketing or back office drops the ceiling to 20', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const phone = isPhone(testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startDefaultWorldGame(page, ALTURA);
    await openProduction(page, phone);
    await expect(headerCard(page, 'Popularity ceiling')).toContainText('95');

    await test.step('camera stops at 1 while the TV deal runs', async () => {
      const dialog = await requestLevel(page, 'Camera', 0);
      await expect(dialog).toHaveAccessibleName(/^Camera: level \d+ → 1$/);
      await expect(dialog.getByRole('button', { name: 'Lower Camera' })).toHaveAttribute(
        'aria-disabled',
        'true',
      );
      // The reason is written out, not only in the held-back button's tooltip.
      await expect(dialog).toContainText(/Can't go below level 1 while your TV deal with .+ runs/);
      await expect(dialog.getByText('Lowering is free')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(changeDialog(page)).toBeHidden();
    });

    await test.step('marketing and back office to 0: the ceiling falls from 95 to 20', async () => {
      const marketing = await requestLevel(page, 'Marketing', 0);
      const ceilingRow = marketing.locator('[data-row="popularityCeiling"]');
      await expect(ceilingRow).toContainText('95');
      await expect(ceilingRow).toContainText('20');
      await expectNoSeriousA11yViolations(page);
      await confirmChange(page);
      await requestLevel(page, 'Back office', 0);
      await confirmChange(page);
      await expect(headerCard(page, 'Popularity ceiling')).toContainText('20');
    });

    await test.step('after a day the header counts the regions above the ceiling', async () => {
      await dayButton(page, /^(Next day|(Tonight: )?Go to the show)$/)
        .first()
        .waitFor();
      if (await dayButton(page, /Go to the show$/).isVisible()) await cancelTonightsShow(page);
      await dayButton(page, 'Next day').click();
      await openProduction(page, phone);
      await expect(headerCard(page, 'Popularity ceiling')).toContainText(/\d+ regions? above it/);
      await expect(page.getByRole('main')).not.toContainText(NO_MINUTES);
      await expectNoHorizontalScroll(page);
    });
  });
});
