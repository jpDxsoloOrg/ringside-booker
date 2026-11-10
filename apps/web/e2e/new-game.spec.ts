/**
 * The new-game wizard end to end, on desktop and phone, from a fresh browser profile: the default
 * world's packs load in the engine worker, the wizard previews them, and Start game builds the
 * world in the worker, saves it into a slot and opens the office.
 *
 * - Taking over an existing promotion lands on /game/office with its name in the top bar.
 * - Founding a medium promotion with the starter kit and a 3-month season shows a 91-day season 1
 *   on the Review step, runs that promotion, and the save is still listed after a reload.
 * - On the phone every step fits 390px with no sideways scroll and the Back/Next bar stays on
 *   screen.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const EXISTING_PROMOTION = 'Ashlar Pro Wrestling';
const EXISTING_SAVE = 'ASHLAR 2027';
const FOUNDED_NAME = 'Lakeshore Wrestling Alliance';
const FOUNDED_SHORT_NAME = 'LWA';
const FOUNDED_SAVE = 'LWA 2027';
const PLAYER_NAME = 'Alex Booker';

function stepHeading(page: Page, name: string) {
  return page.getByRole('heading', { level: 2, name });
}

/**
 * Every step passes axe. On a phone, the page also fits and the Back/Next bar is on screen above
 * the bottom edge.
 */
async function expectPhoneStepLayout(page: Page, phone: boolean): Promise<void> {
  await expectNoSeriousA11yViolations(page);
  if (!phone) return;
  await expectNoHorizontalScroll(page);
  const bar = page.getByTestId('wizard-actions');
  await expect(bar).toBeInViewport();
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box !== null && viewport !== null) {
    expect(box.y + box.height, 'the action bar ends on screen').toBeLessThanOrEqual(
      viewport.height + 1,
    );
  }
  await expect(page.getByTestId('wizard-progress')).toBeVisible();
}

/** Opens the wizard from the title screen and waits for the world step with the world chosen. */
async function openWizard(page: Page, phone: boolean): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: 'New game' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'New game' })).toBeVisible();
  await expect(stepHeading(page, 'Choose a world')).toBeVisible();
  // The only bundled world is chosen by itself once its preview has loaded.
  await expect(page.getByRole('radio', { name: /Ringside Booker World/ })).toBeChecked();
  await expect(page.getByText('People', { exact: true })).toBeVisible();
  if (phone) await expect(page.getByText('Step 1 of 4 · World')).toBeVisible();
  await expectPhoneStepLayout(page, phone);
}

async function next(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next' }).click();
}

/** Picks an option from one of the wizard's selects. */
async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** The promotion name in the top bar: in the bar on desktop, in its status sheet on a phone. */
async function expectPromotionInTopBar(page: Page, name: string, phone: boolean): Promise<void> {
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  const topBar = page.getByRole('banner');
  if (phone) {
    await topBar.getByTestId('status-date').click();
    await expect(page.getByRole('dialog').getByTestId('promotion-chip')).toHaveText(
      new RegExp(name),
    );
    await page.keyboard.press('Escape');
  } else {
    await expect(topBar.getByTestId('promotion-chip')).toHaveText(new RegExp(name));
    // The sidebar crest follows the save, not the sample promotion (UI-18).
    const crest = page.getByTestId('promotion-block');
    await expect(crest).toContainText(name);
    await expect(crest).not.toContainText('Sample');
    // Popularity explains itself even before a system moves it (UI-19).
    await topBar
      .getByTestId('popularity-chip')
      .getByRole('button', { name: /^Why is / })
      .click();
    await expect(page.getByRole('dialog')).toContainText(
      'Starting popularity from the world you began in',
    );
    await page.keyboard.press('Escape');
  }
}

