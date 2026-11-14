/**
 * The Match lab's Angle mode (MTCH5-05), in a new default-world game as Altura, on desktop, phone
 * and phone WebKit:
 *
 * - `?mode=angle` opens Angle mode; the slot role moves the beat limit at once (Pre-show: up to 2
 *   beats, Main event: up to 6);
 * - a template fills the beats; people come from the picker sorted by Mic;
 * - Run shows the angle score, stars, delivered and crowd with Why?, expected against delivered and
 *   a row for each beat with the stat each person was scored on;
 * - a manager chosen in a chip's menu talks for the worker ("via" in the beat's people);
 * - no minutes anywhere, no sideways scroll and no serious a11y issues at each step.
 *
 * `E2E_SHOTS=<folder>` saves viewport screenshots.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const PLAYER = 'Altura Wrestling Entertainment';

/** Where the spec leaves viewport screenshots, when asked. */
const SHOTS_DIR = process.env['E2E_SHOTS'];

async function expectFitsAndAccessible(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
}

async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
  await expect(page.getByRole('listbox')).toBeHidden();
}

/** Sorts a picker by Mic, highest first, where it is a table (phones list cards in their order). */
async function sortByMic(sheet: Locator): Promise<void> {
  const micHeader = sheet.getByRole('button', { name: /^Mic/ });
  if ((await micHeader.count()) === 0) return;
  const column = sheet.getByRole('columnheader', { name: /^Mic/ });
  for (let tries = 0; tries < 3; tries += 1) {
    if ((await column.getAttribute('aria-sort')) === 'descending') return;
    await micHeader.click();
  }
  await expect(column).toHaveAttribute('aria-sort', 'descending');
}

/**
 * Adds someone to a group from the picker sorted by Mic, highest first: the best talker the beat
 * doesn't have yet. Returns their name.
 */
async function addBestTalker(page: Page, group: string): Promise<string> {
  await page
    .getByRole('button', { name: `Add person to ${group}` })
    .first()
    .click();
  const sheet = page.getByRole('dialog', { name: new RegExp(`^Add to ${group}, beat \\d$`) });
  await expect(sheet).toBeVisible();
  const rows = sheet.locator('[data-row-id]');
  await expect(rows.first()).toBeVisible();
  await sortByMic(sheet);
  const row = rows.first();
  // The first line of a row (a table row or a phone card) is the name.
  const name = ((await row.innerText()).split(/[\t\n]/)[0] ?? '').trim();
  await row.click();
  await expect(sheet).toBeHidden();
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

async function shoot(page: Page, target: Locator, name: string, project: string): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await target.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${project}.png` });
}

test.describe('Angle mode in the Match lab', () => {
  test('builds an angle from a template, runs it and reads every beat, on a new Altura game', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startDefaultWorldGame(page, PLAYER);
    await navigateInApp(page, '/game/match-lab?mode=angle');
    await expect(page.getByRole('heading', { level: 1, name: 'Match lab' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Angle' })).toBeChecked();
    const angle = page.getByRole('region', { name: 'Angle', exact: true });
    await expect(angle.getByRole('combobox', { name: 'Angle type' })).toBeVisible();

    // The setup folds into a summary row on a phone; open it to change the slot role.
    const setupToggle = page.getByRole('button', { name: 'Setup', exact: true });
    if ((await setupToggle.count()) > 0) await setupToggle.click();

    await choose(page, 'Slot role', 'Pre-show');
    await expect(angle.getByText('Short slot: up to 2 beats').first()).toBeVisible();
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
    const first = await addBestTalker(page, 'Cast');
    await addBestTalker(page, 'Side A');
    const other = await addBestTalker(page, 'Side B');
    expect(other).not.toBe('');

    const run = page.getByRole('button', { name: 'Run', exact: true });
    await expect(run).toBeEnabled();
    await run.click();
    const bug = page.getByRole('group', { name: 'Angle result' });
    await expect(bug).toBeVisible();
    for (const label of ['Angle score', 'Stars', 'Delivered', 'Crowd']) {
      await expect(
        bug.getByRole('button', { name: new RegExp(`^Why is ${label} `) }),
      ).toBeVisible();
    }
    const beats = page
      // A table on desktop, a list of cards on a phone.
      .getByRole(isPhone(testInfo) ? 'list' : 'grid', { name: 'Each beat of the angle' });
    await expect(beats).toBeVisible();
    await expect(beats.getByText(/ — (Mic|Charisma) \d+/).first()).toBeVisible();
    await expect(beats.getByText('closing')).toBeVisible();
    expect(await page.locator('main').textContent()).not.toMatch(/minute/iu);

    // A person's Why? shows the best stat they were scored on.
    await beats
      .getByRole('button', { name: new RegExp(`^Why is ${first} in Backstage Skit `) })
      .click();
    const why = page.getByRole('dialog').last();
    await expect(why).toContainText('Best stat');
    await page.keyboard.press('Escape');
    await expect(why).toBeHidden();
    await expectFitsAndAccessible(page);
    await shoot(page, bug, 'angle-lab-result', testInfo.project.name);
    await shoot(page, beats, 'angle-lab-beats', testInfo.project.name);

    // A manager talks for the first worker: the beat says "via".
    await angle
      .getByRole('button', { name: `Manager for ${first}` })
      .first()
      .click();
    await page.getByRole('menuitem', { name: 'Choose a manager…' }).click();
    const managers = page.getByRole('dialog', { name: `Manager for ${first}` });
    await expect(managers).toBeVisible();
    const managerRows = managers.locator('[data-row-id]');
    await expect(managerRows.first()).toBeVisible();
    await sortByMic(managers);
    await managerRows.first().click();
    await expect(managers).toBeHidden();
    await expect(angle.getByText(/^Mgr: /).first()).toBeVisible();
    await expect(page.getByText('Out of date: run again')).toBeVisible();
    await run.click();
    await expect(page.getByText('Out of date: run again')).toBeHidden();
    // The manager's Mic is weighed for the worker, at its reduced share: it wins when it is better.
    const badge =
      (await angle
        .getByText(/^Mgr: /)
        .first()
        .textContent()) ?? '';
    const manager = badge.replace(/^Mgr: /, '').trim();
    const standIn = await whyText(
      page,
      beats.getByRole('button', { name: new RegExp(`^Why is ${first} in Backstage Skit `) }),
    );
    expect(standIn).toContain(manager);
    await expectFitsAndAccessible(page);
    await shoot(page, angle, 'angle-lab-manager', testInfo.project.name);
  });
});
