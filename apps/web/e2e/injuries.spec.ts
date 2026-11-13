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
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromInjurySave, openRoster, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';

const PROMOTION = 'Altura Wrestling Entertainment';

/** A new game builds the default world in the worker; each flow runs in one test. */
const FLOW_TIMEOUT_MS = 240_000;

function dayButton(page: Page, name: string | RegExp): Locator {
  return page.getByTestId('day-control').getByRole('button', { name });
}

test.describe('who is out', () => {
  test('a new world: Workers > Injured and the Injuries tab say nobody is hurt', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    await startDefaultWorldGame(page, PROMOTION);

    await navigateInApp(page, '/game/workers');
    await expect(page.locator('h1')).toHaveText('Workers');
    const injured = page.getByRole('button', { name: 'Injured', exact: true });
    await injured.click();
    await expect(page).toHaveURL(/\?availability=injured$/);
    await expect(injured).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('Nobody is injured', { exact: true })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await openRoster(page, testInfo);
    await page.getByRole('tab', { name: /^Injuries/ }).click();
    await expect(page).toHaveURL(/\?tab=injuries$/);
    await expect(page.getByText('Nobody is injured', { exact: true })).toBeVisible();
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
    await expect(list.getByText(/days left|Back today|Back tomorrow/).first()).toBeVisible();
    // Seen: the stop is gone.
    await expect(dayButton(page, 'Next day')).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    const name = (await healthLinks.first().textContent()) ?? '';
    await navigateInApp(page, '/game/workers?availability=injured');
    await expect(page.locator('h1')).toHaveText('Workers');
    await expect(page.getByRole('button', { name: 'Injured', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByRole('main').getByText(name, { exact: true }).first()).toBeVisible();
    await expect(
      page
        .getByRole('main')
        .getByText(/ · (\d+ days left|Back today|Back tomorrow)$/)
        .first(),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });
});
