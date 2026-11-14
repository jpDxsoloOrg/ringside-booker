/**
 * AIP5 end to end, the owner's script on a fresh default-world game as Longleaf (AIP5-07), on
 * desktop, phone and iPhone WebKit:
 *
 * - A 14-day skip to Mon 18 Jan stops on Sat 9 and Sat 16 Jan for Longleaf Saturday Night. Each
 *   time: Booking > Auto-fill empty slots (it books the card but never picks a winner), the
 *   player picks every winner and runs the show. The player's own results page has no "Booker's
 *   calls" section.
 * - Promotions > Altura > Shows > Altura Mainstage on Mon 4 Jan: every match slot has a winner
 *   marker (or says Draw) and a result line with its method; a result's Why? reads "Who wins"; a
 *   title match shows Retained or New champion and that badge's Why? names the reign ("Reign of
 *   ..."). No minutes anywhere.
 * - Altura's next show still hides its card ("Card is revealed when the show airs").
 * - The Overview has a "Recent title changes" panel (items or its empty state); the Decision log
 *   has Winners and Titles chips, and Titles shows only title decisions.
 * - With MTCH2 (wired by AIP5-06): each result line names its finish next to the method.
 *   AIP2 and AIP3 are not on main yet, so their steps wait for their own packs. DAY2's history is
 *   wired, but its readings need four weeks of play, which the headless title check covers.
 *
 * On a phone the result line and the badges sit inside the slot card, each badge beside its Why?,
 * a Why? opens as a bottom sheet, and nothing scrolls sideways with a slot open or a Why? open.
 * Rival rolls depend on the new game's seed, so the spec asserts only what every seed gives: a
 * title match or a non-title match it needs is looked for on Altura's other aired shows too.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { autoFillCard, pickWinnersAndRunShow, skipDaysOnce } from './helpers/booking';
import { clearOtherStops } from './helpers/contracts';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { openPromotionTab } from './helpers/promotions';
import { isPhone } from './helpers/viewport';

const PLAYER = 'Longleaf Championship Wrestling';
const MY_SHOW = 'Longleaf Saturday Night';
const RIVAL = 'Altura Wrestling Entertainment';
const RIVAL_SHOW = 'Altura Mainstage';
/** The game starts on Mon 4 Jan 2027; the skip runs to Mon 18 Jan. */
const RIVAL_SHOW_DAY = 'Mon 4 Jan';
const SKIP_DAYS = 14;
/** The skip stops on Longleaf's Saturdays, 9 and 16 Jan. */
const EXPECTED_STOPS = 2;
/** A show's disclosure button: any button in its header that is not a Why?. */
const SHOW_TOGGLE = /^(?!Why)/;
const NO_TIMES = /minute/i;
/** The base catalog's ways to win, as a result line names them. */
const METHOD_NAMES = /Pinfall|Submission|Knockout|Referee Stoppage|Count-Out|Disqualification/;
/** MTCH2's finishes, as a rival result line names them. */
const FINISH_NAMES =
  /Clean finish|Flash finish|Cheating finish|Outside interference|Count-out|Disqualification|Controversial finish|Double count-out|Stalemate|No contest/;
/** Where the spec leaves viewport screenshots, when asked (`E2E_SHOTS=<folder>`). */
const SHOTS_DIR = process.env['E2E_SHOTS'];

