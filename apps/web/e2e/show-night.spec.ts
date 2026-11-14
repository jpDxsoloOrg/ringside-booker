/**
 * Live show night (EVT10-02), in a new default-world game as Altura on the Live setting (the
 * default):
 *
 * 1. The day stops on the first show night; the card is auto-filled and every winner picked.
 * 2. The day bar's **Go live** opens show night: the running order, the "Show so far" bug, Run next
 *    segment, Sim the rest and Leave and finish later. Run next segment (Enter on desktop) shows
 *    the opener's report and marks it done.
 * 3. Leave and finish later, then Main menu, a reload and Continue: the day bar reads **Back to the
 *    show** and show night resumes at the next segment.
 * 4. Sim the rest of the show ends it: "Show's over" with the final score, then the results.
 *
 * Each show night state fits the screen with no sideways scroll and no serious axe findings, on
 * desktop and phone (Chromium and WebKit).
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { dayBarButtons, pickWinners, SHOW_STOP } from './helpers/booking';
import { dayButton } from './helpers/contracts';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { fillTheRest, openBooking, skipToShowNight } from './helpers/storylines';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';

/** Building the world, skipping to the first show and running it take a while. */
const GAME_TIMEOUT_MS = 300_000;

async function expectFits(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
}

/** Leaves the game through Main menu, which saves: the sidebar on desktop, More on a phone. */
async function leaveToMainMenu(page: Page, phone: boolean): Promise<void> {
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

function runningOrder(page: Page) {
  return page.getByRole('list', { name: 'Running order' });
}

/** Opens the phone's folded running order strip, if it is folded. */
async function openRunningOrder(page: Page, phone: boolean): Promise<void> {
  if (!phone) return;
  const toggle = page.getByRole('button', { name: /^Running order/ });
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click();
}

test('live show night: go live, run a segment, leave, come back after a reload, sim the rest', async ({
  page,
}, testInfo) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  const phone = isPhone(testInfo);

  await test.step('book the first show night', async () => {
    await startDefaultWorldGame(page, ALTURA, { phone });
    await skipToShowNight(page, phone);
    await openBooking(page);
    await fillTheRest(page);
    await pickWinners(page, phone);
    await expect(
      page.getByRole('main').getByRole('button', { name: 'Go live' }).last(),
    ).toBeEnabled();
  });

  await test.step('Go live opens show night, ready to run', async () => {
    await dayButton(page, /Go live$/).click();
    await expect(page).toHaveURL(/\/game\/show-night\/evi_/);
    await expect(page.getByRole('heading', { name: 'Ready to go live' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Show so far' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run next segment' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Sim the rest of the show' })).toBeEnabled();
    await expect(
      page.getByRole('group', { name: 'Show night controls' }).getByText(/^Up next/),
    ).toBeVisible();
    await openRunningOrder(page, phone);
    await expect(runningOrder(page).getByText('Up next')).toHaveCount(1);
    await expectFits(page);
  });

  await test.step('Run next segment shows its report and marks it done', async () => {
    if (phone) {
      await page.getByRole('button', { name: 'Run next segment' }).click();
    } else {
      // Enter runs the next segment from anywhere that does not take Enter itself.
      await page.locator('h1').first().click();
      await page.keyboard.press('Enter');
    }
    const report = page.getByRole('region', { name: /^Just now/ });
    await expect(report).toBeVisible();
    await expect(report.getByRole('article')).toBeVisible();
    await expect(report.getByText('Segment score')).toBeVisible();
    await openRunningOrder(page, phone);
    await expect(runningOrder(page).getByText('Done')).toHaveCount(1);
    await expect(page.getByRole('group', { name: 'Show so far' })).toContainText('1/');
    await expectFits(page);
  });

  await test.step('leave, save through Main menu, reload and come back', async () => {
    await page.getByRole('button', { name: 'Leave and finish later' }).click();
    await expect(page).not.toHaveURL(/show-night/);
    await expect(dayButton(page, /Back to the show$/)).toBeVisible();
    await leaveToMainMenu(page, phone);
    await page.reload();
    await page.getByRole('button', { name: /^Continue/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await dayButton(page, /Back to the show$/).click();
    await expect(page).toHaveURL(/\/game\/show-night\/evi_/);
    await openRunningOrder(page, phone);
    await expect(runningOrder(page).getByText('Done')).toHaveCount(1);
    await expect(runningOrder(page).getByText('Up next')).toHaveCount(1);
    await expect(page.getByRole('region', { name: /^Just now/ })).toBeVisible();
  });

  await test.step('Sim the rest ends the show and opens the results', async () => {
    await page.getByRole('button', { name: 'Sim the rest of the show' }).click();
    const over = page.getByRole('region', { name: "Show's over" });
    await expect(over).toBeVisible();
    await expect(over).toContainText('Final score');
    await expect(page.getByRole('group', { name: 'Final score' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run next segment' })).toHaveCount(0);
    await expectFits(page);
    await over.getByRole('button', { name: 'See the results' }).click();
    await expect(page).toHaveURL(/\/game\/event-history\/evi_/);
    // The show-day stop is gone (a worker hurt in the show may leave the Roster stop instead).
    await expect(dayButton(page, dayBarButtons('Roster', 'Contracts'))).toBeVisible();
    await expect(dayButton(page, SHOW_STOP)).toHaveCount(0);
  });
});
