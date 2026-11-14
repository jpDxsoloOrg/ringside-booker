/**
 * The roster picker's champion belts and Storylines filter (EVT2-13), from the gallery's picker,
 * on desktop, phone and phone-webkit.
 *
 * - A champion's row has a belt named "Champion: <title>", and the title in words under the name;
 *   a tag team that holds a title has one too.
 * - The Storylines menu offers the segment's linked storyline first, narrows the list to one
 *   storyline's members (both sides) or to anyone in one, and says how many it hides.
 * - On a phone the chip and the menu's choices are at least 44px tall, and nothing scrolls
 *   sideways.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

/** The smallest tap target on a phone. */
const TAP_TARGET_PX = 44;

async function heightPx(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  return box?.height ?? 0;
}

/** Opens the gallery's roster picker on people or teams. */
async function openPicker(page: Page, button: 'Pick a wrestler' | 'Pick a team'): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dev/gallery#roster-picker');
  await expect(
    page.getByRole('heading', { level: 2, name: 'RosterPicker', exact: true }),
  ).toBeVisible();
  await page.locator('#gallery-entry').getByRole('button', { name: button }).click();
  const picker = page.getByRole('dialog', { name: 'Add to Side 1' });
  await expect(picker).toBeVisible();
  return picker;
}

test.describe('roster picker: champions and storylines', () => {
  test('a champion and a title-holding team wear a belt', async ({ page }) => {
    const picker = await openPicker(page, 'Pick a wrestler');
    const champ = picker.getByRole('option', { name: /Rhea Cortez/ });
    await expect(
      champ.getByRole('img', { name: 'Champion: Coastal Crown Championship' }),
    ).toBeVisible();
    await expect(champ).toContainText('Coastal Crown Championship');
    await expect(
      picker.getByRole('option', { name: /Jo Park/ }).getByRole('img', { name: /^Champion/ }),
    ).toHaveCount(0);

    await picker.getByRole('button', { name: 'Teams' }).click();
    await expect(
      picker
        .getByRole('option', { name: /The Hale Storm/ })
        .getByRole('img', { name: 'Champion: Coastal Tag Team Championship' }),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('the Storylines menu narrows the list and fits', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    const picker = await openPicker(page, 'Pick a wrestler');
    const chip = picker.getByRole('button', { name: 'Storylines' });
    if (phone) expect(await heightPx(chip)).toBeGreaterThanOrEqual(TAP_TARGET_PX);
    await chip.click();

    const menu = page.getByRole('dialog', { name: 'Show by storyline' });
    await expect(menu).toBeVisible();
    // The segment links The Crown Chase, so it comes first.
    await expect(menu.getByRole('radio')).toHaveCount(4);
    await expect(menu.getByText('In this segment')).toBeVisible();
    const crown = menu.getByRole('radio', { name: /The Crown Chase/ });
    if (phone) {
      const item = menu.locator('label').filter({ has: crown });
      expect(await heightPx(item)).toBeGreaterThanOrEqual(TAP_TARGET_PX);
    }
    await expectNoHorizontalScroll(page);
    await crown.check();
    await page.keyboard.press('Escape');

    await expect(picker.getByRole('button', { name: 'Storyline: The Crown Chase' })).toBeVisible();
    await expect(picker.getByRole('option')).toHaveCount(2);
    await expect(picker.getByRole('option', { name: /Rhea Cortez/ })).toContainText('Face');
    await expect(picker.getByRole('option', { name: /Jo Park/ })).toContainText('Heel');
    await expect(picker.getByText(/hidden by the Storylines filter/)).toBeVisible();

    await picker.getByRole('button', { name: 'Storyline: The Crown Chase' }).click();
    await page
      .getByRole('dialog', { name: 'Show by storyline' })
      .getByRole('radio', { name: 'Any storyline' })
      .check();
    await page.keyboard.press('Escape');
    await expect(picker.getByRole('option', { name: /Kai Moreno/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
