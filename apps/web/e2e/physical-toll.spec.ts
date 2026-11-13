/**
 * MTCH4's physical toll in the Match lab (MTCH4-06), in a new default-world game as Altura, on
 * desktop, phone and phone WebKit:
 *
 * - a singles match as the Opener, then as the Main event: the fatigue gain grows and its Why?
 *   names the "Long duration class";
 * - the injury chance's Why? lists fatigue by the end of the match, the worst body part and the
 *   least safe opponent;
 * - both "Fatigue going in" what-ifs at 100 raise the chance;
 * - Run x100 shows the injuries per 100 runs;
 * - a teacher in the match: the partner's learning Why? says "Worked with a teacher" and never shows
 *   a number next to "potential";
 * - no minutes anywhere, no sideways scroll and no serious a11y issues at each step.
 *
 * `E2E_SHOTS=<folder>` saves viewport screenshots of the panel.
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

/** Waits for the page to settle, then checks it fits and has no serious a11y issues. */
async function expectFitsAndAccessible(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
}

/**
 * Adds a worker to `side` (1-based) from the picker: the first one listed that no side has yet,
 * after choosing `trait` in the picker's Trait filter when given.
 */
async function addWorker(page: Page, side: number, trait?: string): Promise<string> {
  await page.getByRole('button', { name: `Add worker to Side ${String(side)}` }).click();
  const sheet = page.getByRole('dialog', { name: `Add to Side ${String(side)}` });
  await expect(sheet).toBeVisible();
  if (trait !== undefined) {
    await sheet.getByRole('combobox', { name: 'Trait' }).click();
    await page.getByRole('option', { name: trait, exact: true }).click();
  }
  const rows = sheet.locator('[data-row-id]');
  await expect(rows.first()).toBeVisible();
  const count = await rows.count();
  let picked = '';
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if ((await row.getByText(/^On Side/).count()) === 0) {
      picked = (await row.getAttribute('data-row-id')) ?? '';
      await row.click();
      break;
    }
  }
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
  return picked;
}

/** Removes everyone from both sides. */
async function clearSides(page: Page): Promise<void> {
  const remove = page.getByRole('button', { name: /^Remove .+ from Side \d$/ });
  while ((await remove.count()) > 0) {
    await remove.first().click();
  }
}

async function chooseSlotRole(page: Page, role: string): Promise<void> {
  await page.getByRole('combobox', { name: 'Slot role' }).click();
  await page.getByRole('option', { name: role, exact: true }).click();
}

/** Presses Run and waits until the panel shows the new run. */
async function run(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click();
}

/** The number in a Why? button's name: "Why is Vance's fatigue gain 8.4?" gives 8.4. */
async function whyNumber(button: Locator): Promise<number> {
  const name = (await button.getAttribute('aria-label')) ?? (await button.textContent()) ?? '';
  const match = /(-?[\d.]+)%?\?$/.exec(name.trim());
  if (match?.[1] === undefined) throw new Error(`no number in "${name}"`);
  return Number(match[1]);
}

interface WhyPanelText {
  /** Everything the panel says, every step expanded. */
  readonly text: string;
  /** Each element that mentions potential, on its own. */
  readonly potentialLines: readonly string[];
}

/** Opens a Why?, reads the panel (every step expanded) and closes it again. */
async function readWhy(page: Page, button: Locator): Promise<WhyPanelText> {
  await button.click();
  const panel = page.getByRole('dialog').last();
  await expect(panel).toBeVisible();
  const expand = panel.getByRole('button', { name: 'Expand all' });
  if ((await expand.count()) > 0) await expand.click();
  const text = (await panel.textContent()) ?? '';
  const potentialLines = await panel.getByText(/potential/i).allTextContents();
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  return { text, potentialLines };
}

async function whyText(page: Page, button: Locator): Promise<string> {
  return (await readWhy(page, button)).text;
}

