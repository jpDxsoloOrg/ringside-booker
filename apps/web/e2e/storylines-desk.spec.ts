/**
 * The Storylines desk end to end (CRTV3-06), in a new default-world game as Altura, the way the
 * owner's "How to test it" script plays it on the live site:
 *
 * 1. Starters: the Active tab has the two starter storylines, each with a face, a heel and a heat
 *    meter; the heat's Why? starts from `storylines.heat.startBase`; a starter's "Why it started"
 *    lists the faces and heels it was picked from.
 * 2. Create: New storyline "Test Feud" with one face and one heel (their sides come from their
 *    alignment) opens its page with a starting heat and its Why?; the desk then has three; a second
 *    "Test Feud" is refused under the name field.
 * 3. Cooling: a 14-day skip (the player's shows cancelled on the way) cools every storyline by the
 *    6 points CRTV3-02's cooling test pins (7 days of grace, then 1 a day; the last day simulated is
 *    day 13), and the Why? shows the days since progress, the grace check and the daily cooling.
 * 4. Members and the end: a neutral member joins, the face changes to Heel, removing down to one
 *    person ends in the "End it instead" refusal; ending pays nothing (needs 4 linked segments, has
 *    0); the storyline moves to Ended and its page has no actions left.
 *
 * On a phone (Chromium and WebKit) faces sit above heels, the editor is a bottom sheet, the main
 * buttons are at least 44px tall, and nothing scrolls sideways, also at 150% UI scale. A save
 * through Main menu and a hard load of the storyline's own address bring the page back.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { gameDate } from './helpers/booking';
import { addIsoDays, skipToDateThroughStops } from './helpers/contracts';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';
const TEST_FEUD = 'Test Feud';

/** A new world, a 14-day skip and the whole desk flow take a while on a loaded machine. */
const GAME_TIMEOUT_MS = 480_000;

/** The days skipped for the cooling check. */
const SKIP_DAYS = 14;
/**
 * What a 14-day skip from the start date cools a storyline by with default tunables: heat holds for
 * `storylines.heat.decayGraceDays` (7) days and then drops `decayPerDay` (1) a day; the last day
 * simulated is day 13, so days 8 to 13 cool. Pinned by `test/systems/storylines/cooling.test.ts`
 * ("is at 34 after a 14-day skip from the start date").
 */
const COOLED_BY = 6;

/** The touch target the phone layout promises (`--tap-pad-block`). */
const MIN_TAP_PX = 44;

/** The heat Why? button: "Why is Heat 37?". */
const HEAT_WHY = /^Why is Heat (\d+)\?$/;

function desk(page: Page): Locator {
  return page.getByRole('main');
}

function activeCards(page: Page): Locator {
  return desk(page).getByRole('list', { name: 'Active storylines' }).getByRole('article');
}

async function openDesk(page: Page): Promise<void> {
  await navigateInApp(page, '/game/storylines');
  await expect(page.getByRole('heading', { level: 1, name: 'Storylines' })).toBeVisible();
  await expect(activeCards(page).first()).toBeVisible();
}

async function boxOf(locator: Locator): Promise<{ x: number; y: number; height: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The element has no box');
  return box;
}

async function expectTapTarget(locator: Locator): Promise<void> {
  expect((await boxOf(locator)).height, 'tap target height').toBeGreaterThanOrEqual(MIN_TAP_PX);
}

/** The heat a card or page shows, read from its Why? button's name. */
async function heatOf(scope: Locator): Promise<number> {
  const name =
    (await scope.getByRole('button', { name: HEAT_WHY }).first().getAttribute('aria-label')) ??
    (await scope.getByRole('button', { name: HEAT_WHY }).first().textContent()) ??
    '';
  const match = HEAT_WHY.exec(name.trim());
  if (match?.[1] === undefined) throw new Error(`No heat in "${name}"`);
  return Number(match[1]);
}

/** Opens the heat Why? in `scope`, expands every line and returns the open panel. */
async function openHeatWhy(page: Page, scope: Locator): Promise<Locator> {
  await scope.getByRole('button', { name: HEAT_WHY }).first().click();
  const why = page.getByRole('dialog', { name: 'Heat' });
  await expect(why).toBeVisible();
  const expand = why.getByRole('button', { name: 'Expand all' });
  if (await expand.isVisible()) await expand.click();
  await expect(why).not.toContainText(/undefined|NaN|minute/i);
  return why;
}

