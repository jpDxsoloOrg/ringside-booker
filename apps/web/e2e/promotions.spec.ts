/**
 * World > Promotions in a real game (the sample save: the player's promotion and one computer-run
 * rival): the list with who runs each, then the rival's profile through its four tabs. Every
 * step has to fit a 390px phone with no sideways scroll and pass the accessibility scan.
 */
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromSampleSave, openPromotions } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const RIVAL = 'Test Promotion B';

test.describe('World > Promotions', () => {
  test('lists the promotions and walks a rival’s profile', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await enterGameFromSampleSave(page);
    await openPromotions(page, phone);

    await expect(page.getByRole('link', { name: 'Test Promotion A' })).toBeVisible();
    await expect(page.getByRole('link', { name: RIVAL })).toBeVisible();
    await expect(page.getByText('You', { exact: true })).toBeVisible();
    await expect(page.getByText('Computer', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rival rules: 7 on' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('link', { name: RIVAL }).click();
    await expect(page.getByRole('heading', { level: 1, name: RIVAL })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Cash' })).toContainText('Private');
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('tab', { name: 'Roster' }).click();
    await expect(page).toHaveURL(/\?tab=roster$/);
    await page
      .getByRole('button', { name: /^Why is Card value at / })
      .first()
      .click();
    const panel = page.getByRole('dialog', { name: `Card value at ${RIVAL}` });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/aip\.cardValue\./).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    // AIP4-07: the Shows tab. The sample rival has no shows yet, so both lists say so.
    await page.getByRole('tab', { name: 'Shows' }).click();
    await expect(page).toHaveURL(/\?tab=shows$/);
    await expect(page.getByRole('region', { name: 'Recent shows' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Coming up' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('tab', { name: 'Decision log' }).click();
    const entries = page.getByRole('list', { name: 'Decisions, newest first' });
    await expect(entries.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText('1 plan hidden until it airs')).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('Back to Promotions keeps the list’s sort', async ({ page }, testInfo) => {
    await enterGameFromSampleSave(page);
    await openPromotions(page, isPhone(testInfo));
    test.skip(isPhone(testInfo), 'The phone cards sort from a select; the URL logic is the same');

    await page.getByRole('button', { name: 'Name', exact: true }).click();
    await expect(page).toHaveURL(/\?sort=name&dir=asc$/);
    await page.getByRole('link', { name: RIVAL }).click();
    await page.getByRole('link', { name: 'Back to Promotions' }).click();
    await expect(page).toHaveURL(/\/game\/promotions\?sort=name&dir=asc$/);
  });

  // AIP1-07: ECO1's public Company size, a column on desktop and card meta ("Size") on a phone.
  test('shows each promotion’s Company size', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await enterGameFromSampleSave(page);
    await openPromotions(page, phone);

    const sizes = 'Local|Regional|National|Continental|Global';
    if (phone) {
      await expect(page.getByText(new RegExp(`^Size (${sizes})$`)).first()).toBeVisible();
    } else {
      await expect(page.getByRole('columnheader', { name: /Company size/ })).toBeVisible();
      await expect(page.getByText(new RegExp(`^(${sizes})$`)).first()).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await page.getByRole('link', { name: RIVAL }).click();
    await expect(page.getByRole('group', { name: 'Company size' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
