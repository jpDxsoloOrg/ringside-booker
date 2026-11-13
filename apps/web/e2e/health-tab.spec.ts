/**
 * The worker profile's Health tab (WRK6-05) in a real new game on the default world as Altura
 * Wrestling Entertainment, on desktop, phone and phone-webkit: any worker's Health tab shows six
 * condition bars with the age-cap marker, the fatigue meter and "Fit to work" (a new world has no
 * injuries), a condition value's Why? opens the age cap's breakdown, and the tab has no sideways
 * scroll and no serious axe findings. The injury card in a game is covered by WRK6-08's flow.
 *
 * Screenshots of the tab go to `E2E_SHOTS=<folder>` when it is set.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { openRoster, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const PROMOTION = 'Altura Wrestling Entertainment';
const BODY_PARTS = ['Head', 'Neck', 'Back', 'Arms', 'Torso', 'Legs'];

/** A new game builds the default world in the worker; the whole flow runs in one test. */
const FLOW_TIMEOUT_MS = 240_000;

/** The narrowest phone the game supports. */
const SMALL_PHONE = { width: 360, height: 740 } as const;

const SHOTS_DIR = process.env['E2E_SHOTS'];

async function shot(page: Page, name: string, projectName: string): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${projectName}.png` });
}

test.describe('the Health tab', () => {
  test('a new world’s worker is fit, with six bars, a fatigue meter and an age cap Why?', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PROMOTION);
    await openRoster(page, testInfo);

    const firstWorker = page.getByRole('tabpanel').locator('a[href^="/game/workers/"]').first();
    await firstWorker.click();
    await expect(page).toHaveURL(/\/game\/workers\/per_/);
    await page.getByRole('tab', { name: 'Health' }).click();
    await expect(page).toHaveURL(/\?tab=health$/);

    const condition = page.getByRole('region', { name: 'Condition' });
    await expect(condition).toBeVisible();
    const bars = condition.getByRole('meter');
    await expect(bars).toHaveCount(BODY_PARTS.length);
    for (const [index, part] of BODY_PARTS.entries()) {
      await expect(bars.nth(index)).toHaveAccessibleName(part);
      await expect(bars.nth(index)).toHaveAttribute('aria-valuetext', /age cap \d+/);
    }
    await expect(page.getByRole('meter', { name: 'Fatigue' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fit to work' })).toBeVisible();
    await expect(
      page.getByText(/^Medical care: Altura Wrestling Entertainment, level \d$/),
    ).toBeVisible();

    // The shot starts at the tab strip, so the tab itself fills the screen.
    await page
      .getByRole('tablist')
      .first()
      .evaluate((strip) => {
        strip.scrollIntoView({ block: 'start' });
      });
    await shot(page, 'health-tab', testInfo.project.name);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await condition.getByRole('button', { name: /^Why is Legs: age cap \d+\?$/ }).click();
    const why = page.getByRole('dialog', { name: 'Legs: age cap' });
    await expect(why).toBeVisible();
    await expect(why.getByText('Healing cap for their age').first()).toBeVisible();
    await shot(page, 'health-tab-why', testInfo.project.name);
    await expectNoSeriousA11yViolations(page);
    await page.keyboard.press('Escape');
    await expect(why).toBeHidden();

    if (phone) {
      await page.setViewportSize(SMALL_PHONE);
      await expect(condition).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
});
