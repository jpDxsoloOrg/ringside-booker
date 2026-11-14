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
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { bookAndRunFirstShow, starters } from './helpers/storylines';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';

/** Building the default world, playing to show night and running the show take a while. */
const GAME_TIMEOUT_MS = 420_000;

/** "Ashfall Rivalry 54 → 62": a heat chip's numbers. */
const HEAT_NUMBERS = /(\d+)\s*→\s*(?:to)?\s*(\d+)/;

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

  const starter = await bookAndRunFirstShow(page, { linkedMatch: { from: candidates }, phone });

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
