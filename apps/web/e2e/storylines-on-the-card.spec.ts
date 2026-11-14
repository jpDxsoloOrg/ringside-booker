/**
 * The CRTV4 owner script end to end (CRTV4-07), in a new default-world Sandbox game as Altura:
 *
 * 1. Before the first show, a fresh storyline's End preview says it can't pay off yet.
 * 2. On the first show night, a match between one starter's two people is linked from its
 *    suggestion and made the finale; four more matches pair the two starters' people so each
 *    storyline has four linked segments; a talking segment with nobody from the story is linked
 *    too and is flagged "Won't count" in the editor and the checklist.
 * 3. After the show, the results' Storylines section has the finale's heat chip, whose Why? names
 *    the segment, and says the talking segment didn't count. The storyline's timeline has the
 *    steps and the finale hint.
 * 4. With Set heat, a hot story's End preview pays each member with a Why?, and ending it records
 *    the payoff; a cold one's preview and payoff are a drop.
 *
 * Every page and open sheet fits the screen with no sideways scroll and no serious axe findings,
 * on desktop and phone (Chromium and WebKit); on a phone the results and the storyline page also
 * fit at 150% UI scale.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { pickWinnersAndRunShow } from './helpers/booking';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import {
  bookMatch,
  editSlot,
  escapeRegExp,
  fillTheRest,
  firstOpenSlot,
  linkAnother,
  linkedList,
  linkSuggestion,
  openBooking,
  openStoryline,
  segmentEditor,
  setHeat,
  skipToShowNight,
  starters,
} from './helpers/storylines';
import type { Starter } from './helpers/storylines';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';

/** Building the world, booking six segments, running the show and two payoffs take a while. */
const GAME_TIMEOUT_MS = 900_000;

/** "Ashfall Rivalry 54 → 62": a heat chip's numbers. */
const HEAT_NUMBERS = /(\d+)\s*→\s*(?:to)?\s*(\d+)/;

/** Checks the page and whatever sheet is open: no sideways scroll, no serious axe findings. */
async function expectFits(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
}

/** Saves the editor and waits for it to close. */
async function save(editor: Locator): Promise<void> {
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
}

/** Opens the storyline's End sheet; returns it. */
async function openEndSheet(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'End storyline' }).click();
  const sheet = page.getByRole('dialog', { name: `End ${name}?` });
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * Books a match between one person of each storyline and links it to both from their "1 here"
 * suggestions, so it counts for both.
 */
async function bookSharedMatch(
  page: Page,
  people: readonly [string, string],
  stories: readonly [Starter, Starter],
): Promise<void> {
  const slot = await bookMatch(page, people);
  if (slot === null) throw new Error(`The show can't use ${people.join(' and ')}`);
  const editor = await editSlot(page, slot);
  await linkSuggestion(editor, stories[0].name, 1);
  await linkSuggestion(editor, stories[1].name, 1);
  await save(editor);
  await expect(slot.getByText(`Story: ${stories[0].name}`)).toBeVisible();
  await expect(slot.getByText(`Story: ${stories[1].name}`)).toBeVisible();
}

/**
 * Books a talking segment with a speaker from neither storyline and links it to `story` through
 * "Link another storyline". The linked row says it won't count. Returns the slot.
 */
async function bookUncountedTalk(
  page: Page,
  story: Starter,
  everyone: readonly string[],
): Promise<Locator> {
  const slot = await firstOpenSlot(page, 'Add talking segment');
  await slot.getByRole('button', { name: 'Add talking segment' }).click();
  let editor = segmentEditor(page);
  await editor.getByRole('button', { name: 'Add speaker' }).first().click();
  const roster = page.getByRole('dialog', { name: 'Add a speaker' });
  let options = roster.getByRole('option');
  for (const name of everyone) options = options.filter({ hasNotText: name });
  await expect(options.first()).toBeVisible();
  await options.first().click();
  if (await roster.isVisible()) await page.keyboard.press('Escape');
  await expect(roster).toBeHidden();
  await save(editor);

  editor = await editSlot(page, slot);
  await linkAnother(page, editor, story.name);
  const row = linkedList(editor).getByRole('listitem').filter({ hasText: story.name });
  await expect(row).toContainText("Won't count: nobody from this story is in the segment");
  await expectFits(page);
  await save(editor);
  return slot;
}