async function shoot(page: Page, panel: Locator, name: string, project: string): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await panel.evaluate((element) => {
    element.scrollIntoView({ block: 'start' });
  });
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${project}.png` });
}

test.describe('Physical toll in the Match lab', () => {
  test('fatigue, injury chance, what-ifs, 100 runs and a teacher, on a new Altura game', async ({
    page,
  }, testInfo) => {
    test.setTimeout(240_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await startDefaultWorldGame(page, PLAYER);
    await navigateInApp(page, '/game/match-lab');
    await expect(page.getByRole('heading', { level: 1, name: 'Match lab' })).toBeVisible();
    const panel = page.getByRole('region', { name: 'Physical', exact: true });

    await addWorker(page, 1);
    await addWorker(page, 2);
    const gains = panel.getByRole('button', { name: /^Why is .*'s fatigue gain / });
    const chances = panel.getByRole('button', { name: /^Why is .*'s injury chance / });

    // The Opener, then the Main event: a longer match tires more.
    await chooseSlotRole(page, 'Opener');
    await run(page);
    await expect(gains).toHaveCount(2);
    await expect(panel.getByText(/^(Short|Standard) match$/)).toBeVisible();
    const openerGain = await whyNumber(gains.first());
    await expectFitsAndAccessible(page);

    await chooseSlotRole(page, 'Main event');
    await run(page);
    await expect(panel.getByText('Long match')).toBeVisible();
    const mainGain = await whyNumber(gains.first());
    expect(mainGain).toBeGreaterThan(openerGain);
    expect(await whyText(page, gains.first())).toContain('Long duration class');
    expect(await panel.textContent()).not.toMatch(/minute/iu);

    const chanceWhy = await whyText(page, chances.first());
    expect(chanceWhy).toContain('Fatigue by the end of the match');
    expect(chanceWhy).toContain('Worst body part');
    expect(chanceWhy).toMatch(/Least safe opponent: .+, safety \d+/);
    await expectFitsAndAccessible(page);
    await shoot(page, panel, 'physical-toll', testInfo.project.name);

    // Both what-ifs at 100: the chance rises.
    const chanceBefore = await whyNumber(chances.first());
    const whatIfs = panel.getByRole('combobox', { name: /'s fatigue going in \(what-if\)$/ });
    await expect(whatIfs).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      await whatIfs.nth(index).click();
      await page.getByRole('option', { name: '100', exact: true }).click();
      await expect(whatIfs.nth(index)).toHaveText(/100/);
    }
    await expect.poll(async () => whyNumber(chances.first())).toBeGreaterThan(chanceBefore);
    await expect(panel.getByRole('slider')).toHaveCount(0);

    // Run x100: the injuries per 100 runs.
    const runs = page.getByRole('slider', { name: 'Runs' });
    await runs.focus();
    await page.keyboard.press('End');
    await expect(runs).toHaveValue('100');
    await run(page);
    const kpi = panel.getByRole('group', { name: 'Injuries per 100 runs' });
    await expect(kpi).toBeVisible({ timeout: 60_000 });
    await expect(kpi).toContainText(/Injuries: \d+ in 100 runs/);
    await expectFitsAndAccessible(page);
    await shoot(page, kpi, 'physical-toll-runs', testInfo.project.name);

    // A teacher against someone else: the partner's learning names the teacher, never potential.
    await runs.focus();
    await page.keyboard.press('Home');
    await expect(runs).toHaveValue('1');
    await clearSides(page);
    await addWorker(page, 1, 'Teacher');
    await addWorker(page, 2);
    await run(page);
    const learning = panel.getByRole('button', { name: /^Why is .*'s learning in this match / });
    await expect(learning).toHaveCount(2);
    const learningWhy = await readWhy(page, learning.nth(1));
    expect(learningWhy.text).toContain('Worked with a teacher');
    expect(learningWhy.text).not.toMatch(/ceiling/i);
    // "Limited by potential" may appear, with the factor it applies, but never a potential number.
    for (const line of learningWhy.potentialLines) {
      expect(line.trim()).toMatch(/^(×[\d.]+ )?Limited by potential(: ×[\d.]+)?$/);
    }
    await expectFitsAndAccessible(page);

    if (isPhone(testInfo)) {
      // One card per worker, with the rest of the numbers under "Physical".
      await expect(panel.getByText('Physical', { exact: true }).first()).toBeVisible();
    }
  });
});
