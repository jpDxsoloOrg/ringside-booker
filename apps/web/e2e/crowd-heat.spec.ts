/**
 * Ticket sales follow a hot card (EVT6-11), in a new default-world Sandbox game as Altura:
 *
 * 1. A starter storyline is set to heat 90 (Sandbox's Set heat).
 * 2. On the first show night, before anything is linked, Booking's "Venue and crowd" panel says
 *    there is no hot streak yet and no storyline on the card, in words.
 * 3. A match between the storyline's two people is linked to it as its finale: the panel's Show
 *    heat line names the storyline, its heat and the finale with what it adds, and the Expected
 *    crowd Why? has the Hot streak and Show heat lines.
 * 4. After the show, the results' Box office Attendance Why? has the same two lines (the
 *    expected crowd it starts from is the show-day forecast).
 *
 * Every page and open sheet fits the screen with no sideways scroll, on desktop and phone
 * (Chromium and WebKit).
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { pickWinnersAndRunShow } from './helpers/booking';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import {
  bookLinkedMatch,
  fillTheRest,
  openBooking,
  openStoryline,
  setHeat,
  skipToShowNight,
  starters,
} from './helpers/storylines';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';

/** Building the world, playing to show night and running the show take a while. */
const GAME_TIMEOUT_MS = 420_000;

/** The booking screen's "Venue and crowd" panel. */
function crowdPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Venue and crowd' });
}

/** Opens a Why? whose sheet is named `title`, checks it fits, and returns it open. */
async function openWhy(page: Page, button: Locator, title: RegExp): Promise<Locator> {
  await button.click();
  const panel = page.getByRole('dialog', { name: title });
  await expect(panel).toBeVisible();
  await expect(panel).not.toContainText(/undefined|NaN/);
  await expectNoHorizontalScroll(page);
  return panel;
}

test('a hot storyline finale on the card sells more tickets: forecast words, Why? and results', async ({
  page,
}, testInfo) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  const phone = isPhone(testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDefaultWorldGame(page, ALTURA, { phone, settings: { sandbox: true } });
  const candidates = await starters(page);
  expect(candidates.length, 'Altura starts with starter storylines').toBeGreaterThan(0);

  // Every starter runs hot, so whichever one the show can use is a hot card.
  for (const starter of candidates) {
    await openStoryline(page, starter.name);
    await setHeat(page, 90);
  }

  await skipToShowNight(page, phone);
  await openBooking(page);
  const panel = crowdPanel(page);
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel).toContainText('Hot streak');
  await expect(panel).toContainText('No hot streak: a show scoring 60 or better starts one');
  await expect(panel).toContainText('No storylines linked on the card');
  await expectNoHorizontalScroll(page);

  let linked: string | null = null;
  for (const starter of candidates) {
    const slot = await bookLinkedMatch(page, starter, { finale: true });
    if (slot !== null) {
      linked = starter.name;
      break;
    }
  }
  if (linked === null) throw new Error('No starter storyline could be booked on the first show');
  await expect(panel).toContainText(`${linked}: heat 90, finale tonight: +`);
  await expect(panel).toContainText('% crowd');
  await expectNoHorizontalScroll(page);

  const forecastWhy = await openWhy(
    page,
    panel.getByRole('button', { name: /^Why is Expected crowd/ }),
    /Expected crowd/,
  );
  await expect(forecastWhy).toContainText('Hot streak');
  await expect(forecastWhy).toContainText('Show heat');
  await page.keyboard.press('Escape');
  await expect(forecastWhy).toBeHidden();

  await fillTheRest(page);
  await pickWinnersAndRunShow(page, phone);

  // The results: the Box office Attendance Why? keeps both lines.
  const attendance = page.getByRole('button', { name: /^Why is Attendance at / }).first();
  await expect(attendance).toBeVisible({ timeout: 30_000 });
  const settledWhy = await openWhy(page, attendance, /Attendance/);
  await expect(settledWhy).toContainText('Hot streak');
  await expect(settledWhy).toContainText('Show heat');
  await page.keyboard.press('Escape');
  await expect(settledWhy).toBeHidden();
});
