/**
 * Beats in Booking (MTCH5-06), in a new default-world game as Altura: book a talking segment with
 * one speaker, give it a second beat in the segment editor's Beats section (the picker offers the
 * segment's own speakers), see the preview's angle score with its Why?, save, and find both beats
 * again when the segment is reopened. The open sheet fits with no sideways scroll and no serious
 * axe findings, on desktop and phone (Chromium and WebKit).
 *
 * MTCH5-07 adds the beat limit: a backstage angle in the opener (a short slot, as Altura's shows
 * have no pre-show) stops at 2 beats ("Short slot: up to 2 beats") and keeps them in order through
 * a reload, and a 5-beat main event angle moved up into a standard
 * slot shows the limit error in the checklist until it moves back.
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

const EDITOR_NAME = /^(Pre-show slot|Slot) \d+ · /;

/** Beat `n`'s row (1-based) in the Beats section. */
function beatRow(section: Locator, beatNumber: number): Locator {
  return section.locator('li').filter({
    has: section.page().getByRole('heading', { name: `Beat ${String(beatNumber)}`, exact: true }),
  });
}

async function openEditor(page: Page, slot: Locator): Promise<Locator> {
  await slot.getByRole('button', { name: /^Actions for / }).click();
  await page.getByRole('menuitem', { name: 'Edit' }).click();
  const editor = page.getByRole('dialog', { name: EDITOR_NAME });
  await expect(editor).toBeVisible();
  return editor;
}

test('a talking segment gets a second beat in Booking and keeps it after Save', async ({
  page,
}) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDefaultWorldGame(page, ALTURA);
  await navigateInApp(page, '/game/booking');
  await expect(page.locator('h1')).toHaveCount(1);

  // A new talking segment in the first open main-card slot, with one speaker.
  const open = page
    .locator('[id^="booking-slot-main-"]')
    .filter({ has: page.getByRole('button', { name: 'Add talking segment' }) })
    .first();
  const rowId = await open.getAttribute('id');
  if (rowId === null) throw new Error('The card has no open slot.');
  const slot = page.locator(`[id="${rowId}"]`);
  await slot.getByRole('button', { name: 'Add talking segment' }).click();
  let editor = page.getByRole('dialog', { name: EDITOR_NAME });
  await editor.getByRole('button', { name: 'Add speaker' }).first().click();
  const roster = page.getByRole('dialog', { name: 'Add a speaker' });
  const option = roster.getByRole('option').first();
  await expect(option).toBeVisible();
  await option.click();
  // The speaker picker stays open for more picks.
  if (await roster.isVisible()) await page.keyboard.press('Escape');
  await expect(roster).toBeHidden();

  // The Beats section starts from the type's default beat with the speaker in it.
  let section = editor.getByRole('region', { name: 'Beats' });
  const first = beatRow(section, 1);
  const chip = first.locator('li').first();
  await expect(chip).toBeVisible();
  const speaker = (await chip.innerText()).trim();
  expect(speaker.length).toBeGreaterThan(0);

  // A second beat, filled from the segment's own speakers.
  await section.getByRole('button', { name: 'Add beat' }).click();
  const second = beatRow(section, 2);
  await second
    .getByRole('button', { name: /^Add person to / })
    .first()
    .click();
  const picker = page.getByRole('dialog', { name: /^Add to / });
  await picker.getByRole('button', { name: speaker, exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(second).toContainText(speaker);

  // The preview: the angle score with its Why?.
  const preview = section.getByText(/^Preview: angle score \d+/);
  await expect(preview).toBeVisible();
  await expect(section.getByRole('button', { name: /^Why is Angle score \d+\?$/ })).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);

  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  await expect(slot).toContainText(speaker);

  // Reopened, the segment has both beats.
  editor = await openEditor(page, slot);
  section = editor.getByRole('region', { name: 'Beats' });
  await expect(beatRow(section, 2)).toContainText(speaker);
  await expectNoHorizontalScroll(page);
});

/** Books a talking segment in an open `slot` with its first offered speaker; returns the speaker. */
async function bookTalkingSegment(page: Page, slot: Locator): Promise<string> {
  await slot.getByRole('button', { name: 'Add talking segment' }).click();
  const editor = page.getByRole('dialog', { name: EDITOR_NAME });
  await expect(editor).toBeVisible();
  await editor.getByRole('button', { name: 'Add speaker' }).first().click();
  const roster = page.getByRole('dialog', { name: 'Add a speaker' });
  const option = roster.getByRole('option').first();
  await expect(option).toBeVisible();
  await option.click();
  if (await roster.isVisible()) await page.keyboard.press('Escape');
  await expect(roster).toBeHidden();
  const chip = beatRow(editor.getByRole('region', { name: 'Beats' }), 1)
    .locator('li')
    .first();
  await expect(chip).toBeVisible();
  return (await chip.innerText()).trim();
}

/** Adds a beat at the end of the Beats section, as `beatName` if given, with `speaker` in it. */
async function addBeat(
  page: Page,
  section: Locator,
  beatNumber: number,
  speaker: string,
  beatName?: string,
): Promise<void> {
  await section.getByRole('button', { name: 'Add beat' }).click();
  const row = beatRow(section, beatNumber);
  await expect(row).toBeVisible();
  if (beatName !== undefined) {
    await section.getByRole('combobox', { name: `Beat ${String(beatNumber)}: which beat` }).click();
    await page.getByRole('option', { name: beatName, exact: true }).click();
    await expect(page.getByRole('listbox')).toBeHidden();
  }
  await row
    .getByRole('button', { name: /^Add person to / })
    .first()
    .click();
  const picker = page.getByRole('dialog', { name: /^Add to / });
  await picker.getByRole('button', { name: speaker, exact: true }).click();
  await expect(picker).toBeHidden();
  await expect(row).toContainText(speaker);
}

