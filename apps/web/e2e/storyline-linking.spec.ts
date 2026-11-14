/**
 * Linking a segment to a storyline from Booking (CRTV4-04), in a new default-world game as
 * Altura: book a singles match between a starter storyline's two people, open the match again,
 * tap the storyline's suggestion in the Storyline section, make the match its finale and save.
 * The card's slot then shows "Story: <name>" and "Finale". The open sheet fits the screen with no
 * sideways scroll and no serious axe findings, on desktop and phone (Chromium and WebKit).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';

/** Building the default world and starting the game takes a while on a loaded machine. */
const GAME_TIMEOUT_MS = 300_000;

/** A starter storyline is named "<face> vs. <heel>". */
const STARTER_NAME = /^(.+) vs\. (.+)$/;

interface Starter {
  readonly name: string;
  readonly people: readonly [string, string];
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

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

test('a match links to a storyline from Booking and shows its Story and Finale chips', async ({
  page,
}, testInfo) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  const phone = isPhone(testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDefaultWorldGame(page, ALTURA);
  const candidates = await starters(page);
  expect(candidates.length, 'Altura starts with starter storylines').toBeGreaterThan(0);

  await navigateInApp(page, '/game/booking');
  await expect(page.locator('h1')).toHaveCount(1);

  // Book the first starter whose two people this show can use, in the first open slot.
  let booked: { readonly starter: Starter; readonly slot: Locator } | null = null;
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
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toBeHidden();
    booked = { starter, slot };
    break;
  }
  if (booked === null) throw new Error('No starter storyline could be booked on the first show.');
  const { starter, slot } = booked;
  await expect(slot).toContainText(starter.people[0]);

  // Open the match again: the Storyline section suggests the starter.
  await slot.getByRole('button', { name: /^Actions for / }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: /^(Pre-show slot|Slot) \d+ · / });
  const section = editor.getByRole('region', { name: 'Storyline' });
  const suggestion = section
    .getByRole('list', { name: 'Suggested storylines' })
    .getByRole('button', { name: new RegExp(`^Link ${escapeRegExp(starter.name)}\\s?, 2 here`) });
  await suggestion.scrollIntoViewIfNeeded();
  await suggestion.click();

  const linked = section.getByRole('list', { name: 'Linked storylines' });
  await expect(linked.getByText(starter.name, { exact: true })).toBeVisible();
  const finale = linked.getByRole('switch', { name: `Finale of ${starter.name}` });
  await finale.click();
  await expect(finale).toBeChecked();
  if (phone) {
    const unlink = linked.getByRole('button', { name: `Unlink ${starter.name}` });
    const box = await unlink.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);

  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect(slot.getByText(`Story: ${starter.name}`)).toBeVisible();
  await expect(slot.getByText('Finale', { exact: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
