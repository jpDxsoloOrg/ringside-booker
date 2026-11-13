/**
 * AIP4 end to end, the owner's script on a fresh default-world game as Longleaf (AIP4-09), on
 * desktop, phone and iPhone WebKit:
 *
 * - Promotions > Tessen > Shows: Tessen Iron Hour on Sat 9 Jan is under Coming up and keeps its
 *   card hidden until it airs.
 * - A 7-day skip stops on 9 Jan for Longleaf Saturday Night (the show-day gate, never switched
 *   off). Booking > Auto-fill empty slots books the card and lists why, slot by slot, with a Why?
 *   that reads like a booker's notes; no match gets a winner, so the checklist's "Every match has
 *   a result" line fails.
 * - Removing one segment and pressing Auto-fill again refills only that slot.
 * - Winners picked, Run the show (there is no Lock card), Next day: Tessen's 9 Jan card is under
 *   Recent shows, six slots from Opener to Main event, the main event a match, nobody in two
 *   matches, and its Why? (and the card's) open on readable lines.
 *
 * On a phone the slots stack, the Auto-fill panel sits under the card, the reasons sheet fills the
 * screen and nothing scrolls sideways; axe passes on the Shows tab, an open card, the reasons sheet
 * and an open Why?. Nothing on these screens is a length or a time.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { autoFillCard, pickWinnersAndRunShow, skipDaysOnce } from './helpers/booking';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { openPromotionTab } from './helpers/promotions';
import { isPhone } from './helpers/viewport';

const PLAYER = 'Longleaf Championship Wrestling';
const RIVAL = 'Tessen Pro Wrestling';
const RIVAL_SHOW = 'Tessen Iron Hour';
const MY_SHOW = 'Longleaf Saturday Night';
/** Both shows are on the first Saturday, five days after the game starts on Mon 4 Jan 2027. */
const SHOW_DAY = 'Sat 9 Jan';
const DAYS_TO_SHOW = 5;
const ROLES = ['Opener', 'Midcard', 'Midcard', 'Midcard', 'Semi-main', 'Main event'];
/** A show's disclosure button: any button in its header that is not a Why?. */
const SHOW_TOGGLE = /^(?!Why)/;
const NO_TIMES = /minute/i;

/** One show's row on the Shows tab, by its name and date. */
function showRow(section: Locator, name: string): Locator {
  return section.locator('article').filter({ hasText: name }).filter({ hasText: SHOW_DAY });
}