test.describe('new game', () => {
  test('starts as an existing promotion and lands in its office', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await openWizard(page, phone);
    await next(page);

    await expect(stepHeading(page, 'Choose your promotion')).toBeVisible();
    await expectPhoneStepLayout(page, phone);
    if (phone) {
      await page.getByRole('button', { name: new RegExp(`^${EXISTING_PROMOTION}`) }).click();
      const sheet = page.getByRole('dialog', { name: EXISTING_PROMOTION });
      await expect(sheet.getByText('Best-known wrestlers')).toBeVisible();
      await sheet.getByRole('button', { name: 'Choose this promotion' }).click();
      await expect(sheet).toBeHidden();
    } else {
      await page
        .getByRole('grid')
        .getByRole('row', { name: new RegExp(EXISTING_PROMOTION) })
        .click();
      await expect(
        page.getByRole('heading', { name: `About ${EXISTING_PROMOTION}` }),
      ).toBeVisible();
    }
    await next(page);

    await expect(stepHeading(page, 'Game options')).toBeVisible();
    await expectPhoneStepLayout(page, phone);
    await next(page);

    await expect(stepHeading(page, 'Review and start')).toBeVisible();
    await page.getByRole('textbox', { name: 'Your name' }).fill(PLAYER_NAME);
    await expect(page.getByRole('textbox', { name: 'Save name' })).toHaveValue(EXISTING_SAVE);
    await expectPhoneStepLayout(page, phone);
    await page.getByRole('button', { name: 'Start game' }).click();

    await expectPromotionInTopBar(page, EXISTING_PROMOTION, phone);
  });

  test('founds a promotion with a 3-month season and keeps the save after a reload', async ({
    page,
  }, testInfo) => {
    const phone = isPhone(testInfo);
    await openWizard(page, phone);
    await next(page);

    await expect(stepHeading(page, 'Choose your promotion')).toBeVisible();
    await page.getByRole('button', { name: 'Found your own promotion' }).click();
    await page.getByRole('textbox', { name: 'Promotion name' }).fill(FOUNDED_NAME);
    const shortName = page.getByRole('textbox', { name: 'Short name' });
    await shortName.fill('ashlar');
    await expect(page.getByText('ASHLAR is already taken by another promotion.')).toBeVisible();
    await shortName.fill(FOUNDED_SHORT_NAME.toLowerCase());
    await expect(page.getByText(/already taken/)).toHaveCount(0);
    await choose(page, 'Continent', 'North America');
    await choose(page, 'Country', 'Canada');
    await choose(page, 'Region', 'Ontario');
    await choose(page, 'Style', 'Technical');
    await page.getByRole('radio', { name: 'Medium' }).check();
    await expect(page.getByRole('switch', { name: 'Starter kit' })).toBeChecked();
    await expect(page.getByRole('combobox', { name: 'Weekly show day' })).toBeVisible();
    await expectPhoneStepLayout(page, phone);
    await next(page);

    await expect(stepHeading(page, 'Game options')).toBeVisible();
    const season = page.getByRole('group', { name: 'Season length' });
    await expect(season.getByRole('radio', { name: '12 months' })).toBeChecked();
    await season.getByText('3 months', { exact: true }).click();
    await expect(page.getByTestId('season-one-line')).toContainText('(91 days)');
    await expectPhoneStepLayout(page, phone);
    await next(page);

    await expect(stepHeading(page, 'Review and start')).toBeVisible();
    await expect(page.getByText(/\(91 days\)/)).toBeVisible();
    await expect(
      page.getByText(new RegExp(`${FOUNDED_NAME} \\(${FOUNDED_SHORT_NAME}\\)`)).first(),
    ).toBeVisible();
    await page.getByRole('textbox', { name: 'Your name' }).fill(PLAYER_NAME);
    await expect(page.getByRole('textbox', { name: 'Save name' })).toHaveValue(FOUNDED_SAVE);
    await expectPhoneStepLayout(page, phone);
    await page.getByRole('button', { name: 'Start game' }).click();

    await expectPromotionInTopBar(page, FOUNDED_NAME, phone);

    await page.reload();
    await page.goto('/load');
    await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();
    const slot = page.getByRole('article', { name: FOUNDED_SAVE, exact: true });
    await expect(slot).toBeVisible();
    await expect(slot).toContainText(FOUNDED_NAME);
  });

  test('browser back moves between steps', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await openWizard(page, phone);
    await next(page);
    await expect(stepHeading(page, 'Choose your promotion')).toBeVisible();
    await expect(page).toHaveURL(/\/new\?step=2$/);

    await page.goBack();
    await expect(stepHeading(page, 'Choose a world')).toBeVisible();
    await page.goForward();
    await expect(stepHeading(page, 'Choose your promotion')).toBeVisible();
  });
});
