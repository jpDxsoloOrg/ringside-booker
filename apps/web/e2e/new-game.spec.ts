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
import { expect, test } from './fixtures';
import {
  choose,
  chooseExistingPromotion,
  expectPhoneStepLayout,
  expectPromotionInTopBar,
  next,
  openWizard,
  stepHeading,
} from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const EXISTING_PROMOTION = 'Ashlar Pro Wrestling';
const EXISTING_SAVE = 'ASHLAR 2027';
const FOUNDED_NAME = 'Lakeshore Wrestling Alliance';
const FOUNDED_SHORT_NAME = 'LWA';
const FOUNDED_SAVE = 'LWA 2027';
const PLAYER_NAME = 'Alex Booker';

test.describe('new game', () => {
  test('starts as an existing promotion and lands in its office', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await openWizard(page, phone);
    await next(page);

    await expect(stepHeading(page, 'Choose your promotion')).toBeVisible();
    await expectPhoneStepLayout(page, phone);
    await chooseExistingPromotion(page, EXISTING_PROMOTION, phone);
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

    // The Office's partner panels (DAY2-06): the next show with a calendar link, and no results
    // before the first show. Both fit the phone's single column without sideways scroll.
    const nextShow = page.getByRole('region', { name: 'Next show' });
    await expect(nextShow.getByRole('link', { name: 'Open calendar' })).toBeVisible();
    await expect(nextShow.getByText(/main slots/u)).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'Last show' }).getByText('No shows yet'),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
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