async function closeOverlay(page: Page, overlay: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
}

/** The heat of every active card, by storyline name. */
async function deskHeats(page: Page): Promise<Map<string, number>> {
  const heats = new Map<string, number>();
  const cards = activeCards(page);
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const card = cards.nth(index);
    const name = ((await card.getByRole('heading').textContent()) ?? '').trim();
    heats.set(name, await heatOf(card));
  }
  return heats;
}

/** Sets the UI scale on the settings screen without reloading, so the game stays loaded. */
async function setUiScale(page: Page, scale: string): Promise<void> {
  await navigateInApp(page, '/settings');
  await page.getByRole('slider', { name: 'UI scale' }).fill(scale);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')))
    .toBe(scale);
}

/** The person a picker row adds, from its accessible name "Add <name>". */
async function optionName(option: Locator): Promise<string> {
  const snapshot = await option.ariaSnapshot();
  const match = /button "Add (.+?)"/.exec(snapshot);
  if (match?.[1] === undefined) throw new Error(`No name in ${snapshot}`);
  return match[1];
}

/**
 * Picks the first person in the picker whose alignment chip reads `alignment` and who is not in a
 * storyline yet, and checks the side they start on.
 */
async function pickByAlignment(
  sheet: Locator,
  alignment: 'Face' | 'Heel',
  side: 'Face' | 'Heel',
): Promise<string> {
  const option = sheet
    .getByRole('list', { name: 'People you can add' })
    .getByRole('button', { disabled: false })
    .filter({ hasText: 'In no storylines' })
    .filter({
      has: sheet.page().locator(`[data-alignment="${alignment.toLowerCase()}"]`),
    })
    .first();
  const name = await optionName(option);
  await option.click();
  await expect(
    sheet.getByRole('group', { name: `Side for ${name}` }).getByRole('radio', { name: side }),
  ).toBeChecked();
  return name;
}

/** Taps a menu item on a phone, clicks it on desktop. */
async function pressItem(item: Locator, phone: boolean): Promise<void> {
  if (phone) await item.tap();
  else await item.click();
}

/** Opens a member's "Actions for <name>" menu on the storyline page. */
async function memberMenu(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: `Actions for ${name}` }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

async function goToMainMenu(page: Page, phone: boolean): Promise<void> {
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
}