test('storylines on the card: link, heat on the results, timeline and both payoffs', async ({
  page,
}, testInfo) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  const phone = isPhone(testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDefaultWorldGame(page, ALTURA, { phone, settings: { sandbox: true } });
  const candidates = await starters(page);
  expect(candidates.length, 'Altura starts with two starter storylines').toBeGreaterThanOrEqual(2);
  const [hot, cold] = candidates;
  if (hot === undefined || cold === undefined) throw new Error('Altura needs two starters');

  // A fresh storyline can't pay off yet.
  await openStoryline(page, cold.name);
  let sheet = await openEndSheet(page, cold.name);
  await expect(sheet).toContainText('No payoff (needs 4 linked segments, has 0)');
  await expectFits(page);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();

  // The first show night: the finale, then four shared matches and an uncounted talk.
  await skipToShowNight(page, phone);
  await openBooking(page);
  const finaleSlot = await bookMatch(page, hot.people);
  if (finaleSlot === null) throw new Error(`The show can't use ${hot.people.join(' and ')}`);
  const editor = await editSlot(page, finaleSlot);
  await linkSuggestion(editor, hot.name, 2);
  const finale = linkedList(editor).getByRole('switch', { name: `Finale of ${hot.name}` });
  await finale.click();
  await expect(finale).toBeChecked();
  await expectFits(page);
  await save(editor);
  await expect(finaleSlot.getByText(`Story: ${hot.name}`)).toBeVisible();
  await expect(finaleSlot.getByText('Finale', { exact: true })).toBeVisible();

  const coldSlot = await bookMatch(page, cold.people);
  if (coldSlot === null) throw new Error(`The show can't use ${cold.people.join(' and ')}`);
  const coldEditor = await editSlot(page, coldSlot);
  await linkSuggestion(coldEditor, cold.name, 2);
  await save(coldEditor);
  const [h1, h2] = hot.people;
  const [c1, c2] = cold.people;
  await bookSharedMatch(page, [h1, c1], [hot, cold]);
  await bookSharedMatch(page, [h2, c2], [hot, cold]);
  await bookSharedMatch(page, [h1, c2], [hot, cold]);
  await bookUncountedTalk(page, hot, [h1, h2, c1, c2]);
  const warning = new RegExp(
    `linked to '${escapeRegExp(hot.name)}' but none of its members is in it`,
  );
  await expect(page.getByText(warning).first()).toBeVisible();

  await fillTheRest(page);
  await expectNoHorizontalScroll(page);
  await pickWinnersAndRunShow(page, phone);
  const resultsUrl = new URL(page.url()).pathname;

  // The results: the finale's heat chip with a Why? naming the segment; the talk didn't count.
  const section = page.getByRole('region', { name: 'Storylines', exact: true });
  await expect(section).toBeVisible({ timeout: 30_000 });
  const finaleChip = section
    .locator('li')
    .filter({ hasText: hot.name })
    .filter({ hasText: 'Finale' })
    .first();
  await expect(finaleChip).toBeVisible();
  const numbers = HEAT_NUMBERS.exec((await finaleChip.textContent()) ?? '');
  expect(numbers, 'the finale chip shows heat before → after').not.toBeNull();
  await expect(section).toContainText(`Not counted: nobody in this segment is in '${hot.name}'`);
  await expectFits(page);
  await finaleChip.getByRole('button', { name: /^Why is Heat after this segment/ }).click();
  const why = page.getByRole('dialog', { name: /Heat after this segment/ });
  await expect(why).toBeVisible();
  await expect(why).toContainText(/Heat after '(Opener|Main event|Slot \d+)'/);
  await expect(why).toContainText(`Storyline: ${hot.name}`);
  await expect(why).not.toContainText(/undefined|NaN/);
  await expectFits(page);
  await page.keyboard.press('Escape');
  await expect(why).toBeHidden();

  // The storyline's page: four counted steps, the finale's numbers and the finale hint.
  await openStoryline(page, hot.name);
  const timeline = page.getByRole('list', { name: 'Linked segments, newest first' });
  const counted = timeline
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: /^Why is Heat after this segment/ }) });
  await expect(counted).toHaveCount(4);
  await expect(
    counted.filter({ hasText: 'Finale' }).filter({
      hasText: new RegExp(`${numbers?.[1] ?? ''}\\s*→\\s*(?:to)?\\s*${numbers?.[2] ?? ''}`),
    }),
  ).toHaveCount(1);
  await expect(
    page.getByText(/^Finale played on .+: end the storyline to pay it off$/),
  ).toBeVisible();
  await expectFits(page);

  // A hot ending pays every member, each with a Why?.
  await setHeat(page, 85);
  sheet = await openEndSheet(page, hot.name);
  await expect(sheet).toContainText('Payoff strength');
  const members = sheet.getByRole('list', { name: 'Members' }).getByRole('listitem');
  await expect(members).toHaveCount(2);
  for (const person of hot.people) {
    const row = members.filter({ hasText: person });
    await expect(
      row.getByRole('button', {
        name: new RegExp(`^Why \\+\\d+ momentum for ${escapeRegExp(person)}\\?$`),
      }),
    ).toBeVisible();
    await expect(
      row.getByRole('button', { name: new RegExp(`^Why \\+?[\\d.]+ popularity for`) }),
    ).toBeVisible();
  }
  await expectFits(page);
  await members
    .first()
    .getByRole('button', { name: /^Why .+ popularity for / })
    .click();
  const memberWhy = page.getByRole('dialog', { name: /^Popularity for / });
  await expect(memberWhy).toBeVisible();
  await expect(memberWhy).toContainText('Payoff strength');
  await expect(memberWhy).toContainText('Paid off with a finale');
  await expectFits(page);
  await page.keyboard.press('Escape');
  await expect(memberWhy).toBeHidden();
  await sheet.getByRole('button', { name: 'End storyline' }).click();
  await expect(sheet).toBeHidden();
  const ending = page.getByRole('region', { name: 'Ending' });
  await expect(ending).toContainText('Payoff');
  await expect(ending.getByRole('button', { name: 'Why this payoff?' })).toBeVisible();
  await expect(ending).toContainText(/\+\d+/);
  await expectFits(page);

  // A cold ending is a real drop.
  await openStoryline(page, cold.name);
  await setHeat(page, 20);
  sheet = await openEndSheet(page, cold.name);
  const coldMembers = sheet.getByRole('list', { name: 'Members' }).getByRole('listitem');
  for (const person of cold.people) {
    await expect(
      coldMembers.filter({ hasText: person }).getByRole('button', {
        name: new RegExp(`^Why −\\d+ momentum for ${escapeRegExp(person)}\\?$`),
      }),
    ).toBeVisible();
  }
  await expectFits(page);
  await sheet.getByRole('button', { name: 'End storyline' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('region', { name: 'Ending' })).toContainText(/−\d+/);

  // On a phone the new sections still fit at 150% UI scale.
  if (phone) {
    await navigateInApp(page, '/settings');
    await page.getByRole('slider', { name: 'UI scale' }).fill('1.5');
    await expect(page.locator('output')).toHaveText('150%');
    await navigateInApp(page, resultsUrl);
    await expect(page.getByRole('region', { name: 'Storylines', exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await openStoryline(page, hot.name);
    await expect(page.getByRole('list', { name: 'Linked segments, newest first' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});
