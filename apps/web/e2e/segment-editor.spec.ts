/**
 * The booking screen's segment editor and its roster picker, from the gallery's static card, on
 * desktop and phone (EVT2-10, EVT2-11). The owner had to pinch-zoom out of the picker on a phone.
 *
 * - The editor fits with no sideways scroll for a tag match with a team and a four-way, with a
 *   long name on a side.
 * - The open picker fits, including its Gender and Push menus, and a long name wraps rather than
 *   being cut off.
 * - On a touch screen the picker's search box and the billing line are at least 16px, so Safari
 *   on iPhone doesn't zoom the page in when they take focus.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const LONG_NAME = 'Maximilian Vandersteenhoven-Kaczmarczyk';

/** Below this, Safari on iPhone zooms the page in when a text field takes focus. */
const NO_ZOOM_FONT_PX = 16;

async function fontSizePx(field: Locator): Promise<number> {
  return field.evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
}

/** Opens the gallery's segment editor entry with motion off and opens one of its demos. */
async function openEditor(page: Page, demo: string): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/dev/gallery#segment-editor');
  await expect(
    page.getByRole('heading', { level: 2, name: 'Segment editor', exact: true }),
  ).toBeVisible();
  await page.locator('#gallery-entry').getByRole('button', { name: demo }).click();
  const editor = page.getByRole('dialog').first();
  await expect(editor).toBeVisible();
  return editor;
}

async function chooseMatchType(page: Page, editor: Locator, name: string): Promise<void> {
  await editor.getByRole('combobox', { name: 'Match type' }).click();
  await page.getByRole('option', { name: new RegExp(`^${name}`) }).click();
}

test.describe('segment editor', () => {
  test('a tag match with a team fits the screen', async ({ page }) => {
    const editor = await openEditor(page, 'Tag match with a title');
    await expect(editor.getByText(/^Team: /).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('a four-way with a long name fits, and the open picker fits', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    const editor = await openEditor(page, 'New match in the opener');
    await chooseMatchType(page, editor, 'Four-Way');
    await expect(editor.getByRole('heading', { name: 'Side 4' })).toBeVisible();

    await editor.getByRole('button', { name: 'Add wrestler' }).first().click();
    const picker = page.getByRole('dialog', { name: 'Add to Side 1' });
    const search = picker.getByRole('combobox', { name: 'Search by name' });
    await expect(search).toBeVisible();
    if (phone) expect(await fontSizePx(search)).toBeGreaterThanOrEqual(NO_ZOOM_FONT_PX);
    const long = picker.getByRole('option', { name: new RegExp(LONG_NAME) });
    await expect(long).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (phone) {
      // The whole name is on screen: it wraps instead of ending in an ellipsis.
      const name = long.getByText(LONG_NAME, { exact: true });
      const clipped = await name.evaluate((element) => element.scrollWidth > element.clientWidth);
      expect(clipped, 'the long name is cut off').toBe(false);
    }

    await picker.getByRole('button', { name: 'Gender' }).click();
    const genderMenu = page.getByRole('dialog', { name: 'Show by gender' });
    await genderMenu.getByRole('radio', { name: 'Non-binary' }).check();
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(genderMenu).toBeHidden();
    await expect(picker.getByRole('button', { name: 'Gender: Non-binary' })).toBeVisible();

    await picker.getByRole('button', { name: 'Push' }).click();
    const pushMenu = page.getByRole('dialog', { name: 'Show by push' });
    await pushMenu.getByRole('checkbox', { name: 'Main event' }).uncheck();
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');
    await expect(picker.getByRole('button', { name: 'Push: 5 chosen' })).toBeVisible();

    // Side 1 takes one wrestler, so picking fills it and closes the picker.
    await long.click();
    await expect(picker).toBeHidden();
    await expect(editor.getByRole('link', { name: LONG_NAME })).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (phone) {
      const billing = editor.getByRole('textbox', { name: 'Billing line' });
      expect(await fontSizePx(billing)).toBeGreaterThanOrEqual(NO_ZOOM_FONT_PX);
    }
  });
});