test('the Storylines desk: starters, a new storyline, cooling, members and the end', async ({
  page,
}, testInfo) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  const phone = isPhone(testInfo);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await startDefaultWorldGame(page, ALTURA, { phone });
  const startDate = await gameDate(page);

  let starterName = '';
  await test.step('the nav item opens the desk with two starters', async () => {
    if (phone) {
      await page
        .getByRole('navigation', { name: 'Primary' })
        .getByRole('button', { name: 'More' })
        .click();
      await page
        .getByRole('dialog', { name: 'Menu' })
        .getByRole('link', { name: 'Storylines', exact: true })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Main' })
        .getByRole('link', { name: 'Storylines', exact: true })
        .click();
    }
    await expect(page).toHaveURL(/\/game\/storylines(\?.*)?$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Storylines' })).toBeVisible();
    const cards = activeCards(page);
    await expect(cards).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const card = cards.nth(index);
      await expect(card.getByRole('heading')).toHaveText(/^.+ vs\. .+$/);
      await expect(card.getByRole('list', { name: 'Faces' }).getByRole('listitem')).not.toHaveCount(
        0,
      );
      await expect(card.getByRole('list', { name: 'Heels' }).getByRole('listitem')).not.toHaveCount(
        0,
      );
      await expect(card.getByRole('meter', { name: 'Heat' })).toBeVisible();
      const heat = await heatOf(card);
      expect(heat).toBeGreaterThanOrEqual(25);
      expect(heat).toBeLessThanOrEqual(60);
    }
    const first = cards.first();
    starterName = ((await first.getByRole('heading').textContent()) ?? '').trim();
    const faces = await boxOf(first.getByRole('list', { name: 'Faces' }));
    const heels = await boxOf(first.getByRole('list', { name: 'Heels' }));
    if (phone) {
      expect(heels.y, 'faces sit above heels on a phone').toBeGreaterThan(faces.y);
      await expectTapTarget(desk(page).getByRole('button', { name: 'New storyline' }).first());
    } else {
      expect(heels.x, 'faces sit left of heels on desktop').toBeGreaterThan(faces.x);
    }
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  await test.step("a starter's heat Why? and Why it started", async () => {
    const card = activeCards(page).first();
    const heat = await heatOf(card);
    const why = await openHeatWhy(page, card);
    await expect(why).toContainText('Base starting heat');
    await expect(why).toContainText('storylines.heat.startBase');
    await expect(why).toContainText('Star power');
    await expect(why).toContainText(String(heat));
    await expectNoHorizontalScroll(page);
    await closeOverlay(page, why);

    await card.getByRole('heading').getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: starterName })).toBeVisible();
    await expect(page.getByText('Cools from day 8 without progress')).toBeVisible();
    await page.getByRole('button', { name: 'Why did this storyline start?' }).click();
    const started = page.getByRole('dialog', { name: 'Why it started' });
    await expect(started).toBeVisible();
    const expand = started.getByRole('button', { name: 'Expand all' });
    if (await expand.isVisible()) await expand.click();
    await expect(started).toContainText(/Top faces: 1\. /);
    await expect(started).toContainText(/Top heels: 1\. /);
    await expectNoHorizontalScroll(page);
    await closeOverlay(page, started);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  let face = '';
  let heel = '';
  await test.step('New storyline: Test Feud with a face and a heel', async () => {
    await openDesk(page);
    await desk(page).getByRole('button', { name: 'New storyline' }).first().click();
    const sheet = page.getByRole('dialog', { name: 'New storyline' });
    await expect(sheet.getByRole('button', { name: /^Add / }).first()).toBeVisible();
    if (phone) await expect(sheet).toHaveAttribute('data-side', 'bottom');
    await sheet.getByRole('textbox', { name: 'Name' }).fill(TEST_FEUD);
    face = await pickByAlignment(sheet, 'Face', 'Face');
    heel = await pickByAlignment(sheet, 'Heel', 'Heel');
    await expectNoHorizontalScroll(page);
    if (phone) await expectTapTarget(sheet.getByRole('button', { name: 'Start storyline' }));
    await sheet.getByRole('button', { name: 'Start storyline' }).click();
    await expect(sheet).toBeHidden();

    await expect(page.getByRole('heading', { level: 1, name: TEST_FEUD })).toBeVisible();
    const heat = await heatOf(page.getByRole('main'));
    expect(heat).toBeGreaterThanOrEqual(25);
    const why = await openHeatWhy(page, page.getByRole('main'));
    await expect(why).toContainText('storylines.heat.startBase');
    await expect(why).toContainText(`${face}'s home popularity`);
    await closeOverlay(page, why);
    await expect(page.getByRole('region', { name: 'Faces' })).toContainText(face);
    await expect(page.getByRole('region', { name: 'Heels' })).toContainText(heel);

    await openDesk(page);
    await expect(activeCards(page)).toHaveCount(3);

    // The name is taken while Test Feud runs.
    await desk(page).getByRole('button', { name: 'New storyline' }).first().click();
    await expect(sheet.getByRole('button', { name: /^Add / }).first()).toBeVisible();
    await sheet.getByRole('textbox', { name: 'Name' }).fill(TEST_FEUD);
    await pickByAlignment(sheet, 'Face', 'Face');
    await sheet.getByRole('button', { name: 'Start storyline' }).click();
    const nameField = sheet.getByRole('textbox', { name: 'Name' });
    await expect(nameField).toHaveAccessibleDescription(
      new RegExp(`You already run a storyline called ${TEST_FEUD}`),
    );
    await expect(nameField).toHaveAttribute('aria-invalid', 'true');
    await sheet.getByRole('button', { name: 'Cancel' }).click();
    const discard = page.getByRole('alertdialog');
    if (await discard.isVisible()) await discard.getByRole('button', { name: /Discard/ }).click();
    await expect(sheet).toBeHidden();
    await expect(activeCards(page)).toHaveCount(3);
  });

  await test.step('14 days without progress cool every storyline', async () => {
    const before = await deskHeats(page);
    expect([...before.keys()]).toContain(TEST_FEUD);
    await skipToDateThroughStops(page, addIsoDays(startDate, SKIP_DAYS), phone);
    await openDesk(page);
    const after = await deskHeats(page);
    for (const [name, heat] of before) {
      expect(after.get(name), `${name} after ${String(SKIP_DAYS)} days`).toBe(heat - COOLED_BY);
    }
    const card = activeCards(page).filter({ hasText: TEST_FEUD });
    const why = await openHeatWhy(page, card);
    await expect(why).toContainText('Heat after cooling');
    await expect(why).toContainText(/Days since progress: 13 days/);
    await expect(why).toContainText('Past the grace period of 7 days');
    await expect(why).toContainText('storylines.heat.decayGraceDays');
    await expect(why).toContainText('Above the cooling floor of 10');
    await expect(why).toContainText('storylines.heat.decayFloor');
    await expect(why).toContainText('Daily cooling');
    await expect(why).toContainText('storylines.heat.decayPerDay');
    await expect(why).toContainText('Cooling for 6 days so far');
    await expectNoHorizontalScroll(page);
    await closeOverlay(page, why);
  });

  let neutral = '';
  await test.step('Test Feud: a neutral member, a side change and the last-member refusal', async () => {
    await activeCards(page)
      .filter({ hasText: TEST_FEUD })
      .getByRole('heading')
      .getByRole('link')
      .click();
    await expect(page.getByRole('heading', { level: 1, name: TEST_FEUD })).toBeVisible();
    await expect(page.getByText('Cooling 1 per day, floor 10.')).toBeVisible();
    if (phone) {
      await expectTapTarget(page.getByRole('button', { name: 'Add member' }));
      await expectTapTarget(page.getByRole('button', { name: 'End storyline' }));
      await expectTapTarget(page.getByRole('button', { name: `Actions for ${face}` }));
    }

    await page.getByRole('button', { name: 'Add member' }).click();
    const add = page.getByRole('dialog', { name: 'Add people' });
    const option = add
      .getByRole('list', { name: 'People you can add' })
      .getByRole('button', { disabled: false })
      .first();
    neutral = await optionName(option);
    await option.click();
    await add
      .getByRole('group', { name: `Side for ${neutral}` })
      .getByRole('radio', { name: 'Neutral' })
      .check();
    await expectNoHorizontalScroll(page);
    await add.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(add).toBeHidden();
    const neutralRow = page.getByRole('region', { name: 'Neutral' });
    await expect(neutralRow).toContainText(neutral);
    await expect(neutralRow.getByText('Neutral', { exact: true }).last()).toBeVisible();

    await memberMenu(page, face);
    // A phone taps: a mouse click's pointer moves can close the submenu on the way to its item.
    await pressItem(page.getByRole('menuitem', { name: 'Change side' }), phone);
    await pressItem(page.getByRole('menuitem', { name: 'Heel', exact: true }), phone);
    await expect(page.getByRole('region', { name: 'Heels' })).toContainText(face);
    await expect(page.getByRole('region', { name: 'Faces' })).toContainText('No one yet');

    for (const person of [face, heel]) {
      await memberMenu(page, person);
      await page.getByRole('menuitem', { name: 'Remove' }).click();
      const confirm = page.getByRole('alertdialog', { name: `Remove ${person}?` });
      await confirm.getByRole('button', { name: 'Remove' }).click();
      await expect(confirm).toBeHidden();
      await expect(page.getByRole('button', { name: `Actions for ${person}` })).toBeHidden();
    }
    await memberMenu(page, neutral);
    await page.getByRole('menuitem', { name: 'Remove' }).click();
    const last = page.getByRole('alertdialog', { name: `Remove ${neutral}?` });
    await last.getByRole('button', { name: 'Remove' }).click();
    await expect(last).toContainText('A storyline needs at least one person. End it instead.');
    await expectNoHorizontalScroll(page);
    await last.getByRole('button', { name: 'Cancel' }).click();
    await expect(last).toBeHidden();
    await expect(page.getByRole('region', { name: 'Neutral' })).toContainText(neutral);
    await expectNoSeriousA11yViolations(page);
  });

  await test.step('ending Test Feud pays nothing and leaves it read-only under Ended', async () => {
    await page.getByRole('button', { name: 'End storyline' }).click();
    const end = page.getByRole('dialog', { name: `End ${TEST_FEUD}?` });
    await expect(end).toBeVisible();
    await expect(end).toContainText('No payoff (needs 4 linked segments, has 0)');
    if (phone) {
      await expect(end).toHaveAttribute('data-side', 'bottom');
      await expectTapTarget(end.getByRole('button', { name: 'Cancel' }));
    }
    await expectNoHorizontalScroll(page);
    await end.getByRole('button', { name: 'End storyline' }).click();
    await expect(end).toBeHidden();

    const ending = page.getByRole('region', { name: 'Ending' });
    await expect(ending).toContainText('No payoff (needs 4 linked segments, had 0)');
    await expect(page.getByRole('button', { name: 'End storyline' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add member' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Actions for / })).toHaveCount(0);
    await expectNoHorizontalScroll(page);

    await openDesk(page);
    await expect(activeCards(page)).toHaveCount(2);
    await desk(page).getByRole('tab', { name: /Ended/ }).click();
    const ended = desk(page).getByRole('list', { name: 'Ended storylines' }).getByRole('article');
    await expect(ended.filter({ hasText: TEST_FEUD })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  if (phone) {
    await test.step('at 150% UI scale the desk, a page and its sheets still fit', async () => {
      await setUiScale(page, '1.5');
      await openDesk(page);
      await expectNoHorizontalScroll(page);
      await desk(page).getByRole('button', { name: 'New storyline' }).first().click();
      const sheet = page.getByRole('dialog', { name: 'New storyline' });
      await expect(sheet.getByRole('button', { name: /^Add / }).first()).toBeVisible();
      await expectNoHorizontalScroll(page);
      await sheet.getByRole('button', { name: 'Cancel' }).click();
      await expect(sheet).toBeHidden();
      await desk(page).getByRole('link', { name: starterName }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: starterName })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await page.getByRole('button', { name: 'End storyline' }).click();
      const end = page.getByRole('dialog', { name: `End ${starterName}?` });
      await expect(end).toContainText('No payoff (needs 4 linked segments, has 0)');
      await expectNoHorizontalScroll(page);
      await end.getByRole('button', { name: 'Cancel' }).click();
      await expect(end).toBeHidden();
      await setUiScale(page, '1');
    });
  }

  await test.step("a hard load of a storyline's address after saving", async () => {
    await openDesk(page);
    await desk(page).getByRole('link', { name: starterName }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: starterName })).toBeVisible();
    const address = new URL(page.url()).pathname;
    await goToMainMenu(page, phone);
    await page.goto(address);
    // No game is loaded after a hard load, so the app asks for one instead of failing.
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await navigateInApp(page, address);
    await expect(page.getByRole('heading', { level: 1, name: starterName })).toBeVisible();
    await expect(page.getByRole('meter', { name: 'Heat' })).toBeVisible();
  });
});

/**
 * Partner steps of the owner's script that need packs not on main yet. Each one skips with the
 * reason until its pack wires it (docs/design/storylines.md "Wired with" / "Integration"); flip the
 * flag in that pack. CRTV4's step (a linked segment on the timeline with heat before → after) is
 * live and covered by `storyline-heat-payoff.spec.ts`.
 */
const WRK8_WIRED = false;
const MTCH8_WIRED = false;

test('with WRK8: the storyline heat panel shows the story shield line', async ({ page }) => {
  test.skip(!WRK8_WIRED, 'WRK8 (story shield) is not on main yet: no shield line to check');
  test.setTimeout(GAME_TIMEOUT_MS);
  await startDefaultWorldGame(page, ALTURA);
  await openDesk(page);
  await activeCards(page).first().getByRole('heading').getByRole('link').click();
  await expect(page.getByRole('region', { name: 'Heat' })).toContainText(/Story shield \d+%/);
});

test('with MTCH8: the Match lab Stakes list the starter storylines', async ({ page }) => {
  test.skip(!MTCH8_WIRED, 'MTCH8 (Match lab stakes) is not on main yet: no Stakes to check');
  test.setTimeout(GAME_TIMEOUT_MS);
  await startDefaultWorldGame(page, ALTURA);
  await openDesk(page);
  const names = (await activeCards(page).getByRole('heading').allTextContents()).map((name) =>
    name.trim(),
  );
  await navigateInApp(page, '/game/match-lab');
  const stakes = page.getByRole('region', { name: 'Stakes' });
  for (const name of names) await expect(stakes).toContainText(name);
});