async function expand(row: Locator): Promise<void> {
  const toggle = row.getByRole('button', { name: SHOW_TOGGLE }).first();
  await toggle.click();
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

/** The checklist's "Every match has a result" line: in the side column, or the phone's sheet. */
async function expectResultsLine(page: Page, phone: boolean, state: 'error' | 'passed') {
  const line = (scope: Locator) =>
    scope.locator('li[data-state]').filter({ hasText: 'Every match has a result' });
  if (!phone) {
    await expect(
      line(page.getByRole('complementary', { name: 'Checks and panels' })),
    ).toHaveAttribute('data-state', state);
    return;
  }
  await page.getByRole('button', { name: /^(\d+ problems?|No problems)$/ }).click();
  const sheet = page.getByRole('dialog', { name: /^(\d+ problems?|No problems)$/ });
  await expect(line(sheet)).toHaveAttribute('data-state', state);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
}

/** The booking card's slots, in running order. */
function bookingSlots(page: Page): Locator {
  return page.getByRole('main').locator('article[data-state]');
}

async function slotTexts(page: Page): Promise<string[]> {
  return bookingSlots(page).evaluateAll((slots) => slots.map((slot) => slot.textContent));
}

/** The people in each match row of a rival card: a team's members, or the side's name. */
async function peopleInMatches(card: Locator): Promise<string[][]> {
  return card.locator('li[data-segment-kind="match"]').evaluateAll((rows) =>
    rows.map((row) =>
      Array.from(row.querySelectorAll('[data-side]')).flatMap((side) => {
        const detail = side.querySelector('[data-part="side-detail"]')?.textContent ?? null;
        const name = side.querySelector('[data-part="side-name"]')?.textContent ?? '';
        return detail === null ? [name] : detail.split(' & ');
      }),
    ),
  );
}

test.describe('rival cards and Auto-fill on a new game', () => {
  test('Tessen’s first card stays hidden, Auto-fill books yours, and the aired card explains itself', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PLAYER, { phone });

    await test.step('Tessen Iron Hour is coming up, its card hidden', async () => {
      await openPromotionTab(page, RIVAL, 'Shows', phone);
      const recent = page.getByRole('region', { name: 'Recent shows' });
      await expect(recent).toContainText('No shows yet.');
      const next = showRow(page.getByRole('region', { name: 'Coming up' }), RIVAL_SHOW);
      await expect(next).toHaveAttribute('data-revealed', 'false');
      await expect(page.getByRole('tabpanel')).not.toContainText(NO_TIMES);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await expand(next);
      await expect(next.getByText('Card is revealed when the show airs')).toBeVisible();
      await expect(next.getByRole('list')).toHaveCount(0);
      await expect(next.getByRole('button', { name: /^Why/ })).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });

    await test.step('a 7-day skip stops on 9 Jan for the player’s show', async () => {
      expect(await skipDaysOnce(page, 7, phone)).toBe(DAYS_TO_SHOW);
      const summary = page.getByRole('region', { name: 'Last advance' });
      await expect(summary).toContainText(`Your show '${MY_SHOW}'`);
      await expect(summary).toContainText('has no card yet');
      await expectNoHorizontalScroll(page);
      await summary.getByRole('link', { name: 'Go to the show' }).click();
      await expect(page).toHaveURL(/\/game\/booking/);
      await expect(page.getByRole('main')).toContainText(MY_SHOW);
    });

    await test.step('Auto-fill books the card and says why, without a winner', async () => {
      const sheet = await autoFillCard(page);
      await expect(sheet).toHaveAccessibleName('Filled 6 slots');
      await expect(sheet.getByRole('button', { name: /^Why this segment\? Slot / })).toHaveCount(6);
      await expect(sheet).toContainText('Slot 6 · Main event');
      await expect(sheet).toContainText('Strongest match closes the show');
      await expect(sheet).toContainText('Pick a winner for each match before you run the show.');
      await expect(sheet).not.toContainText(NO_TIMES);
      await expectNoHorizontalScroll(page);
      if (phone) {
        const box = await sheet.boundingBox();
        const viewport = page.viewportSize();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual((viewport?.height ?? 0) * 0.95);
      }
      await expectNoSeriousA11yViolations(page);

      const mainWhy = sheet.getByRole('button', { name: 'Why this segment? Slot 6 · Main event' });
      const panel = await openWhy(page, mainWhy, /^Why this segment\? /);
      await expect(panel).toContainText('Strongest match closes the show');
      await expect(panel).toContainText('Card score');
      await expectNoSeriousA11yViolations(page);
      await closeWhy(page, panel, mainWhy);

      await sheet.getByRole('button', { name: 'Done' }).click();
      await expect(sheet).toBeHidden();
      // Focus goes back to the panel: Rebook, now that Auto-fill is off on a full card.
      await expect(
        page.getByRole('region', { name: 'Auto-fill' }).getByRole('button', {
          name: 'Rebook whole card',
        }),
      ).toBeFocused();

      await expect(bookingSlots(page)).toHaveCount(6);
      await expect(page.getByRole('main').locator('article[data-state="empty"]')).toHaveCount(0);
      await expect(page.getByRole('main').locator('[data-part="winner"]')).toHaveCount(0);
      await expectResultsLine(page, phone, 'error');
      if (phone) {
        // The Auto-fill panel sits under the card.
        const lastSlot = await bookingSlots(page).last().boundingBox();
        const autoFill = await page.getByRole('region', { name: 'Auto-fill' }).boundingBox();
        expect(autoFill?.y ?? 0).toBeGreaterThan((lastSlot?.y ?? 0) + (lastSlot?.height ?? 0) - 1);
      }
      await expectNoHorizontalScroll(page);
    });

    await test.step('removing one segment and pressing Auto-fill again refills only that slot', async () => {
      const before = await slotTexts(page);
      await page.getByRole('button', { name: 'Actions for slot 2' }).click();
      await page.getByRole('menuitem', { name: 'Remove' }).click();
      const confirm = page
        .getByRole('alertdialog')
        .or(page.getByRole('dialog', { name: /^Remove / }));
      await confirm.getByRole('button', { name: 'Remove', exact: true }).click();
      await expect(page.getByRole('main').locator('article[data-state="empty"]')).toHaveCount(1);

      const sheet = await autoFillCard(page);
      await expect(sheet).toHaveAccessibleName('Filled 1 slot');
      await expect(sheet).toContainText('Slot 2 · Midcard');
      await expect(sheet).toContainText('5 segments you had booked stayed as they were.');
      await sheet.getByRole('button', { name: 'Done' }).click();
      await expect(sheet).toBeHidden();

      await expect(page.getByRole('main').locator('article[data-state="empty"]')).toHaveCount(0);
      const after = await slotTexts(page);
      expect(after).toHaveLength(before.length);
      after.forEach((text, index) => {
        if (index !== 1) expect(text, `slot ${String(index + 1)} is unchanged`).toBe(before[index]);
      });
      await expectNoHorizontalScroll(page);
    });

    await test.step('winners picked, the show runs, and the day moves on', async () => {
      await pickWinnersAndRunShow(page);
      await expect(page.getByRole('heading', { level: 1 })).toContainText(MY_SHOW);
      expect(await skipDaysOnce(page, 1, phone)).toBe(1);
      await expectNoHorizontalScroll(page);
    });

    await test.step('Tessen’s aired card: six slots, a match on top, nobody twice', async () => {
      await openPromotionTab(page, RIVAL, 'Shows', phone);
      const aired = showRow(page.getByRole('region', { name: 'Recent shows' }), RIVAL_SHOW);
      await expect(aired).toHaveAttribute('data-revealed', 'true');
      await expand(aired);
      const card = aired.getByRole('list', { name: `${RIVAL_SHOW} card` });
      const slots = card.locator(':scope > li');
      await expect(slots).toHaveCount(ROLES.length);
      for (const [index, role] of ROLES.entries()) {
        await expect(
          slots.nth(index).getByRole('heading', { name: `Slot ${String(index + 1)}: ${role}` }),
        ).toBeVisible();
      }
      const mainEvent = slots.last();
      await expect(mainEvent).toHaveAttribute('data-segment-kind', 'match');
      const people = (await peopleInMatches(card)).flat();
      expect(people.length).toBeGreaterThan(0);
      expect(new Set(people).size, `nobody in two matches: ${people.join(', ')}`).toBe(
        people.length,
      );
      await expect(aired).not.toContainText(NO_TIMES);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);

      const mainWhy = mainEvent.getByRole('button', {
        name: 'Why this segment? Slot 6, Main event',
      });
      const panel = await openWhy(page, mainWhy, /^Why this segment\? /);
      await expect(panel).toContainText('Strongest match closes the show');
      if ((await mainEvent.locator('[data-kind="title"]').count()) > 0) {
        await expect(panel).toContainText('since the last defence');
        await expect(panel).toContainText(/Challenger: #\d+ .+, card value \d+/);
      }
      await expectNoSeriousA11yViolations(page);
      await closeWhy(page, panel, mainWhy);

      const cardWhy = aired.getByRole('button', { name: /^Why this card\? / });
      const plan = await openWhy(page, cardWhy, /^Why this card\? /);
      await expect(plan).toContainText(/\d+ wrestlers fit to work, \d+ needed/);
      await expect(plan).toContainText('talking share');
      await closeWhy(page, plan, cardWhy);

      // Next week's show is still hidden.
      const upcoming = page
        .getByRole('region', { name: 'Coming up' })
        .locator('article')
        .filter({ hasText: RIVAL_SHOW })
        .first();
      await expect(upcoming).toHaveAttribute('data-revealed', 'false');
      await expectNoHorizontalScroll(page);
    });
  });
});
