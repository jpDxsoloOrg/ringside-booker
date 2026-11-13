/**
 * Your promotion > Roster end to end (WRK2-06), on desktop, phone and phone-webkit, through a real
 * new game on the default world as Altura Wrestling Entertainment:
 *
 * - The Wrestlers tab is selected, the six role tabs' counts add up to the "<N> under contract"
 *   line, and choosing a brand leaves only that brand's people (the tabs add up to its count).
 * - Expects, Overall and Popularity open the engine's Why?, one panel at a time.
 * - Set push for one wrestler (row menu on desktop, ticked card on a phone) shows on the row and
 *   on the profile; a bulk change of three goes through the confirm; all four survive Main menu
 *   (which saves) and Continue.
 * - No sideways scroll and no serious axe findings on the roster, with the sheet open and with the
 *   confirm open; on a phone the sheet is a bottom sheet and the tab strip scrolls inside itself.
 *
 * Counts are summed, not compared with literals, so a change to the world pack does not break it.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { openRoster, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const PROMOTION = 'Altura Wrestling Entertainment';
const BRANDS = ['Altura Mainstage', 'Altura Overclock'] as const;
const ROLE_TABS = ['Wrestlers', 'Managers', 'Announcers', 'Referees', 'Producers', 'Others'];

/** A new game builds the default world in the worker; the whole flow runs in one test. */
const FLOW_TIMEOUT_MS = 240_000;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactly(text: string): RegExp {
  return new RegExp(`^\\s*${escapeRegExp(text)}\\s*$`);
}

/** The number in brackets at the end of a tab or option name: "Wrestlers (44)" → 44. */
function countIn(text: string): number {
  const match = /\((\d[\d,]*)\)\s*$/.exec(text.trim());
  if (match?.[1] === undefined) throw new Error(`No count in "${text}"`);
  return Number(match[1].replace(/,/g, ''));
}

function tabList(page: Page): Locator {
  return page.getByRole('tablist', { name: 'Roster sections' });
}

async function tabCounts(page: Page): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const label of ROLE_TABS) {
    const tab = tabList(page).getByRole('tab', { name: new RegExp(`^${label}`) });
    counts[label] = countIn((await tab.textContent()) ?? '');
  }
  return counts;
}

function sum(counts: Record<string, number>): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

/** The rows (desktop) or cards (phone) of the open tab. */
function rosterRows(page: Page): Locator {
  return page.getByRole('tabpanel').locator('[data-row-id]');
}

function rowNamed(page: Page, name: string): Locator {
  return rosterRows(page).filter({
    has: page.locator('[data-column-id="ringName"]', { hasText: exactly(name) }),
  });
}

function pushOf(row: Locator): Locator {
  return row.locator('[data-column-id="push"]');
}

async function ringNameOf(row: Locator): Promise<string> {
  return ((await row.locator('[data-column-id="ringName"]').textContent()) ?? '').trim();
}

