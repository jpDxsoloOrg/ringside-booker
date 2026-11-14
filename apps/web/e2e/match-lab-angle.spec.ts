/**
 * The Match lab's Angle mode end to end (MTCH5-05, MTCH5-07), in a new default-world game as
 * Altura, on desktop, phone and phone WebKit. The owner's "How to test it" script, step by step:
 *
 * - the Match | Angle switch puts `?mode=angle` in the URL; a midcard slot holds 4 beats;
 * - a promo by the best talker (picker sorted by Mic) scores, and its beat's Why? names the best
 *   stat; the worst talker scores lower; a manager chosen in the chip's menu stands in at 85%;
 * - a pre-show slot stops Add beat at 2 ("Short slot: up to 2 beats"), the main event takes more;
 * - staredown, war of words and brawl give three per-beat rows, and the angle score's Why? weighs
 *   each beat; reordering (keyboard on desktop, Move up on a phone) moves the closing weight;
 * - the same seed gives the same numbers; the Aftermath shows momentum with a Why?, never morale;
 * - a template fills the beats and a manager's stand-in shows in the beat's people;
 * - no minutes anywhere, no sideways scroll and no serious a11y issues at each step.
 *
 * (The ticket's "Opener" examples use the pre-show: with the default tunables the opener is a
 * standard slot and only the pre-show is short.) `E2E_SHOTS=<folder>` saves screenshots.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const PLAYER = 'Altura Wrestling Entertainment';

/** Building the default world and starting the game takes a while on a loaded machine. */
const GAME_TIMEOUT_MS = 300_000;

/** Where the spec leaves viewport screenshots, when asked. */
const SHOTS_DIR = process.env['E2E_SHOTS'];

/** The seed the determinism step pins the lab's random source to. */
const PINNED_SEED = 424_242;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function expectFitsAndAccessible(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
  expect(await page.locator('main').textContent()).not.toMatch(/\bminutes?\b/iu);
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

/**
 * Sorts a picker by Mic: highest first, or lowest first with `lowest`. A table sorts by its
 * column header; a phone's cards by the "Sort by" select and its direction toggle.
 */
async function sortByMic(page: Page, sheet: Locator, lowest = false): Promise<void> {
  const wanted = lowest ? 'ascending' : 'descending';
  const micHeader = sheet.getByRole('button', { name: /^Mic/ });
  if ((await micHeader.count()) > 0) {
    const column = sheet.getByRole('columnheader', { name: /^Mic/ });
    for (let tries = 0; tries < 3; tries += 1) {
      if ((await column.getAttribute('aria-sort')) === wanted) return;
      await micHeader.click();
    }
    await expect(column).toHaveAttribute('aria-sort', wanted);
    return;
  }
  await sheet.getByRole('combobox', { name: 'Sort by' }).click();
  await page.getByRole('option', { name: 'Mic', exact: true }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
  const direction = sheet.getByRole('button', { name: 'Sort descending' });
  await expect(direction).toHaveAttribute('aria-pressed', 'true');
  if (lowest) {
    await direction.click();
    await expect(direction).toHaveAttribute('aria-pressed', 'false');
  }
}

/** The first line of a picker row (a table row or a phone card): the person's name. */
async function rowName(row: Locator): Promise<string> {
  return ((await row.innerText()).split(/[\t\n]/)[0] ?? '').trim();
}

/** Beat `beatNumber`'s row (1-based) in the BeatEditor. */
function beatRow(page: Page, beatNumber: number): Locator {
  return page
    .getByRole('list', { name: 'Beats' })
    .locator('li')
    .filter({
      has: page.getByRole('heading', { name: `Beat ${String(beatNumber)}`, exact: true }),
    });
}

/**
 * Adds someone to a group of beat `beatNumber` (1-based) from the picker sorted by Mic: the best
 * talker the beat doesn't have yet, or the worst with `lowest`. Returns their name.
 */
async function addTalker(
  page: Page,
  group: string,
  beatNumber: number,
  lowest = false,
): Promise<string> {
  await beatRow(page, beatNumber)
    .getByRole('button', { name: `Add person to ${group}` })
    .click();
  const sheet = page.getByRole('dialog', {
    name: `Add to ${group}, beat ${String(beatNumber)}`,
  });
  await expect(sheet).toBeVisible();
  const rows = sheet.locator('[data-row-id]');
  await expect(rows.first()).toBeVisible();
  await sortByMic(page, sheet, lowest);
  const row = rows.first();
  const name = await rowName(row);
  await row.click();
  await expect(sheet).toBeHidden();
  expect(name).not.toBe('');
  return name;
}

/** Opens a Why?, reads the panel with every step expanded, and closes it again. */
async function whyText(page: Page, button: Locator): Promise<string> {
  await button.click();
  const panel = page.getByRole('dialog').last();
  await expect(panel).toBeVisible();
  const expand = panel.getByRole('button', { name: 'Expand all' });
  if ((await expand.count()) > 0) await expand.click();
  const text = (await panel.textContent()) ?? '';
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  return text;
}

/** The number in a Why? button's name: "Why is Angle score 62?" → 62. */
async function whyValue(button: Locator): Promise<number> {
  const name = (await button.getAttribute('aria-label')) ?? '';
  const value = /(-?[\d.,]+)\D*\?$/.exec(name)?.[1];
  if (value === undefined) throw new Error(`No number in "${name}".`);
  return Number(value.replace(/,/g, ''));
}

/** Presses Run and waits for a fresh result: the bug is there and nothing is out of date. */
async function runAngle(page: Page): Promise<void> {
  const run = page.getByRole('button', { name: 'Run', exact: true });
  await expect(run).toBeEnabled();
  await run.click();
  await expect(page.getByRole('group', { name: 'Angle result' })).toBeVisible();
  await expect(page.getByText('Out of date: run again')).toBeHidden();
  await expect(run).toBeEnabled();
}

function angleScoreButton(page: Page): Locator {
  return page
    .getByRole('group', { name: 'Angle result' })
    .getByRole('button', { name: /^Why is Angle score \d+\?$/ });
}

/** Every number with a Why? in the result and the beats, by its button's name, to compare Runs. */
async function numbersOnScreen(page: Page): Promise<string[]> {
  const names = await page
    .getByRole('button', { name: /^Why is / })
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? ''));
  return names.filter((name) => /score|Stars|Delivered|Crowd|Expected/.test(name));
}