async function shot(page: Page, name: string, projectName: string): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${projectName}.png` });
}

/** Opens a show row's card; nothing to do when it is already open. */
async function expand(row: Locator): Promise<void> {
  const toggle = row.getByRole('button', { name: SHOW_TOGGLE }).first();
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
}

/** Opens a Why?, checks it reads cleanly and returns the open panel; the caller closes it. */
async function openWhy(page: Page, button: Locator, title: RegExp): Promise<Locator> {
  await button.click();
  const panel = page.getByRole('dialog', { name: title });
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText(/undefined|NaN/);
  await expect(panel).not.toContainText(NO_TIMES);
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

/** `inner` lies inside `outer` on screen, give or take a pixel. */
async function expectInside(inner: Locator, outer: Locator): Promise<void> {
  const innerBox = await inner.boundingBox();
  const outerBox = await outer.boundingBox();
  expect(innerBox).not.toBeNull();
  expect(outerBox).not.toBeNull();
  if (innerBox === null || outerBox === null) return;
  expect(innerBox.x).toBeGreaterThanOrEqual(outerBox.x - 1);
  expect(innerBox.x + innerBox.width).toBeLessThanOrEqual(outerBox.x + outerBox.width + 1);
  expect(innerBox.y).toBeGreaterThanOrEqual(outerBox.y - 1);
  expect(innerBox.y + innerBox.height).toBeLessThanOrEqual(outerBox.y + outerBox.height + 1);
}

/** The Shows tab's aired show rows, newest first. */
function airedRows(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Recent shows' })
    .locator('article[data-revealed="true"]');
}

/** The match rows of an open show card. */
function matchRows(row: Locator): Locator {
  return row.locator('li[data-segment-kind="match"]');
}

/**
 * Opens aired Altura shows, newest first, until one has a match `pick` accepts; returns that match
 * row, or null when no aired show has one.
 */
async function findMatch(page: Page, pick: (matches: Locator) => Locator): Promise<Locator | null> {
  const count = await airedRows(page).count();
  for (let index = 0; index < count; index += 1) {
    const row = airedRows(page).nth(index);
    await expand(row);
    const found = pick(matchRows(row));
    if ((await found.count()) > 0) return found.first();
  }
  return null;
}

test.describe('rival winners and title changes on a new game', () => {
  test('Altura’s results explain themselves, your own show keeps your winners', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PLAYER, { phone });

    await test.step('skip to 18 Jan, booking Longleaf’s shows with your own winners', async () => {
      let left = SKIP_DAYS;
      let stops = 0;
      for (let round = 0; left > 0 && round <= SKIP_DAYS; round += 1) {
        // A show can leave a stop behind (a worker hurt in it), which turns Skip days off.
        await clearOtherStops(page);
        left -= await skipDaysOnce(page, left, phone);
        if (left === 0) break;
        // An injury or a contract notice can stop the skip too: those are cleared and the skip
        // carries on, so only Longleaf's show nights are booked here.
        if (!(await clearOtherStops(page))) continue;
        stops += 1;
        const summary = page.getByRole('region', { name: 'Last advance' });
        await expect(summary).toContainText(`Your show '${MY_SHOW}'`);
        await summary.getByRole('link', { name: 'Go to the show' }).click();
        await expect(page).toHaveURL(/\/game\/booking/);

        const sheet = await autoFillCard(page);
        await sheet.getByRole('button', { name: 'Done' }).click();
        await expect(sheet).toBeHidden();
        // Auto-fill books the card but never picks a winner: that is the player's call.
        await expect(page.getByRole('main').locator('article[data-state="empty"]')).toHaveCount(0);
        await expect(page.getByRole('main').locator('[data-part="winner"]')).toHaveCount(0);

        await pickWinnersAndRunShow(page, phone);
        await expect(page.getByRole('heading', { level: 1 })).toContainText(MY_SHOW);
        // Your own results page: your winners ran as picked, with no rival booker's reasons.
        await expect(page.getByRole('main')).not.toContainText("Booker's calls");
        await expect(page.getByRole('list', { name: "Booker's calls" })).toHaveCount(0);
        await expectNoHorizontalScroll(page);
      }
      expect(left, 'every day of the skip ran').toBe(0);
      expect(stops).toBe(EXPECTED_STOPS);
    });

    await test.step('Altura Mainstage on 4 Jan: a winner and a result line in every match', async () => {
      await openPromotionTab(page, RIVAL, 'Shows', phone);
      const show = airedRows(page)
        .filter({ hasText: RIVAL_SHOW })
        .filter({ hasText: RIVAL_SHOW_DAY });
      await expect(show).toHaveCount(1);
      await expand(show);
      const card = show.getByRole('list', { name: `${RIVAL_SHOW} card` });
      const matches = matchRows(card);
      const count = await matches.count();
      expect(count).toBeGreaterThan(0);
      for (let index = 0; index < count; index += 1) {
        const slot = matches.nth(index);
        const line = slot.locator('[data-part="rival-result"]');
        await expect(line).toBeVisible();
        const outcome = line.locator('[data-part="outcome"]');
        await expect(outcome).toHaveText(/ def\. |^Draw$/);
        if ((await outcome.textContent())?.trim() !== 'Draw') {
          await expect(slot.locator('[data-part="winner"]')).toHaveCount(1);
        }
        const details = line.locator('[data-part="details"]');
        await expect(details).toContainText(METHOD_NAMES);
        // With MTCH2: the finish sits next to the method.
        await expect(details).toContainText(FINISH_NAMES);
        await expect(line.getByRole('button', { name: /^Why this result\? / })).toBeVisible();
        // The line sits inside its slot card.
        await expectInside(line, slot.locator('article'));
      }
      await expect(show).not.toContainText(NO_TIMES);
      await expectNoHorizontalScroll(page);
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await expectNoSeriousA11yViolations(page);
      await matches.first().scrollIntoViewIfNeeded();
      await shot(page, 'mainstage-results', testInfo.project.name);
    });

    await test.step('a result’s Why? reads like a booker deciding who wins', async () => {
      const match = await findMatch(page, (matches) =>
        matches.filter({ hasNot: page.locator('[data-kind="title"]') }),
      );
      expect(match, 'an aired Altura show has a match with no title on the line').not.toBeNull();
      if (match === null) return;
      const why = match.getByRole('button', { name: /^Why this result\? / });
      await why.scrollIntoViewIfNeeded();
      const panel = await openWhy(page, why, /^Why this result\? /);
      await expect(panel).toContainText('Who wins');
      await expect(panel).toContainText('How the match ends');
      // Plain words for every choice: names and methods, never a code like side:0.
      await expect(panel).not.toContainText(/side:\d|method\.|finish\./);
      await expectBottomSheet(page, panel, phone);
      await expectNoHorizontalScroll(page);
      await shot(page, 'winner-why', testInfo.project.name);
      // A row cut by a phone sheet's fold reads to axe as text missing from its name.
      await panel.locator('[data-trace-path]').last().scrollIntoViewIfNeeded();
      await expectNoSeriousA11yViolations(page);
      await closeWhy(page, panel, why);
    });

    await test.step('a title match says Retained or New champion, and its Why? names the reign', async () => {
      const match = await findMatch(page, (matches) =>
        matches.filter({ has: page.locator('[data-kind="title"]') }),
      );
      expect(match, 'an aired Altura show defended a title').not.toBeNull();
      if (match === null) return;
      const titleRow = match.locator('[data-part="rival-result"] li[data-actual]').first();
      await titleRow.scrollIntoViewIfNeeded();
      await expect(titleRow).toContainText(/Retained|New champion/);
      const why = titleRow.getByRole('button', { name: /^Why (Retained|New champion)\? / });
      await expect(why).toBeVisible();
      // The badge keeps its Why? beside it, inside the slot card.
      const badge = titleRow.getByText(/^(Retained|New champion)$/);
      const badgeBox = await badge.boundingBox();
      const whyBox = await why.boundingBox();
      expect(
        Math.abs(
          (badgeBox?.y ?? 0) +
            (badgeBox?.height ?? 0) / 2 -
            ((whyBox?.y ?? 0) + (whyBox?.height ?? 0) / 2),
        ),
      ).toBeLessThan((whyBox?.height ?? 0) / 2);
      await expectInside(titleRow, match.locator('article'));

      const panel = await openWhy(page, why, /^Why (Retained|New champion)\? /);
      // The chance's own lines (reign band, prestige, taste, show) sit one level down.
      await panel.getByRole('button', { name: 'Expand all' }).click();
      await expect(panel).toContainText('Reign of');
      await expect(panel).toContainText('Change chance');
      await expect(panel).toContainText('Challengers');
      await expect(panel).toContainText(/Title taste \(style default\)|Booker's title taste/);
      await expectBottomSheet(page, panel, phone);
      await expectNoHorizontalScroll(page);
      await shot(page, 'title-why', testInfo.project.name);
      await panel.locator('[data-trace-path]').last().scrollIntoViewIfNeeded();
      await expectNoSeriousA11yViolations(page);
      await closeWhy(page, panel, why);
    });

    await test.step('Altura’s next show keeps its card hidden', async () => {
      const upcoming = page.getByRole('region', { name: 'Coming up' }).locator('article').first();
      await expect(upcoming).toHaveAttribute('data-revealed', 'false');
      await expand(upcoming);
      await expect(upcoming.getByText('Card is revealed when the show airs')).toBeVisible();
      await expect(upcoming.locator('[data-part="rival-result"]')).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });

    await test.step('the Overview has a Recent title changes panel', async () => {
      await openPromotionTab(page, RIVAL, 'Overview', phone);
      const heading = page.getByRole('heading', { level: 2, name: 'Recent title changes' });
      await heading.scrollIntoViewIfNeeded();
      await expect(heading).toBeVisible();
      const list = page.getByRole('list', { name: 'Recent title changes' });
      if ((await list.count()) > 0) {
        await expect(list.locator(':scope > li').first()).toContainText(/ won the /);
      } else {
        await expect(page.getByText('No title changes yet')).toBeVisible();
      }
      await expectNoHorizontalScroll(page);
      await shot(page, 'overview', testInfo.project.name);
    });

    await test.step('the Decision log filters by Winners and by Titles', async () => {
      await openPromotionTab(page, RIVAL, 'Decision log', phone);
      const chips = page.getByRole('group', { name: 'Show decisions of kind' });
      const entries = page.getByRole('list', { name: 'Decisions, newest first' });
      const winners = chips.getByRole('button', { name: 'Winners' });
      await winners.click();
      await expect(winners).toHaveAttribute('aria-pressed', 'true');
      await expect(entries.locator(':scope > li').first()).toHaveAttribute('data-kind', 'winner');
      await expect(entries.locator(':scope > li:not([data-kind="winner"])')).toHaveCount(0);

      const titles = chips.getByRole('button', { name: 'Titles' });
      await titles.click();
      await expect(titles).toHaveAttribute('aria-pressed', 'true');
      await expect(entries.locator(':scope > li').first()).toHaveAttribute('data-kind', 'title');
      await expect(entries.locator(':scope > li:not([data-kind="title"])')).toHaveCount(0);
      await expect(entries.locator(':scope > li').first()).toContainText(/ to (retain|win) the /);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await shot(page, 'decision-log-titles', testInfo.project.name);
    });
  });
});