/** The checklist's words: the side panel on desktop, the problems sheet on a phone. */
async function checklistText(page: Page, phone: boolean): Promise<string> {
  if (!phone) {
    const checklist = page.getByRole('region', { name: 'Checklist' });
    await expect(checklist.getByRole('status')).toHaveCount(0);
    return (await checklist.textContent()) ?? '';
  }
  await page.getByRole('button', { name: /^(No problems|\d+ problems?)$/ }).click();
  const sheet = page.getByRole('dialog', { name: /^(No problems|\d+ problems?)$/ });
  await expect(sheet).toBeVisible();
  const text = (await sheet.textContent()) ?? '';
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  return text;
}

/** A main-card slot's row id; `index` 0 is the opener. */
function slotRowIdOf(index: number): string {
  return `booking-slot-main-${String(index)}`;
}

/** The beat-limit error the checklist shows for a standard slot holding 5 beats. */
const STANDARD_LIMIT_ERROR = /standard slot, up to 4 beats\. Remove a beat or move this angle\./;

test('the beat limit follows the slot: 2 backstage in the opener, an error when 5 beats move up from the main event', async ({
  page,
}, testInfo) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  const phone = isPhone(testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDefaultWorldGame(page, ALTURA);
  await navigateInApp(page, '/game/booking');
  await expect(page.locator('h1')).toHaveCount(1);

  // A backstage angle in the opener is short (one class below the slot's Standard): Promo, then
  // Celebration, and Add beat stops at 2.
  const openerId = slotRowIdOf(0);
  const opener = page.locator(`[id="${openerId}"]`);
  await expect(opener.getByRole('button', { name: 'Add talking segment' })).toBeVisible();
  const speaker = await bookTalkingSegment(page, opener);
  let editor = page.getByRole('dialog', { name: EDITOR_NAME });
  await editor.getByRole('radio', { name: 'Backstage' }).click();
  let section = editor.getByRole('region', { name: 'Beats' });
  await addBeat(page, section, 2, speaker, 'Celebration');
  await expect(
    section.getByRole('status').filter({ hasText: 'Short slot: up to 2 beats' }),
  ).toBeVisible();
  await expect(section.getByRole('button', { name: 'Add beat' })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();

  // Main menu saves and leaves; after a reload, Continue brings the game back with the beats in order.
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page.getByRole('dialog', { name: 'Menu' }).getByTestId('main-menu').click();
  } else {
    await page.getByTestId('main-menu').click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  await navigateInApp(page, '/game/booking');
  editor = await openEditor(page, page.locator(`[id="${openerId}"]`));
  section = editor.getByRole('region', { name: 'Beats' });
  await expect(section.getByRole('combobox', { name: 'Beat 1: which beat' })).toHaveText(/Promo/);
  await expect(section.getByRole('combobox', { name: 'Beat 2: which beat' })).toHaveText(
    /Celebration/,
  );
  await expect(beatRow(section, 2)).toContainText(speaker);
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();

  // A 5-beat angle in the main event (long: up to 6) is fine...
  const mainSlots = page.locator('[id^="booking-slot-main-"]');
  const mainEventId = await mainSlots.last().getAttribute('id');
  if (mainEventId === null) throw new Error('The card has no main event slot.');
  const mainEvent = page.locator(`[id="${mainEventId}"]`);
  const headliner = await bookTalkingSegment(page, mainEvent);
  editor = page.getByRole('dialog', { name: EDITOR_NAME });
  section = editor.getByRole('region', { name: 'Beats' });
  await expect(section.getByText('Long slot: up to 6 beats')).toBeAttached();
  for (let beatNumber = 2; beatNumber <= 5; beatNumber += 1) {
    await addBeat(page, section, beatNumber, headliner);
  }
  await editor.getByRole('button', { name: 'Save' }).click();
  await expect(editor).toBeHidden();
  expect(await checklistText(page, phone)).not.toMatch(STANDARD_LIMIT_ERROR);

  // ...moved up into the standard semi-main it breaks the limit, and moved back it is fine again.
  const moveUp = phone ? mainEvent.getByRole('button', { name: /^Move .+ up$/ }) : null;
  if (moveUp === null) {
    await mainEvent.getByRole('button', { name: /^Actions for / }).click();
    await page.getByRole('menuitem', { name: 'Move up' }).click();
  } else {
    await moveUp.click();
  }
  await expect(mainEvent).not.toContainText(headliner);
  await expect.poll(async () => checklistText(page, phone)).toMatch(STANDARD_LIMIT_ERROR);
  await expectNoHorizontalScroll(page);

  const semiMain = mainSlots.nth((await mainSlots.count()) - 2);
  if (phone) {
    await semiMain.getByRole('button', { name: /^Move .+ down$/ }).click();
  } else {
    await semiMain.getByRole('button', { name: /^Actions for / }).click();
    await page.getByRole('menuitem', { name: 'Move down' }).click();
  }
  await expect(mainEvent).toContainText(headliner);
  await expect.poll(async () => checklistText(page, phone)).not.toMatch(STANDARD_LIMIT_ERROR);
});
