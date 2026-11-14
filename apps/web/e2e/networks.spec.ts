/**
 * Business > Networks in real games (ECO8-06, ECO8-07 and the ECO8-08 owner test).
 *
 * - The sample save: Your deals with the one deal, its sheet (terms, health, airing history),
 *   Available networks with what each network carries, and the calendar show sheet's "On TV"
 *   section.
 * - A new Altura game (the owner's script): the three shipped deals with their expected viewers and
 *   Why?, renewing the pay-per-view deal, a week of shows run for real (a show that doesn't run is a
 *   missed airing) with last viewers, the ledger's TV rights rows and the Finances card, then
 *   Mainstage shows cancelled on the Calendar (EVT1): Missed airing, no TV money that night, and
 *   At risk after the second.
 * - A new Hardpan game: only networks that reach Texas, rival shows by name with none of their
 *   money, Bluebonnet Cable 7 would sign Hardpan Friday (and says it loses money every airing),
 *   National Signal Network refuses with its reasons, Hardpan Friday airs, and cancelling costs an
 *   exit fee in the ledger.
 * - The sheets at 150% UI scale, and a deal row by keyboard.
 *
 * Expected money comes from the screen and the world data, never hard-coded (ECO8-09 rescaled TV
 * pay). Every step fits a 390px phone with no sideways scroll, sheets are bottom sheets on a phone,
 * the accessibility scan passes and no screen talks about minutes or hours. Not covered: SOC1's
 * warning mail (the Inbox is still a placeholder).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from './fixtures';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromSampleSave, openNetworks, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { useFullMoney } from './helpers/money';
import { closeWithEscape } from './helpers/overlays';
import { skipToDateRunningShows } from './helpers/showDays';
import { isPhone } from './helpers/viewport';

const CLOCK_WORDS = /\bmin(ute)?s?\b|hours?\b/i;

async function openFromNav(page: Page, phone: boolean, name: string): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('link', { name, exact: true })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name, exact: true })
      .click();
  }
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function expectNoClockWords(page: Page): Promise<void> {
  expect(await page.locator('main').innerText()).not.toMatch(CLOCK_WORDS);
}

/** On a phone a sheet comes up from the bottom and reaches the bottom of the screen. */
async function expectBottomSheetOnPhone(
  page: Page,
  sheet: ReturnType<Page['getByRole']>,
  phone: boolean,
): Promise<void> {
  if (!phone) return;
  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error('No sheet box');
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 2);
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
}

/* ---------------------------------------------------------------- the default world's data */

/** A shipped deal or network, as `content/worlds/default/*.json` has it. */
interface WorldDeal {
  readonly key: string;
  readonly promotionKey: string;
  readonly networkKey: string;
  readonly endsOn: string;
  readonly terms: {
    readonly feePerShow: number;
    readonly perThousandViewers: number;
    readonly costPerShow: number;
  };
}

interface WorldNetwork {
  readonly key: string;
  readonly name: string;
  readonly coverage: {
    readonly continentKeys: readonly string[];
    readonly countryKeys: readonly string[];
    readonly regionKeys: readonly string[];
  };
}

type JsonObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The rows of one of the default world's JSON files. */
function worldRows(name: string): readonly JsonObject[] {
  const path = fileURLToPath(new URL(`../../../content/worlds/default/${name}`, import.meta.url));
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${name} is not a list`);
  return raw.filter(isObject);
}

function field<T>(row: JsonObject, key: string, check: (value: unknown) => value is T): T {
  const value = row[key];
  if (!check(value)) throw new Error(`Unexpected ${key} in ${JSON.stringify(row)}`);
  return value;
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isStrings = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every(isString);

const DEALS: readonly WorldDeal[] = worldRows('deals.json').map((row) => {
  const terms = field(row, 'terms', isObject);
  return {
    key: field(row, 'key', isString),
    promotionKey: field(row, 'promotionKey', isString),
    networkKey: field(row, 'networkKey', isString),
    endsOn: field(row, 'endsOn', isString),
    terms: {
      feePerShow: field(terms, 'feePerShow', isNumber),
      perThousandViewers: field(terms, 'perThousandViewers', isNumber),
      costPerShow: field(terms, 'costPerShow', isNumber),
    },
  };
});

const NETWORKS: readonly WorldNetwork[] = worldRows('networks.json').map((row) => {
  const coverage = field(row, 'coverage', isObject);
  return {
    key: field(row, 'key', isString),
    name: field(row, 'name', isString),
    coverage: {
      continentKeys: field(coverage, 'continentKeys', isStrings),
      countryKeys: field(coverage, 'countryKeys', isStrings),
      regionKeys: field(coverage, 'regionKeys', isStrings),
    },
  };
});

function shippedDeal(key: string): WorldDeal {
  const deal = DEALS.find((row) => row.key === key);
  if (deal === undefined) throw new Error(`No shipped deal ${key}`);
  return deal;
}

const ALTURA = 'Altura Wrestling Entertainment';
const HARDPAN = 'Hardpan Pro Wrestling';
const MAINSTAGE = 'National Signal Network · Altura Mainstage';
const OVERCLOCK = 'Kestrel Sports · Altura Overclock';
const TURNSTILE = 'Turnstile Pay-Per-View · All major shows';
const BLUEBONNET = 'Bluebonnet Cable 7';
const NSN = 'National Signal Network';

/** Hardpan's fans are only in Texas: the networks whose coverage reaches it. */
function reachesTexas(network: WorldNetwork): boolean {
  return (
    network.coverage.regionKeys.includes('us-texas') ||
    network.coverage.countryKeys.includes('us') ||
    network.coverage.continentKeys.includes('na')
  );
}

/** "Jul 2, 2029", as the Networks screen prints a date. */
function screenDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Mon 4 Jan 2027", as the ledger prints a date. */
function ledgerDate(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  const part = (options: Intl.DateTimeFormatOptions): string =>
    date.toLocaleDateString('en-GB', { ...options, timeZone: 'UTC' });
  return `${part({ weekday: 'short' })} ${part({ day: 'numeric' })} ${part({ month: 'short' })} ${part({ year: 'numeric' })}`;
}

/** The ISO date `months` months after `iso` (the day of the month kept). */
function addMonthsIso(iso: string, months: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

/** An amount in cents as full money prints it: "$137,700", "$825". */
function fullMoney(amountCents: number): string {
  return `$${(amountCents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

/** The number in a Why? button's name: "Why is X viewers on Jan 4, 2027 3,079,887?" → 3079887. */
async function numberInWhy(button: Locator): Promise<number> {
  const name = (await button.getAttribute('aria-label')) ?? '';
  const match = /([\d,]+)\?$/.exec(name);
  if (match === null) throw new Error(`No number in "${name}"`);
  return Number((match[1] ?? '').replace(/,/g, ''));
}

/* ---------------------------------------------------------------- steps */

/** A deal or network row: a table row on desktop, a card on a phone. */
function rowWith(page: Page, phone: boolean, text: string): Locator {
  return (phone ? page.getByRole('listitem') : page.getByRole('row')).filter({ hasText: text });
}

/** Opens a Why? and waits for its panel (expanded), which is returned open. */
async function openWhy(page: Page, button: Locator, title: string | RegExp): Promise<Locator> {
  await button.click();
  const panel = page.getByRole('dialog', { name: title });
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText(/undefined|NaN/);
  await expect(panel).not.toContainText(CLOCK_WORDS);
  const expand = panel.getByRole('button', { name: 'Expand all' });
  if (await expand.isVisible()) await expand.click();
  return panel;
}

/** Opens Business > Finances: the sidebar on desktop, the More sheet on a phone. */
async function openFinances(page: Page, testInfo: TestInfo): Promise<void> {
  await openFromNav(page, isPhone(testInfo), 'Finances');
}

/** The ledger, filtered to one category. */
async function openLedger(page: Page, category: string): Promise<void> {
  await navigateInApp(page, `/game/finances?tab=ledger&category=${category}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Finances' })).toBeVisible();
}

/** A ledger row's Why? button, by its category label and date: "Why is TV rights, Mon 4 Jan 2027 …". */
function ledgerWhy(page: Page, label: string, iso: string): Locator {
  return page
    .getByRole('main')
    .getByRole('button', { name: new RegExp(`^Why is ${label}, ${ledgerDate(iso)} `) });
}

/** The ledger's rows (table rows on desktop, cards on a phone) that contain `text`. */
function ledgerRows(page: Page, text: string | RegExp): Locator {
  return page.getByRole('main').locator('tr, li[data-row-id]').filter({ hasText: text });
}

/** Opens a deal's sheet from Your deals and returns it. */
async function openDeal(page: Page, title: string): Promise<Locator> {
  await page.getByRole('main').getByRole('button', { name: title, exact: true }).click();
  const sheet = page.getByRole('dialog', { name: title, exact: true });
  await expect(sheet.getByRole('heading', { name: 'Terms' })).toBeVisible();
  return sheet;
}

/**
 * Cancels one of the player's shows from the Calendar's show sheet (EVT1) and leaves the sheet
 * open, which it returns.
 */
async function cancelShowOn(page: Page, iso: string, show: string): Promise<Locator> {
  await navigateInApp(page, '/game/calendar');
  await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();
  await page
    .locator(`[data-calendar-date="${iso}"] button[data-own="true"][title="${show}"]`)
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: show, exact: true });
  await sheet.getByRole('button', { name: 'Cancel show' }).click();
  const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog', { name: /^Cancel / }));
  await confirm.getByRole('button', { name: 'Cancel show' }).click();
  await expect(confirm).toBeHidden();
  await expect(sheet.getByRole('button', { name: 'Cancel show' })).toBeHidden();
  return sheet;
}

/** Sets the UI scale on Settings (the app keeps it for the game). */
async function setUiScale(page: Page, scale: string): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('slider', { name: 'UI scale' }).fill(scale);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')))
    .toBe(scale);
}

/** No sideways scroll, no serious axe finding, no clock words, with whatever is open. */
async function expectFits(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
  for (const text of await page
    .locator('main, [role="dialog"], [role="alertdialog"]')
    .allInnerTexts()) {
    expect(text).not.toMatch(CLOCK_WORDS);
  }
}

test.describe('Business > Networks', () => {
  test('your deal, its sheet and the networks that reach your fans', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterGameFromSampleSave(page);
    await openFromNav(page, phone, 'Networks');
    await expect(page).toHaveURL(/\/game\/networks$/);

    const open = page.getByRole('button', { name: 'Test Network North · Test Weekly' });
    await expect(open).toBeVisible();
    await expect(page.getByText('Thu · Prime time · Live').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    await expectNoClockWords(page);

    await open.click();
    const sheet = page.getByRole('dialog', { name: 'Test Network North · Test Weekly' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Terms' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Airing history' })).toBeVisible();
    await expect(sheet.getByText('Safe').first()).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Renegotiate' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Cancel deal' })).toBeVisible();
    await expect(page).toHaveURL(/\?deal=dea_/);
    await expectBottomSheetOnPhone(page, sheet, phone);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    await page.getByRole('tab', { name: 'Available networks' }).click();
    await expect(page).toHaveURL(/\?tab=eco\.available$/);
    await expect(page.getByText('Networks that reach places where fans know you.')).toBeVisible();
    await expect(page.getByText('Test Network North', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Test Weekly · Test Promotion A').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    await expectNoClockWords(page);

    // ECO8-07: the calendar show sheet says what the last Test Weekly drew on TV and paid (the
    // tiny world stores no Test Weekly still to come; the other states are in OnTvSection.test).
    await navigateInApp(page, '/game/calendar');
    await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();
    await page
      .locator('button[data-own="true"][title="Test Weekly"][data-status="completed"]')
      .first()
      .click();
    const showSheet = page.getByRole('dialog', { name: 'Test Weekly', exact: true });
    await expect(showSheet.getByRole('heading', { name: 'On TV' })).toBeVisible();
    await expect(
      showSheet.getByText(/^Test Network North: [\d.]+[KM]? viewers · \$/),
    ).toBeVisible();
    await expectBottomSheetOnPhone(page, showSheet, phone);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('Altura: three deals, a renewal, a week on TV, the ledger, and cancelled shows', async ({
    page,
  }, testInfo) => {
    test.setTimeout(420_000);
    const phone = isPhone(testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await useFullMoney(page);
    await startDefaultWorldGame(page, ALTURA);

    await test.step('Your deals lists the three shipped deals, each Safe', async () => {
      await openNetworks(page, testInfo);
      await expect(page.getByRole('tab', { name: 'Your deals' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const rows: readonly {
        readonly title: string;
        readonly key: string;
        readonly slot: string;
        readonly network: string;
      }[] = [
        {
          title: MAINSTAGE,
          key: 'flagship-mainstage-tv',
          slot: 'Mon · Prime time · Live',
          network: NSN,
        },
        {
          title: OVERCLOCK,
          key: 'flagship-overclock-tv',
          slot: 'Wed · Prime time · Live',
          network: 'Kestrel Sports',
        },
        {
          title: TURNSTILE,
          key: 'flagship-ppv',
          slot: 'Pay-per-view · Live',
          network: 'Turnstile Pay-Per-View',
        },
      ];
      for (const { title, key, slot, network } of rows) {
        const deal = shippedDeal(key);
        const row = rowWith(page, phone, title);
        await expect(row.getByRole('button', { name: title, exact: true })).toBeVisible();
        await expect(row).toContainText(slot);
        await expect(row).toContainText(
          deal.terms.feePerShow === 0 ? 'per buy' : fullMoney(deal.terms.feePerShow * 100),
        );
        await expect(row).toContainText(screenDate(deal.endsOn));
        await expect(row.locator('[data-risk="safe"]')).toBeVisible();
        await expect(row.getByText('Safe', { exact: true })).toBeVisible();
        const expects = row.getByRole('button', {
          name: new RegExp(`^Why is What ${network} expects [\\d,]+\\?$`),
        });
        await expect(expects).toBeVisible();
        expect(await numberInWhy(expects)).toBeGreaterThan(0);
      }
      await expectFits(page);

      const panel = await openWhy(
        page,
        rowWith(page, phone, MAINSTAGE).getByRole('button', { name: /^Why is What National/ }),
        `What ${NSN} expects`,
      );
      await expect(panel.getByText(/United States/).first()).toBeVisible();
      await expect(panel.getByText(/^Reach tier \d/).first()).toBeVisible();
      await closeWithEscape(page, panel);
    });

    await test.step('renew Turnstile Pay-Per-View for 24 months', async () => {
      const deal = shippedDeal('flagship-ppv');
      const newEnd = screenDate(addMonthsIso(deal.endsOn, 24));
      const sheet = await openDeal(page, TURNSTILE);
      await sheet.getByRole('button', { name: 'Renegotiate' }).click();
      const renew = page.getByRole('dialog', { name: `Renew: ${TURNSTILE}` });
      await renew.getByRole('combobox', { name: 'Length' }).click();
      await page.getByRole('option', { name: '24 months', exact: true }).click();
      const compare = renew.getByRole('table', { name: 'Current terms against new terms' });
      await expect(compare.getByRole('row', { name: /^Per buy/ })).toContainText('per buy');
      await expect(
        compare.getByRole('button', { name: /^Why is Renewed per buy \$[\d.]+ per buy\?$/ }),
      ).toBeVisible();
      await expect(renew.getByText(newEnd, { exact: true })).toBeVisible();
      await expect(
        renew.getByRole('button', { name: /^Why is Income per airing after renewing / }),
      ).toBeVisible();
      await expect(renew.getByText(/^Pay-per-view airtime is expensive\./)).toBeVisible();
      await expectBottomSheetOnPhone(page, renew, phone);
      await expectFits(page);
      await renew.getByRole('button', { name: 'Renew', exact: true }).click();
      const detail = page.getByRole('dialog', { name: TURNSTILE, exact: true });
      await expect(detail.getByText(new RegExp(`^${newEnd} · in \\d+ days$`))).toBeVisible();
      await closeWithEscape(page, detail);
      await expect(rowWith(page, phone, TURNSTILE)).toContainText(newEnd);
    });

    await test.step('Tab to a deal row, Enter opens its sheet, Escape brings focus back', async () => {
      // Desktop: the keyboard path through the table.
      if (phone) return;
      const open = page.getByRole('main').getByRole('button', { name: MAINSTAGE, exact: true });
      await page.getByRole('tab', { name: 'Your deals' }).focus();
      for (let presses = 0; presses < 40; presses += 1) {
        await page.keyboard.press('Tab');
        if (await open.evaluate((element) => element === document.activeElement)) break;
      }
      await expect(open).toBeFocused();
      await page.keyboard.press('Enter');
      const sheet = page.getByRole('dialog', { name: MAINSTAGE, exact: true });
      await expect(sheet).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(open).toBeFocused();
    });

    await test.step('a week of shows: last viewers with their Why?', async () => {
      // Mainstage (Mon 4 Jan) and Overclock (Wed 6 Jan) are booked with Auto-fill and run.
      await skipToDateRunningShows(page, '2027-01-11', phone);
      await openNetworks(page, testInfo);
      const mainstage = rowWith(page, phone, MAINSTAGE).getByRole('button', {
        name: /^Why is Altura Mainstage viewers on Jan 4, 2027 [\d,]+\?$/,
      });
      const overclock = rowWith(page, phone, OVERCLOCK).getByRole('button', {
        name: /^Why is Altura Overclock viewers on Jan 6, 2027 [\d,]+\?$/,
      });
      expect(await numberInWhy(mainstage), 'Mainstage draws millions').toBeGreaterThanOrEqual(
        1_000_000,
      );
      expect(await numberInWhy(overclock)).toBeGreaterThan(0);
      await expectFits(page);
      const panel = await openWhy(page, mainstage, /^Altura Mainstage viewers on Jan 4, 2027$/);
      // The airing's Why? is income less airtime: the viewers by country, the slot, live and the
      // show's score (the popularity curve is compacted away on a stored airing).
      await expect(panel.getByText(/United States/).first()).toBeVisible();
      await expect(panel.getByText('Prime time', { exact: false }).first()).toBeVisible();
      await expect(panel.getByText(/^Live bonus/).first()).toBeVisible();
      await expect(panel.getByText(/^Show score \d+ \(slot-weighted\)/).first()).toBeVisible();
      await expect(
        panel.getByText(/expected [\d,]+ viewers; [\d,]+ watched/).first(),
      ).toBeVisible();
      await closeWithEscape(page, panel);
    });

    await test.step('the ledger has a TV rights row for each airing, with its Why?', async () => {
      await openLedger(page, 'broadcast');
      await expect(
        ledgerRows(page, 'Broadcast: Altura Mainstage on National Signal Network').first(),
      ).toBeVisible();
      await expect(
        ledgerRows(page, 'Broadcast: Altura Overclock on Kestrel Sports').first(),
      ).toBeVisible();
      // Show results are built (EVT3): no memo says the show aired without one.
      await expect(page.getByRole('main')).not.toContainText('aired without a show result');
      const overclock = ledgerWhy(page, 'TV rights', '2027-01-06');
      await expect(overclock).toBeVisible();
      const panel = await openWhy(
        page,
        ledgerWhy(page, 'TV rights', '2027-01-04'),
        `TV rights, ${ledgerDate('2027-01-04')}`,
      );
      await expect(panel.getByText(/^Fee per show: \$/).first()).toBeVisible();
      await expect(panel.getByText(/Per 1,000 viewers ×/).first()).toBeVisible();
      await expect(panel.getByText(/^Viewers on National Signal Network: [\d,]+$/)).toBeVisible();
      await closeWithEscape(page, panel);
      await expectNoHorizontalScroll(page);

      await openFinances(page, testInfo);
      const card = page.getByRole('group', { name: 'TV income (30 days)' });
      await expect(
        card.getByRole('button', { name: /^Why is TV income \(30 days\) / }),
      ).toBeVisible();
      await expect(card).toContainText('Last airing: Altura Overclock');
      // A week in, nothing has been rolled up: no "details are kept" note yet.
      await expect(card).not.toContainText('Details are kept');
    });

    await test.step('EVT1: cancel Mainstage on Mon 18 Jan: Missed airing on Networks', async () => {
      const showSheet = await cancelShowOn(page, '2027-01-18', 'Altura Mainstage');
      await expect(showSheet.getByRole('heading', { name: 'On TV' })).toBeVisible();
      await expect(showSheet).toContainText(/Missed airing/);
      await closeWithEscape(page, showSheet);
      await openNetworks(page, testInfo);
      const row = rowWith(page, phone, MAINSTAGE);
      await expect(row.getByText('Missed airing', { exact: true })).toBeVisible();
      const sheet = await openDeal(page, MAINSTAGE);
      await expect(sheet.getByText(/^Missed airing coming: Mon 18 Jan/)).toBeVisible();
      await closeWithEscape(page, sheet);
    });

    await test.step('skip past 18 Jan: no TV money that night, the history says why', async () => {
      // Mainstage on 11 Jan and Overclock on 13 Jan run; 18 Jan stays cancelled.
      await skipToDateRunningShows(page, '2027-01-19', phone);
      await openLedger(page, 'broadcast');
      await expect(ledgerWhy(page, 'TV rights', '2027-01-11')).toBeVisible();
      await expect(ledgerWhy(page, 'TV rights', '2027-01-18')).toHaveCount(0);
      await openNetworks(page, testInfo);
      const sheet = await openDeal(page, MAINSTAGE);
      await expect(sheet.getByText('Missed: show cancelled').first()).toBeVisible();
      await expectFits(page);
      await closeWithEscape(page, sheet);
    });

    await test.step('a second missed airing (25 Jan) puts the deal At risk', async () => {
      const showSheet = await cancelShowOn(page, '2027-01-25', 'Altura Mainstage');
      await closeWithEscape(page, showSheet);
      // Overclock on 20 Jan runs; the 25th is the second missed Mainstage.
      await skipToDateRunningShows(page, '2027-01-26', phone);
      await openNetworks(page, testInfo);
      const row = rowWith(page, phone, MAINSTAGE);
      await expect(row.locator('[data-risk="atRisk"]')).toBeVisible();
      const sheet = await openDeal(page, MAINSTAGE);
      await expect(
        sheet.getByText(`One more missed airing and ${NSN} cancels`, { exact: true }),
      ).toBeVisible();
      await closeWithEscape(page, sheet);
    });
  });

  test('Hardpan: networks that reach Texas, a deal that loses money, a refusal, an airing and an exit', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const phone = isPhone(testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await useFullMoney(page);
    await startDefaultWorldGame(page, HARDPAN);

    await test.step('Available networks: only those that reach Texas', async () => {
      await openNetworks(page, testInfo);
      await expect(page.getByRole('heading', { name: 'No TV deals yet' })).toBeVisible();
      await page.getByRole('button', { name: 'See available networks' }).click();
      await expect(page).toHaveURL(/\?tab=eco\.available$/);
      await page.locator('[data-propose]').first().waitFor();
      const main = page.getByRole('main');
      for (const network of NETWORKS) {
        const listed = main.getByText(network.name, { exact: true });
        if (reachesTexas(network)) await expect(listed.first()).toBeVisible();
        else await expect(listed).toHaveCount(0);
      }
      await expectFits(page);
    });

    await test.step('privacy: rival shows by name, none of their money', async () => {
      const main = page.getByRole('main');
      await expect(
        main.getByText('Altura Mainstage · Altura Wrestling Entertainment').first(),
      ).toBeVisible();
      const text = await main.innerText();
      // The rival deals this tab can show: those on networks that reach Texas.
      const listed = new Set(NETWORKS.filter(reachesTexas).map((network) => network.key));
      const rivalFigures = DEALS.filter((deal) => listed.has(deal.networkKey))
        .flatMap((deal) => [deal.terms.feePerShow, deal.terms.costPerShow])
        .filter((amount) => amount >= 100)
        .map((amount) => fullMoney(amount * 100));
      expect(rivalFigures.length).toBeGreaterThanOrEqual(4);
      for (const figure of rivalFigures) {
        const escaped = figure.replace(/[$.]/g, '\\$&');
        expect(text, `no rival figure ${figure}`).not.toMatch(new RegExp(`${escaped}(?![\\d,])`));
      }
      // The pay-per-view rate per buy that Altura gets.
      const ppv = shippedDeal('flagship-ppv').terms.perThousandViewers;
      expect(text).not.toContain(`$${(ppv / 1000).toFixed(2)} per buy`);
    });

    await test.step('Bluebonnet Cable 7 would sign Hardpan Friday, and says it loses money', async () => {
      const best = rowWith(page, phone, BLUEBONNET).getByRole('button', {
        name: new RegExp(`^Why does an airing on ${BLUEBONNET} lose \\$`),
      });
      const offer = await openWhy(page, best, `What an airing on ${BLUEBONNET} would lose`);
      await closeWithEscape(page, offer);
      await rowWith(page, phone, BLUEBONNET).getByRole('button', { name: 'Propose' }).click();
      const sheet = page.getByRole('dialog', { name: `Propose a deal to ${BLUEBONNET}` });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('combobox', { name: 'Show' })).toContainText('Hardpan Friday');
      await sheet.getByRole('radio', { name: 'Evening' }).check();
      await expect(sheet.getByRole('switch', { name: 'Live' })).not.toBeChecked();
      await sheet.getByRole('combobox', { name: 'Length' }).click();
      await page.getByRole('option', { name: '12 months', exact: true }).click();
      await expect(sheet.getByText('Would accept')).toBeVisible();
      await expect(sheet.getByText('Signing makes this show a TV show.')).toBeVisible();
      const projected = sheet.getByRole('button', { name: /^Why is Projected viewers [\d,]+\?$/ });
      expect(await numberInWhy(projected), 'thousands of viewers').toBeGreaterThanOrEqual(1_000);
      await expect(
        sheet.getByText(
          'This deal loses money every airing: the airtime costs more than the network pays.',
        ),
      ).toBeVisible();
      await expect(
        sheet.getByRole('button', { name: /^Why is Income per airing −\$/ }),
      ).toBeVisible();
      await expectBottomSheetOnPhone(page, sheet, phone);
      await expectFits(page);

      await sheet.getByRole('button', { name: 'Propose deal' }).click();
      await expect(sheet).toBeHidden();
      await expect(page).toHaveURL(/\?tab=eco\.yourDeals$/);
      await expect(page.getByRole('button', { name: /^Bluebonnet Cable 7 · / })).toBeFocused();
    });

    await test.step('National Signal Network refuses, with every reason', async () => {
      await page.getByRole('tab', { name: 'Available networks' }).click();
      await page.locator('[data-propose]').first().waitFor();
      await rowWith(page, phone, NSN).getByRole('button', { name: 'Propose' }).click();
      const sheet = page.getByRole('dialog', { name: `Propose a deal to ${NSN}` });
      await sheet.getByRole('radio', { name: 'Prime time' }).check();
      await expect(sheet.getByText('Would refuse')).toBeVisible();
      const reasons = sheet.getByRole('list', { name: `Why ${NSN} would refuse` });
      await expect(reasons).toContainText(/camera level/);
      await expect(reasons).toContainText(/Your audience would be about \d+% of what/);
      await expect(reasons).toContainText(/prime time/i);
      await expect(sheet.getByRole('button', { name: 'Propose deal' })).toBeDisabled();
      const verdict = await openWhy(
        page,
        sheet.getByRole('button', { name: `Why is ${NSN}'s answer Would refuse?` }),
        /./,
      );
      await closeWithEscape(page, verdict);
      await expectFits(page);
      await sheet.getByRole('button', { name: 'Not now' }).click();
      await expect(sheet).toBeHidden();
    });

    await test.step('Hardpan Friday airs on Fri 8 Jan', async () => {
      await skipToDateRunningShows(page, '2027-01-09', phone);
      await openLedger(page, 'broadcast');
      await expect(
        ledgerRows(page, `Broadcast: Hardpan Friday on ${BLUEBONNET}`).first(),
      ).toBeVisible();
      await expect(ledgerWhy(page, 'TV rights', '2027-01-08')).toBeVisible();
      await openNetworks(page, testInfo);
      await expect(
        rowWith(page, phone, BLUEBONNET).getByRole('button', {
          name: /^Why is Hardpan Friday viewers on Jan 8, 2027 [\d,]+\?$/,
        }),
      ).toBeVisible();
    });

    await test.step('cancel the deal: an exit fee with its Why?, then an Early exit row', async () => {
      const title = `${BLUEBONNET} · Hardpan Friday`;
      const sheet = await openDeal(page, title);
      // The last airing lost money, and the sheet says so.
      await expect(sheet.getByText(/^This deal lost money on its last airing/)).toBeVisible();
      await sheet.getByRole('button', { name: 'Cancel deal' }).click();
      const confirm = page.getByRole('alertdialog', {
        name: new RegExp(`^Cancel your deal with ${BLUEBONNET}\\? You pay an exit fee of \\$`),
      });
      await expect(confirm).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      const fee = await openWhy(
        page,
        confirm.getByRole('button', { name: /^Why is Exit fee / }),
        'Exit fee',
      );
      await closeWithEscape(page, fee);
      await confirm.getByRole('button', { name: 'Cancel deal' }).click();
      await expect(confirm).toBeHidden();
      if (await sheet.isVisible()) await closeWithEscape(page, sheet);
      await expect(page.getByRole('main').getByRole('button', { name: title })).toHaveCount(0);
      await openLedger(page, 'otherCost');
      await expect(ledgerRows(page, `Early exit: ${BLUEBONNET}`).first()).toBeVisible();

      await openFinances(page, testInfo);
      const card = page.getByRole('group', { name: 'TV income (30 days)' });
      await expect(card.getByRole('button', { name: /^Why is TV income/ })).toBeVisible();
      await expect(card).toContainText('Last airing: Hardpan Friday');
      await expectNoHorizontalScroll(page);
    });
  });

  test('every sheet fits at 150% UI scale', async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await setUiScale(page, '1.5');
    await startDefaultWorldGame(page, ALTURA);
    await openNetworks(page, testInfo);
    await expect(page.getByRole('main').getByRole('button', { name: MAINSTAGE })).toBeVisible();
    await expectFits(page);

    const sheet = await openDeal(page, MAINSTAGE);
    await expectFits(page);
    await sheet.getByRole('button', { name: 'Renegotiate' }).click();
    const renew = page.getByRole('dialog', { name: `Renew: ${MAINSTAGE}` });
    await expect(renew.getByText(/^Would (accept|refuse)$/)).toBeVisible();
    await expectFits(page);
    await renew.getByRole('button', { name: 'Back' }).click();
    await sheet.getByRole('button', { name: 'Cancel deal' }).click();
    const confirm = page.getByRole('alertdialog', { name: /^Cancel your deal with / });
    await expect(confirm.getByRole('button', { name: /^Why is Exit fee / })).toBeVisible();
    await expectFits(page);
    await confirm.getByRole('button', { name: 'Keep the deal' }).click();
    await expect(confirm).toBeHidden();
    await closeWithEscape(page, sheet);

    await page.getByRole('tab', { name: 'Available networks' }).click();
    await page.locator('[data-propose]').first().waitFor();
    await expectFits(page);
    await page.locator('[data-propose]').first().click();
    const propose = page.getByRole('dialog', { name: /^Propose a deal to / });
    await expect(propose.getByText(/^Would (accept|refuse)$/)).toBeVisible();
    await expectFits(page);
  });
});