/** Opens the Brand selector and picks an option whose label starts with `name`; returns it. */
async function chooseBrand(page: Page, name: string): Promise<string> {
  await page.getByRole('combobox', { name: 'Brand' }).click();
  const option = page.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)} \\(`) });
  const label = ((await option.textContent()) ?? '').trim();
  await option.click();
  return label;
}

/** The sheet's box ends on the viewport's bottom edge: a bottom sheet. */
async function expectBottomSheet(page: Page, sheet: Locator): Promise<void> {
  const viewport = page.viewportSize();
  if (viewport === null) throw new Error('No viewport');
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box === null ? -1 : Math.round(box.y + box.height);
    })
    .toBeGreaterThanOrEqual(viewport.height - 1);
}

/** The tab strip scrolls sideways inside itself while the page stays put. */
async function expectTabStripScrollsInside(page: Page): Promise<void> {
  const result = await tabList(page).evaluate((list) => {
    let box: HTMLElement | null = list instanceof HTMLElement ? list : null;
    while (box !== null && box.scrollWidth <= box.clientWidth) box = box.parentElement;
    if (box === null || box === document.body) return { scrolled: 0, pageX: window.scrollX };
    box.scrollLeft = 200;
    return { scrolled: box.scrollLeft, pageX: window.scrollX };
  });
  expect(result.scrolled, 'the tab strip scrolls inside itself').toBeGreaterThan(0);
  expect(result.pageX, 'the page does not move sideways').toBe(0);
  await expectNoHorizontalScroll(page);
}

/** Leaves the game through "Main menu", which saves: the sidebar on desktop, More on a phone. */
async function leaveToMainMenu(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('button', { name: 'Main menu' })
      .click();
  } else {
    await page.getByTestId('sidebar').getByRole('button', { name: 'Main menu' }).click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
}

/** Picks a card position in the open Set push sheet and applies it. */
async function applyPush(sheet: Locator, push: string): Promise<void> {
  await sheet.getByRole('radio', { name: new RegExp(`^${push}`) }).check();
  await sheet.getByRole('button', { name: 'Apply' }).click();
}

async function openWhy(row: Locator, name: RegExp, page: Page): Promise<Locator> {
  await row.getByRole('button', { name }).click();
  const panel = page.getByRole('dialog');
  await expect(panel).toHaveCount(1);
  return panel;
}

async function closeWhy(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('roster', () => {
  test('counts, brands, Why?, set push and bulk push survive a save', async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PROMOTION, { phone });

    await test.step('the Office shows the top of the roster', async () => {
      const panel = page.getByRole('region', { name: 'Top of your roster' });
      await expect(panel.getByRole('listitem')).toHaveCount(5);
      await expect(panel.getByRole('link', { name: 'View roster' })).toBeVisible();
      await expectNoHorizontalScroll(page);
    });

    await openRoster(page, testInfo);

    await test.step('the tabs add up to the roster', async () => {
      await expect(page.locator('h1')).toHaveText('Roster');
      await expect(tabList(page).getByRole('tab', { name: /^Wrestlers/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const line = page.getByText(new RegExp(`under contract at ${PROMOTION}`));
      await expect(line).toBeVisible();
      await expect(rosterRows(page).first()).toBeVisible();
      const total = Number(((await line.textContent()) ?? '').replace(/[^\d].*$/s, ''));
      expect(total).toBeGreaterThan(0);
      const counts = await tabCounts(page);
      expect(sum(counts)).toBe(total);
      await expect(rosterRows(page)).toHaveCount(counts['Wrestlers'] ?? -1);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      if (phone) await expectTabStripScrollsInside(page);
    });

    await test.step('a brand leaves only its own people', async () => {
      await page.getByRole('combobox', { name: 'Brand' }).click();
      for (const brand of BRANDS) {
        await expect(
          page.getByRole('option', { name: new RegExp(`^${escapeRegExp(brand)} \\(`) }),
        ).toBeVisible();
      }
      await page.keyboard.press('Escape');
      const label = await chooseBrand(page, BRANDS[0]);
      const brandTotal = countIn(label);
      await expect(page).toHaveURL(/brand=/);
      await expect.poll(async () => sum(await tabCounts(page))).toBe(brandTotal);
      const counts = await tabCounts(page);
      await expect(rosterRows(page)).toHaveCount(counts['Wrestlers'] ?? -1);
      await chooseBrand(page, 'All brands');
      await expect(page).not.toHaveURL(/brand=/);
    });

    await test.step('Expects, Overall and Popularity open the Why?, one at a time', async () => {
      const row = rosterRows(page).first();
      const expects = await openWhy(row, /expected push/, page);
      // The expected push's own working sits folded under the push gap's decision.
      await expects.getByRole('button', { name: 'Expand all' }).click();
      await expect(expects).toContainText(/popularity/i);
      await expect(expects).toContainText(/Altura/);
      await closeWhy(page);

      const overall = await openWhy(row, /overall/, page);
      await expect(overall).toContainText(/workers\.rating\./);
      await expect(overall.getByRole('treeitem').nth(1)).toBeVisible();
      await closeWhy(page);

      const popularity = await openWhy(row, /popularity/, page);
      await expect(popularity).toContainText(/popularity/i);
      await expect(page.getByRole('dialog')).toHaveCount(1);
      await closeWhy(page);
    });

    const changed = new Map<string, string>();

    await test.step('Set push for one wrestler shows on the row and the profile', async () => {
      const midCard = rosterRows(page)
        .filter({ has: page.locator('[data-column-id="push"]', { hasText: exactly('Mid card') }) })
        .first();
      const name = await ringNameOf(midCard);
      if (phone) {
        await midCard.getByRole('checkbox', { name: `Select ${name}` }).check();
        const bar = page.getByRole('region', { name: 'Selected wrestlers' });
        await expect(bar).toContainText('1 selected');
        await bar.getByRole('button', { name: 'Set push…' }).click();
      } else {
        await midCard.getByRole('button', { name: `Actions for ${name}` }).click();
        await page.getByRole('menuitem', { name: 'Set push…' }).click();
      }
      const sheet = page.getByRole('dialog', { name: `Set push — ${name}` });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('radio', { name: /^Mid card/ })).toBeChecked();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      if (phone) await expectBottomSheet(page, sheet);
      await applyPush(sheet, 'Main event');
      await expect(sheet).toBeHidden();
      await expect(pushOf(rowNamed(page, name))).toHaveText('Main event');
      changed.set(name, 'Main event');

      await rowNamed(page, name).getByRole('link', { name }).click();
      await expect(page).toHaveURL(/\/game\/workers\/per_/);
      await expect(page.locator('h1')).toHaveText(name);
      const pushFact = page.locator('dt', { hasText: exactly('Push') }).locator('xpath=..');
      await expect(pushFact.locator('dd')).toHaveText('Main event');
      await page.goBack();
      await expect(page.locator('h1')).toHaveText('Roster');
    });

    await test.step('three ticked wrestlers move to Lower card together', async () => {
      const candidates = rosterRows(page).filter({
        hasNot: page.locator('[data-column-id="push"]', { hasText: exactly('Lower card') }),
      });
      const names: string[] = [];
      for (let index = 0; names.length < 3; index += 1) {
        const name = await ringNameOf(candidates.nth(index));
        if (!changed.has(name)) names.push(name);
      }
      for (const name of names) {
        await rowNamed(page, name)
          .getByRole('checkbox', { name: `Select ${name}` })
          .check();
      }
      const bar = page.getByRole('region', { name: 'Selected wrestlers' });
      await expect(bar).toContainText('3 selected');
      await bar.getByRole('button', { name: 'Set push…' }).click();

      const sheet = page.getByRole('dialog', { name: 'Set push — 3 wrestlers' });
      await expect(sheet).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      if (phone) await expectBottomSheet(page, sheet);
      await applyPush(sheet, 'Lower card');

      const confirm = page.getByRole('alertdialog', { name: 'Set 3 wrestlers to Lower card?' });
      await expect(confirm).toBeVisible();
      for (const name of names) await expect(confirm).toContainText(`${name}:`);
      await expect(confirm).toContainText('→ Lower card');
      await expectNoHorizontalScroll(page);
      await confirm.getByRole('button', { name: 'Set push' }).click();
      await expect(confirm).toBeHidden();
      for (const name of names) {
        await expect(pushOf(rowNamed(page, name))).toHaveText('Lower card');
        changed.set(name, 'Lower card');
      }
    });

    await test.step('Main menu saves, and Continue keeps the four pushes', async () => {
      await leaveToMainMenu(page, phone);
      await page.getByRole('button', { name: /^Continue/ }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
      await openRoster(page, testInfo);
      await expect(rosterRows(page).first()).toBeVisible();
      for (const [name, push] of changed) {
        await expect(pushOf(rowNamed(page, name))).toHaveText(push);
      }
    });
  });
});
