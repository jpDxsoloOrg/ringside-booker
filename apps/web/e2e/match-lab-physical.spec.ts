/**
 * The Match lab's Physical panel (MTCH4-05) in a played default-world game, on desktop and phone:
 *
 * - after a Run the panel lists both competitors with fatigue, wear, learning and the injury
 *   chance, each with a Why?, and the page has no sideways scroll or serious a11y issues;
 * - the "Fatigue going in" what-if is a Select (not a slider) that plays the night again;
 * - 100 runs show the injuries per 100 runs;
 * - no minutes anywhere on the panel.
 *
 * `E2E_SHOTS=<folder>` saves viewport screenshots of the panel.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromPlayedSave } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

/** Where the spec leaves viewport screenshots, when asked. */
const SHOTS_DIR = process.env['E2E_SHOTS'];

/** Adds the first listed worker the side does not have yet to `side` (1-based). */
async function addFirstWorker(page: Page, side: number): Promise<void> {
  await page.getByRole('button', { name: `Add worker to Side ${String(side)}` }).click();
  const sheet = page.getByRole('dialog', { name: `Add to Side ${String(side)}` });
  await expect(sheet).toBeVisible();
  const rows = sheet.locator('[data-row-id]');
  await expect(rows.first()).toBeVisible();
  // Skip anyone already on a side, so the two sides never share a worker.
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    if ((await row.getByText(/^On Side/).count()) === 0) {
      await row.click();
      break;
    }
  }
  await sheet.getByRole('button', { name: 'Done' }).click();
  await expect(sheet).toBeHidden();
}

async function openLab(page: Page): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await enterGameFromPlayedSave(page);
  await navigateInApp(page, '/game/match-lab');
  await expect(page.getByRole('heading', { level: 1, name: 'Match lab' })).toBeVisible();
  await addFirstWorker(page, 1);
  await addFirstWorker(page, 2);
  return page.getByRole('region', { name: 'Physical', exact: true });
}

test.describe('Match lab Physical panel', () => {
  test('shows the toll after a Run, with a what-if and 100 runs, and fits', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    const panel = await openLab(page);
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const gains = panel.getByRole('button', { name: /^Why is .*'s fatigue gain / });
    await expect(gains).toHaveCount(2);
    await expect(panel.getByRole('button', { name: /^Why is .*'s injury chance / })).toHaveCount(2);
    await expect(panel.getByText(/(Short|Standard|Long) match/)).toBeVisible();
    expect(await panel.textContent()).not.toMatch(/minute/i);

    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    if (SHOTS_DIR !== undefined) {
      await panel.scrollIntoViewIfNeeded();
      await panel.evaluate((element) => {
        element.scrollIntoView({ block: 'start' });
      });
      await page.screenshot({
        path: `${SHOTS_DIR}/physical-panel-${testInfo.project.name}.png`,
      });
    }

    // The what-if is a Select on every layout, and plays the night again.
    const whatIf = panel.getByRole('combobox', { name: /'s fatigue going in$/ }).first();
    await whatIf.click();
    await page.getByRole('option', { name: '100', exact: true }).click();
    await expect(whatIf).toHaveText(/100/);
    await expect(panel.getByRole('slider')).toHaveCount(0);

    // 100 runs: the Runs slider to its top, then Run.
    const runs = page.getByRole('slider', { name: 'Runs' });
    await runs.focus();
    await page.keyboard.press('End');
    await expect(runs).toHaveValue('100');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    const kpi = panel.getByRole('group', { name: 'Injuries per 100 runs' });
    await expect(kpi).toBeVisible({ timeout: 30_000 });
    await expect(kpi).toContainText(/Injuries: \d+ in 100 runs/);
    await expectNoHorizontalScroll(page);
    expect(await panel.textContent()).not.toMatch(/minute/i);

    if (SHOTS_DIR !== undefined) {
      await kpi.evaluate((element) => {
        element.scrollIntoView({ block: 'center' });
      });
      await page.screenshot({
        path: `${SHOTS_DIR}/physical-runs-${testInfo.project.name}.png`,
      });
    }

    if (isPhone(testInfo)) {
      // One card per worker, with the rest of the numbers under "Physical".
      await expect(panel.getByText('Physical', { exact: true }).first()).toBeVisible();
    }
  });
});
