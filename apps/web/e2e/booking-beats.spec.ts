/**
 * Beats in Booking (MTCH5-06), in a new default-world game as Altura: book a talking segment with
 * one speaker, give it a second beat in the segment editor's Beats section (the picker offers the
 * segment's own speakers), see the preview's angle score with its Why?, save, and find both beats
 * again when the segment is reopened. The open sheet fits with no sideways scroll and no serious
 * axe findings, on desktop and phone (Chromium and WebKit). MTCH5-07's end-to-end run can take
 * these steps over.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';

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
