/**
 * Storyline heat and payoff on screen (CRTV4-05), in a new default-world game as Altura: skip to
 * the first show night, book a singles match between a starter storyline's two people and link it
 * to the storyline from Booking's Storyline section (CRTV4-04), fill the rest of the card, pick the
 * winners and run the show. The results page's Storylines section shows the heat chip, and its
 * Why? names the segment; the storyline's timeline shows the same step; End opens the payoff
 * preview, which says the story is too short to pay off, and is cancelled. No sideways scroll on
 * any page or with any sheet open, on desktop and phone (Chromium and WebKit).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { autoFillCard, pickWinnersAndRunShow, skipDaysOnce } from './helpers/booking';
import { clearOtherStops } from './helpers/contracts';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';

/** Building the default world, playing to show night and running the show take a while. */
const GAME_TIMEOUT_MS = 420_000;

/** A starter storyline is named "<face> vs. <heel>". */
const STARTER_NAME = /^(.+) vs\. (.+)$/;

/** "Ashfall Rivalry 54 → 62": a heat chip's numbers. */
const HEAT_NUMBERS = /(\d+)\s*→\s*(?:to)?\s*(\d+)/;

interface Starter {
  readonly name: string;
  readonly people: readonly [string, string];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The storylines on the desk whose names give their two people, in desk order. */
async function starters(page: Page): Promise<Starter[]> {
  await navigateInApp(page, '/game/storylines');
  await expect(page.locator('h1')).toHaveText('Storylines');
  const cards = page.getByRole('main').getByRole('article');
  await expect(cards.first()).toBeVisible();
  const found: Starter[] = [];
  for (const heading of await cards.getByRole('heading').allTextContents()) {
    const name = heading.trim();
    const match = STARTER_NAME.exec(name);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      found.push({ name, people: [match[1], match[2]] });
    }
  }
  return found;
}

