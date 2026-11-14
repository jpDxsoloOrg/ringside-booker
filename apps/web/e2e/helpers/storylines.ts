/**
 * Storylines on the card (CRTV4): the desk's starter storylines, booking a storyline's people in a
 * match, linking a saved segment to a storyline from Booking's Storyline section, a storyline's
 * page, and a Sandbox game's Set heat. Shared by the CRTV4 specs.
 */
import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { autoFillCard, pickWinnersAndRunShow, skipDaysOnce } from './booking';
import { clearOtherStops } from './contracts';
import { navigateInApp } from './shell';

/** A starter storyline is named "<face> vs. <heel>". */
const STARTER_NAME = /^(.+) vs\. (.+)$/;

/** The segment editor sheet, named by its slot: "Slot 3 · Singles", "Pre-show slot 1 · …". */
export const SEGMENT_EDITOR_NAME = /^(Pre-show slot|Slot) \d+ · /;

/** A starter storyline from the desk and the two people its name gives. */
export interface Starter {
  readonly name: string;
  readonly people: readonly [string, string];
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The storylines on the desk whose names give their two people, in desk order. */
export async function starters(page: Page): Promise<Starter[]> {
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

/** Skips a week at a time (clearing injuries and notices) until the player's next show night. */
export async function skipToShowNight(page: Page, phone: boolean): Promise<void> {
  for (let round = 0; round < 10; round += 1) {
    if (await clearOtherStops(page)) return;
    await skipDaysOnce(page, 7, phone);
  }
  throw new Error('Never reached a show night');
}

/** The segment editor sheet. */
export function segmentEditor(page: Page): Locator {
  return page.getByRole('dialog', { name: SEGMENT_EDITOR_NAME });
}

/** Adds `name` to the editor's side through the roster picker; false when the show can't use them. */
export async function addWrestler(
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

/** The first open main-card slot that offers `button` ("Add match", "Add talking segment"). */
export async function firstOpenSlot(page: Page, button: string): Promise<Locator> {
  const open = page
    .locator('[id^="booking-slot-main-"]')
    .filter({ has: page.getByRole('button', { name: button }) })
    .first();
  const rowId = await open.getAttribute('id');
  if (rowId === null) throw new Error('The card has no open slot.');
  return page.locator(`[id="${rowId}"]`);
}

/** Closes the editor without saving, discarding the draft if it asks. */
async function discardEditor(page: Page, editor: Locator): Promise<void> {
  await editor.getByRole('button', { name: 'Cancel' }).click();
  const discard = page.getByRole('alertdialog');
  if (await discard.isVisible()) await discard.getByRole('button', { name: /Discard/ }).click();
  await expect(editor).toBeHidden();
}

/**
 * Books a match between `people` (one a side) in the first open main-card slot of the card on
 * screen and saves it. Returns the slot, or null when the show can't use one of them (the draft
 * is discarded).
 */
export async function bookMatch(
  page: Page,
  people: readonly [string, string],
): Promise<Locator | null> {
  const slot = await firstOpenSlot(page, 'Add match');
  await slot.getByRole('button', { name: 'Add match' }).click();
  const editor = segmentEditor(page);
  await expect(editor.getByRole('combobox', { name: /type/ })).toBeVisible();
  const both =
    (await addWrestler(page, editor, 0, people[0])) &&
    (await addWrestler(page, editor, 1, people[1]));
  if (!both) {
    await discardEditor(page, editor);
    return null;
  }
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect(slot).toContainText(people[0]);
  return slot;
}

/** Opens a booked slot's editor from its row menu (Actions ▸ Edit); returns the editor. */
export async function editSlot(page: Page, slot: Locator): Promise<Locator> {
  await slot.getByRole('button', { name: /^Actions for / }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const editor = segmentEditor(page);
  await expect(editor).toBeVisible();
  return editor;
}

/** The editor's Storyline section. */
export function storylineSection(editor: Locator): Locator {
  return editor.getByRole('region', { name: 'Storyline' });
}

/** The section's linked list. */
export function linkedList(editor: Locator): Locator {
  return storylineSection(editor).getByRole('list', { name: 'Linked storylines' });
}

/** Taps the suggestion chip for `name` ("Link <name>, N here, heat H") and waits for it to link. */
export async function linkSuggestion(editor: Locator, name: string, here: number): Promise<void> {
  const suggestion = storylineSection(editor)
    .getByRole('list', { name: 'Suggested storylines' })
    .getByRole('button', {
      name: new RegExp(`^Link ${escapeRegExp(name)}\\s?, ${String(here)} here`),
    });
  await suggestion.scrollIntoViewIfNeeded();
  await suggestion.click();
  await expect(linkedList(editor).getByText(name, { exact: true })).toBeVisible();
}

/** Links `name` through "Link another storyline" (a storyline with nobody in the segment). */
export async function linkAnother(page: Page, editor: Locator, name: string): Promise<void> {
  const select = storylineSection(editor).getByRole('combobox', {
    name: 'Link another storyline',
  });
  await select.scrollIntoViewIfNeeded();
  await select.click();
  await page.getByRole('option', { name: new RegExp(`^${escapeRegExp(name)} \\(heat`) }).click();
  await expect(linkedList(editor).getByText(name, { exact: true })).toBeVisible();
}

/**
 * Books `starter`'s two people in a match on the card on screen and links it to the storyline
 * from the suggestion ("2 here"), optionally as its finale. Returns the slot, or null when the
 * show can't use one of them.
 */
export async function bookLinkedMatch(
  page: Page,
  starter: Starter,
  options: { readonly finale?: boolean } = {},
): Promise<Locator | null> {
  const slot = await bookMatch(page, starter.people);
  if (slot === null) return null;
  // A segment links once it is saved: open it again.
  const editor = await editSlot(page, slot);
  await linkSuggestion(editor, starter.name, 2);
  if (options.finale === true) {
    const finale = linkedList(editor).getByRole('switch', { name: `Finale of ${starter.name}` });
    await finale.click();
    await expect(finale).toBeChecked();
  }
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect(slot.getByText(`Story: ${starter.name}`)).toBeVisible();
  return slot;
}

/** Opens a storyline's page from the desk. */
export async function openStoryline(page: Page, name: string): Promise<void> {
  await navigateInApp(page, '/game/storylines');
  await page.getByRole('main').getByRole('link', { name }).first().click();
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

/** A Sandbox game's Set heat on the storyline page on screen; waits for the page to show it. */
export async function setHeat(page: Page, heat: number): Promise<void> {
  const field = page.getByRole('textbox', { name: 'New heat' });
  await field.fill(String(heat));
  await page.getByRole('button', { name: 'Set heat' }).click();
  await expect(page.getByRole('button', { name: `Why is Heat ${String(heat)}?` })).toBeVisible();
}

/** Opens Booking for the card on screen's show (the next one) and waits for it. */
export async function openBooking(page: Page): Promise<void> {
  await navigateInApp(page, '/game/booking');
  await expect(page.locator('h1')).toHaveCount(1);
}

/** Auto-fills the card's empty slots and closes the reasons sheet. */
export async function fillTheRest(page: Page): Promise<void> {
  const fill = await autoFillCard(page);
  await fill.getByRole('button', { name: 'Done' }).click();
  await expect(fill).toBeHidden();
}

/**
 * Plays to the player's first show night and books it with a match linked to a storyline (the
 * first of `linkedMatch.from` whose people the show can use, as its finale when asked), fills the
 * rest of the card, picks the winners and runs the show (EVT2-09: there is no Lock card). Leaves
 * the page on the show's results and returns the storyline it linked.
 */
export async function bookAndRunFirstShow(
  page: Page,
  options: {
    readonly linkedMatch: { readonly from: readonly Starter[]; readonly finale?: boolean };
    readonly phone: boolean;
  },
): Promise<Starter> {
  await skipToShowNight(page, options.phone);
  await openBooking(page);
  for (const starter of options.linkedMatch.from) {
    const finale = options.linkedMatch.finale === true;
    const slot = await bookLinkedMatch(page, starter, { finale });
    if (slot === null) continue;
    await fillTheRest(page);
    await pickWinnersAndRunShow(page, options.phone);
    return starter;
  }
  throw new Error('No starter storyline could be booked on the first show.');
}
