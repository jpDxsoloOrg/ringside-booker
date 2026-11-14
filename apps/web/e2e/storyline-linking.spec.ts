/**
 * Linking a segment to a storyline from Booking (CRTV4-04), in a new default-world game as
 * Altura: book a singles match between a starter storyline's two people, open the match again,
 * tap the storyline's suggestion in the Storyline section, make the match its finale and save.
 * The card's slot then shows "Story: <name>" and "Finale". The open sheet fits the screen with no
 * sideways scroll and no serious axe findings, on desktop and phone (Chromium and WebKit).
 */
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import {
  bookMatch,
  editSlot,
  linkedList,
  linkSuggestion,
  openBooking,
  starters,
} from './helpers/storylines';
import type { Starter } from './helpers/storylines';
import { isPhone } from './helpers/viewport';
import type { Locator } from '@playwright/test';

const ALTURA = 'Altura Wrestling Entertainment';

/** Building the default world and starting the game takes a while on a loaded machine. */
const GAME_TIMEOUT_MS = 300_000;

test('a match links to a storyline from Booking and shows its Story and Finale chips', async ({
  page,
}, testInfo) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  const phone = isPhone(testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDefaultWorldGame(page, ALTURA);
  const candidates = await starters(page);
  expect(candidates.length, 'Altura starts with starter storylines').toBeGreaterThan(0);

  await openBooking(page);

  // Book the first starter whose two people this show can use, in the first open slot.
  let booked: { readonly starter: Starter; readonly slot: Locator } | null = null;
  for (const starter of candidates) {
    const slot = await bookMatch(page, starter.people);
    if (slot === null) continue;
    booked = { starter, slot };
    break;
  }
  if (booked === null) throw new Error('No starter storyline could be booked on the first show.');
  const { starter, slot } = booked;

  // Open the match again: the Storyline section suggests the starter.
  const editor = await editSlot(page, slot);
  await linkSuggestion(editor, starter.name, 2);
  const linked = linkedList(editor);
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