/** Adds `name` to the editor's side through the roster picker; false when the show can't use them. */
async function addWrestler(
  page: Page,
  editor: Locator,
  index: number,
  name: string,
): Promise<boolean> {
  await editor.getByRole('button', { name: 'Add wrestler' }).nth(index).click();
  const picker = page.getByRole('dialog', { name: /^Add to Side \d+$/ });
  await picker.getByRole('combobox', { name: 'Search by name' }).fill(name);
  const option = picker.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)}`) });
  try {
    await expect(option.first()).toBeVisible({ timeout: 5_000 });
  } catch {
    await page.keyboard.press('Escape');
    await expect(picker).toBeHidden();
    return false;
  }
  await option.first().click();
  await expect(picker).toBeHidden();
  return true;
}

/** Skips day by day (clearing injuries and notices) until the player's first show night. */
async function skipToShowNight(page: Page, phone: boolean): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    if (await clearOtherStops(page)) return;
    await skipDaysOnce(page, 7, phone);
  }
  throw new Error('Never reached a show night');
}

/** Books one starter's two people in a match on tonight's card and links it; returns the starter. */
async function bookLinkedMatch(page: Page, candidates: readonly Starter[]): Promise<Starter> {
  await navigateInApp(page, '/game/booking');
  await expect(page.locator('h1')).toHaveCount(1);
  for (const starter of candidates) {
    const open = page
      .locator('[id^="booking-slot-main-"]')
      .filter({ has: page.getByRole('button', { name: 'Add match' }) })
      .first();
    const rowId = await open.getAttribute('id');
    if (rowId === null) throw new Error('The card has no open slot.');
    const slot = page.locator(`[id="${rowId}"]`);
    await slot.getByRole('button', { name: 'Add match' }).click();
    const editor = page.getByRole('dialog', { name: /^(Pre-show slot|Slot) \d+ · / });
    await expect(editor.getByRole('combobox', { name: /type/ })).toBeVisible();
    const both =
      (await addWrestler(page, editor, 0, starter.people[0])) &&
      (await addWrestler(page, editor, 1, starter.people[1]));
    if (!both) {
      await editor.getByRole('button', { name: 'Cancel' }).click();
      const discard = page.getByRole('alertdialog');
      if (await discard.isVisible()) await discard.getByRole('button', { name: /Discard/ }).click();
      await expect(editor).toBeHidden();
      continue;
    }
    // A segment links once it is saved: save it, then open it again.
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();
    await slot.getByRole('button', { name: /^Actions for / }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await expect(editor).toBeVisible();
    const section = editor.getByRole('region', { name: 'Storyline' });
    const suggestion = section
      .getByRole('list', { name: 'Suggested storylines' })
      .getByRole('button', { name: new RegExp(`^Link ${escapeRegExp(starter.name)}\\s?, 2 here`) });
    await suggestion.scrollIntoViewIfNeeded();
    await suggestion.click();
    await expect(
      section.getByRole('list', { name: 'Linked storylines' }).getByText(starter.name, {
        exact: true,
      }),
    ).toBeVisible();
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();
    await expect(slot.getByText(`Story: ${starter.name}`)).toBeVisible();
    return starter;
  }
  throw new Error('No starter storyline could be booked on the first show.');
}

/** Opens a Why?, checks the sheet fits the screen, and returns it open. */
async function openWhy(page: Page, button: Locator): Promise<Locator> {
  await button.click();
  const panel = page.getByRole('dialog', { name: /Heat after this segment/ });
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText(/undefined|NaN/);
  await expectNoHorizontalScroll(page);
  return panel;
}

test('a linked match moves the storyline: results chip, timeline row and the payoff preview', async ({
  page,
}, testInfo) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  const phone = isPhone(testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDefaultWorldGame(page, ALTURA, { phone });
  const candidates = await starters(page);
  expect(candidates.length, 'Altura starts with starter storylines').toBeGreaterThan(0);

  await skipToShowNight(page, phone);
  const starter = await bookLinkedMatch(page, candidates);
  const fill = await autoFillCard(page);
  await fill.getByRole('button', { name: 'Done' }).click();
  await expect(fill).toBeHidden();
  await pickWinnersAndRunShow(page, phone);

  // The results page: the Storylines section has the starter's heat chip with its Why?.
  const section = page.getByRole('region', { name: 'Storylines', exact: true });
  await expect(section).toBeVisible({ timeout: 30_000 });
  const chip = section.locator('li').filter({ hasText: starter.name }).first();
  await expect(chip).toBeVisible();
  const chipText = (await chip.textContent()) ?? '';
  const numbers = HEAT_NUMBERS.exec(chipText);
  expect(numbers, `heat numbers in "${chipText}"`).not.toBeNull();
  await expectNoHorizontalScroll(page);
  const why = chip.getByRole('button', { name: /^Why is Heat after this segment/ });
  const panel = await openWhy(page, why);
  await expect(panel).toContainText(/Heat after '/);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();

  // The storyline page: the timeline's newest row is the same step.
  await navigateInApp(page, '/game/storylines');
  await page.getByRole('main').getByRole('link', { name: starter.name }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: starter.name })).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Linked segments, newest first' });
  const counted = timeline
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Why is Heat after this segment/ }) });
  await expect(counted.first()).toBeVisible();
  await expect(counted.first()).toContainText(
    new RegExp(`${numbers?.[1] ?? ''}\\s*→\\s*(?:to)?\\s*${numbers?.[2] ?? ''}`),
  );
  await expectNoHorizontalScroll(page);
  const countedSteps = await counted.count();

  // End: the preview says the story is too short to pay off; cancel leaves it running.
  await page.getByRole('button', { name: 'End storyline' }).click();
  const sheet = page.getByRole('dialog', { name: `End ${starter.name}?` });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText(
    `No payoff (needs 4 linked segments, has ${String(countedSteps)})`,
  );
  await expectNoHorizontalScroll(page);
  if (phone) {
    const cancel = sheet.getByRole('button', { name: 'Cancel' });
    expect((await cancel.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('button', { name: 'End storyline' })).toBeVisible();
});