/** The per-beat table on desktop, the list of cards on a phone. */
function beatTable(page: Page, testInfo: TestInfo): Locator {
  return page.getByRole(isPhone(testInfo) ? 'list' : 'grid', { name: 'Each beat of the angle' });
}

/** Opens the folded setup on a phone (Angle mode folds it into a summary row). */
async function openSetup(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: 'Setup', exact: true });
  if ((await toggle.count()) > 0 && (await toggle.getAttribute('aria-expanded')) === 'false') {
    await toggle.click();
  }
}

async function shoot(page: Page, target: Locator, name: string, project: string): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await target.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${project}.png` });
}

/** Pins the lab's random source, so every Run rolls on `seed`; the engine worker is untouched. */
async function pinLabSeed(page: Page, seed: number): Promise<void> {
  await page.evaluate((pinned) => {
    const original = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = <T extends ArrayBufferView | null>(array: T): T => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = pinned;
        return array;
      }
      return original(array);
    };
  }, seed);
}

test.describe('Angle mode in the Match lab', () => {
  test('rates promos, the beat limit, a three-beat angle and its order, on a new Altura game', async ({
    page,
  }, testInfo) => {
    test.setTimeout(GAME_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startDefaultWorldGame(page, PLAYER);

    // Step 2: Match | Angle, with ?mode=angle in the address; a midcard slot holds 4 beats.
    await navigateInApp(page, '/game/match-lab');
    await expect(page.getByRole('heading', { level: 1, name: 'Match lab' })).toBeVisible();
    await page.getByRole('radio', { name: 'Angle' }).click();
    await expect(page).toHaveURL(/[?&]mode=angle\b/);
    const angle = page.getByRole('region', { name: 'Angle', exact: true });
    await expect(angle.getByRole('combobox', { name: 'Angle type' })).toBeVisible();
    await expect(angle.getByText('Standard slot: up to 4 beats').first()).toBeVisible();
    await expectFitsAndAccessible(page);

    // Step 3: a promo by the best talker; the beat's Why? names the best stat.
    await choose(page, 'Angle type', 'Promo');
    await expect(angle.getByRole('combobox', { name: 'Beat 1: which beat' })).toHaveText(/Promo/);
    const best = await addTalker(page, 'Speaker', 1);
    await runAngle(page);
    await expect(
      page.getByRole('heading', { name: 'Result', exact: true }).locator('[tabindex="-1"]'),
    ).toBeFocused();
    const bestScore = await whyValue(angleScoreButton(page));
    expect(bestScore).toBeGreaterThan(0);
    const beatWhy = await whyText(
      page,
      page.getByRole('button', { name: /^Why is Promo score \d+\?$/ }).first(),
    );
    expect(beatWhy).toContain('Best stat');
    expect(beatWhy).toContain('Mic');
    expect(beatWhy).toContain(best);
    await expectFitsAndAccessible(page);
    await shoot(page, angle, 'angle-promo', testInfo.project.name);

    // Step 4: the worst talker scores lower; a manager stands in for them on Mic at 85%.
    await angle.getByRole('button', { name: `Remove ${best} from Speaker` }).click();
    const worst = await addTalker(page, 'Speaker', 1, true);
    expect(worst).not.toBe(best);
    await runAngle(page);
    const worstScore = await whyValue(angleScoreButton(page));
    expect(worstScore).toBeLessThan(bestScore);

    await angle.getByRole('button', { name: `Manager for ${worst}` }).click();
    await page.getByRole('menuitem', { name: 'Choose a manager…' }).click();
    const managers = page.getByRole('dialog', { name: `Manager for ${worst}` });
    await expect(managers).toBeVisible();
    const managerRows = managers.locator('[data-row-id]');
    await expect(managerRows.first()).toBeVisible();
    await sortByMic(page, managers);
    const manager = await rowName(managerRows.first());
    await managerRows.first().click();
    await expect(managers).toBeHidden();
    await expect(angle.getByText(`Mgr: ${manager}`)).toBeVisible();
    await runAngle(page);
    const standIn = await whyText(
      page,
      page.getByRole('button', { name: /^Why is Promo score \d+\?$/ }).first(),
    );
    expect(standIn).toContain(`Manager ${manager} stands in on Mic`);
    expect(standIn).toContain('85%');
    expect(standIn).not.toMatch(/\w:manager\b/);
    await expectFitsAndAccessible(page);

    // Step 5: a pre-show is short: 2 beats, then Add beat stops and says why.
    await openSetup(page);
    await choose(page, 'Slot role', 'Pre-show');
    const addBeat = angle.getByRole('button', { name: 'Add beat' });
    await addBeat.click();
    await expect(angle.getByRole('combobox', { name: 'Beat 2: which beat' })).toBeVisible();
    await expect(addBeat).toHaveAttribute('aria-disabled', 'true');
    await expect(
      angle.getByRole('status').filter({ hasText: 'Short slot: up to 2 beats' }),
    ).toBeVisible();
    await expectFitsAndAccessible(page);

    // Step 6: the main event is long and takes a third beat.
    await choose(page, 'Slot role', 'Main event');
    await expect(angle.getByText('Long slot: up to 6 beats').first()).toBeVisible();
    await expect(addBeat).not.toHaveAttribute('aria-disabled', 'true');
    await addBeat.click();
    await expect(angle.getByRole('combobox', { name: 'Beat 3: which beat' })).toBeVisible();

    // Step 7: a confrontation of staredown, war of words and brawl between the two best talkers.
    await choose(page, 'Angle type', 'Confrontation');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Change type' }).click();
    await expect(angle.getByRole('combobox', { name: 'Beat 1: which beat' })).toHaveText(
      /Staredown/,
    );
    await expect(angle.getByRole('combobox', { name: 'Beat 2: which beat' })).toBeHidden();
    const first = await addTalker(page, 'Side A', 1);
    await addTalker(page, 'Side B', 1);
    await addBeat.click();
    await choose(page, 'Beat 2: which beat', 'War of Words');
    await addTalker(page, 'Side A', 2);
    await addTalker(page, 'Side B', 2);
    await addBeat.click();
    await choose(page, 'Beat 3: which beat', 'Brawl');
    await addTalker(page, 'Brawlers', 3);
    await addTalker(page, 'Brawlers', 3);
    await runAngle(page);
    const beats = beatTable(page, testInfo);
    await expect(beats).toBeVisible();
    await expect(beats.locator('[data-row-id]')).toHaveCount(3);
    await expect(beats.getByText('closing', { exact: true })).toHaveCount(1);
    const score = await whyText(page, angleScoreButton(page));
    for (const term of ['Staredown (beat 1) ×', 'War of Words (beat 2) ×', 'Brawl (beat 3) ×']) {
      expect(score).toContain(term);
    }
    expect(score).toMatch(/Writing team \(level \d+\): floor [\d.]+, ceiling [\d.]+/);
    await expectFitsAndAccessible(page);
    await shoot(page, beats, 'angle-three-beats', testInfo.project.name);

    // Step 12 (MTCH3 is in): the Aftermath moves momentum, with a Why?, and never morale.
    const aftermath = page.getByRole('region', { name: 'Aftermath' });
    await expect(aftermath).toBeVisible();
    await expect(
      aftermath.getByRole('button', {
        name: new RegExp(`^Why is ${escapeRegExp(first)}'s momentum `),
      }),
    ).toBeVisible();
    expect(await aftermath.textContent()).not.toMatch(/morale/iu);

    // Step 8: War of Words to the top; the closing weight stays on the last beat, Brawl.
    if (phone) {
      await angle.getByRole('button', { name: 'Move War of Words up' }).click();
    } else {
      await angle.getByRole('button', { name: 'Move beat 2, War of Words' }).focus();
      await page.keyboard.press('Space');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('Space');
    }
    await expect(angle.getByRole('combobox', { name: 'Beat 1: which beat' })).toHaveText(
      /War of Words/,
    );
    await runAngle(page);
    const reordered = await whyText(page, angleScoreButton(page));
    expect(reordered).toContain('War of Words (beat 1) ×');
    expect(reordered).toContain('Staredown (beat 2) ×');
    await expectFitsAndAccessible(page);

    // Step 9: the same seed gives the same numbers, Run after Run.
    await pinLabSeed(page, PINNED_SEED);
    await runAngle(page);
    const once = await numbersOnScreen(page);
    expect(once.length).toBeGreaterThan(3);
    await runAngle(page);
    expect(await numbersOnScreen(page)).toEqual(once);
  });

  test('builds an angle from a template, runs it and reads every beat, on a new Altura game', async ({
    page,
  }, testInfo) => {
    test.setTimeout(GAME_TIMEOUT_MS);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startDefaultWorldGame(page, PLAYER);
    await navigateInApp(page, '/game/match-lab?mode=angle');
    await expect(page.getByRole('heading', { level: 1, name: 'Match lab' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Angle' })).toBeChecked();
    const angle = page.getByRole('region', { name: 'Angle', exact: true });
    await expect(angle.getByRole('combobox', { name: 'Angle type' })).toBeVisible();

    await openSetup(page);
    await choose(page, 'Slot role', 'Main event');
    await expect(angle.getByText('Long slot: up to 6 beats').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeDisabled();
    await expect(page.getByText('Add someone to beat 1 to run')).toBeVisible();
    await expectFitsAndAccessible(page);
    await shoot(page, angle, 'angle-lab-empty', testInfo.project.name);

    // Backstage Plot: a skit, then a war of words.
    await choose(page, 'Start from template', 'Backstage Plot');
    await expect(
      angle.getByRole('status').filter({ hasText: 'Started from Backstage Plot' }),
    ).toBeVisible();
    const first = await addTalker(page, 'Cast', 1);
    await addTalker(page, 'Side A', 2);
    await addTalker(page, 'Side B', 2);

    await runAngle(page);
    const bug = page.getByRole('group', { name: 'Angle result' });
    for (const label of ['Angle score', 'Stars', 'Delivered', 'Crowd']) {
      await expect(
        bug.getByRole('button', { name: new RegExp(`^Why is ${label} `) }),
      ).toBeVisible();
    }
    const beats = beatTable(page, testInfo);
    await expect(beats).toBeVisible();
    await expect(beats.getByText(/ — (Mic|Charisma) \d+/).first()).toBeVisible();
    await expect(beats.getByText('closing', { exact: true })).toBeVisible();

    // A person's Why? shows the best stat they were scored on.
    const personWhy = new RegExp(`^Why is ${escapeRegExp(first)} in Backstage Skit `);
    expect(await whyText(page, beats.getByRole('button', { name: personWhy }))).toContain(
      'Best stat',
    );
    await expectFitsAndAccessible(page);
    await shoot(page, bug, 'angle-lab-result', testInfo.project.name);

    // A manager talks for the first worker: their name is in the worker's Why?.
    await angle
      .getByRole('button', { name: `Manager for ${first}` })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Choose a manager…' }).click();
    const managers = page.getByRole('dialog', { name: `Manager for ${first}` });
    await expect(managers).toBeVisible();
    const managerRows = managers.locator('[data-row-id]');
    await expect(managerRows.first()).toBeVisible();
    await sortByMic(page, managers);
    const manager = await rowName(managerRows.first());
    await managerRows.first().click();
    await expect(managers).toBeHidden();
    await expect(page.getByText('Out of date: run again')).toBeVisible();
    await runAngle(page);
    expect(await whyText(page, beats.getByRole('button', { name: personWhy }))).toContain(manager);
    await expectFitsAndAccessible(page);
  });
});
