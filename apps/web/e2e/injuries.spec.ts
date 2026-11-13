/**
 * Who is out (WRK6-06), on desktop, phone and phone-webkit:
 *
 * - a new game on the default world as Altura: World > Workers' "Injured" quick filter and the
 *   roster's Injuries tab both say nobody is hurt (a new world has no injuries), without an error;
 * - the injury save (`fixtures/build-injury-save.ts`): Next day hurts one of the player's own
 *   wrestlers, the day stops with a "Roster" button, and that button opens the Injuries tab, which
 *   clears the stop so the day control reads "Next day" again. The worker is then on the list and
 *   on Workers > Injured with the injury and the return date.
 *
 * Each screen has no sideways scroll and no serious axe findings.
 */
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { openRoster, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';

const PROMOTION = 'Altura Wrestling Entertainment';

/** A new game builds the default world in the worker; each flow runs in one test. */
const FLOW_TIMEOUT_MS = 240_000;

const INJURY_SAVE_PATH = fileURLToPath(new URL('./fixtures/sample-injury.rbsave', import.meta.url));
const INJURY_SLOT_LABEL = 'Injury save (imported)';

function dayButton(page: Page, name: string | RegExp): Locator {
  return page.getByTestId('day-control').getByRole('button', { name });
}

async function enterGameFromInjurySave(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
  await page.getByTestId('import-save-input').setInputFiles(INJURY_SAVE_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();
  await page
    .getByRole('article', { name: INJURY_SLOT_LABEL, exact: true })
    .getByRole('button', { name: `Load ${INJURY_SLOT_LABEL}` })
    .click();
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

test.describe('who is out', () => {
  test('a new world: Workers > Injured and the Injuries tab say nobody is hurt', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    await startDefaultWorldGame(page, PROMOTION);

    await navigateInApp(page, '/game/workers');
    await expect(page.locator('h1')).toHaveText('Workers');
    const injured = page.getByRole('button', { name: 'Injured' });
    await injured.click();
    await expect(page).toHaveURL(/\?availability=injured$/);
    await expect(injured).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('heading', { name: 'Nobody is injured' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await openRoster(page, testInfo);
    await page.getByRole('tab', { name: /^Injuries/ }).click();
    await expect(page).toHaveURL(/\?tab=injuries$/);
    await expect(page.getByRole('heading', { name: 'Nobody is injured' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('your wrestler gets hurt, the day stops on Roster, and the Injuries tab clears it', async ({
    page,
  }) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    await enterGameFromInjurySave(page);

    await dayButton(page, 'Next day').click();
    const roster = dayButton(page, 'Roster');
    await expect(roster).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalScroll(page);
    await roster.click();

    await expect(page).toHaveURL(/\/game\/roster\?tab=injuries$/);
    await expect(page.getByRole('tab', { name: /^Injuries/, selected: true })).toBeVisible();
    const list = page.getByRole('tabpanel');
    const healthLinks = list.locator('a[href*="?tab=health"]');
    await expect(healthLinks.first()).toBeVisible();
    await expect(list.getByText(/days? left|Back today/).first()).toBeVisible();
    // Seen: the stop is gone.
    await expect(dayButton(page, 'Next day')).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    const name = (await healthLinks.first().textContent()) ?? '';
    await navigateInApp(page, '/game/workers?availability=injured');
    await expect(page.locator('h1')).toHaveText('Workers');
    await expect(page.getByRole('button', { name: 'Injured' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('main').getByText(name, { exact: true }).first()).toBeVisible();
    await expect(
      page
        .getByRole('main')
        .getByText(/ · (\d+ days? left|Back today)$/)
        .first(),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });
});
