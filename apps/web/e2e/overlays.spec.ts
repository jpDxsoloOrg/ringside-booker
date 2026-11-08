/**
 * The Radix-based overlays and menus from their gallery entries, on desktop and phone: each one
 * opens and closes from the pointer and the keyboard, stays inside the screen at 390px, hands focus
 * back to its trigger, and has no serious accessibility issues while open.
 */
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const GALLERY_PATH = '/dev/gallery';

/** The panel that holds the selected entry. */
const ENTRY_PANEL = '#gallery-entry';

/** Opens one gallery entry by deep link, with motion off so boxes are final at once. */
async function gotoEntry(page: Page, entryId: string, entryTitle: string): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${GALLERY_PATH}#${entryId}`);
  await expect(
    page.getByRole('heading', { level: 2, name: entryTitle, exact: true }),
  ).toBeVisible();
  return page.locator(ENTRY_PANEL);
}

/** Fails unless the element's box lies wholly inside the viewport. */
async function expectInsideViewport(page: Page, element: Locator, what: string): Promise<void> {
  const viewport = page.viewportSize();
  const box = await element.boundingBox();
  expect(viewport, 'the page has a viewport').not.toBeNull();
  expect(box, `${what} is rendered`).not.toBeNull();
  if (viewport === null || box === null) return;
  expect(box.x, `${what} left edge`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${what} top edge`).toBeGreaterThanOrEqual(0);
  expect(Math.round(box.x + box.width), `${what} right edge`).toBeLessThanOrEqual(viewport.width);
  expect(Math.round(box.y + box.height), `${what} bottom edge`).toBeLessThanOrEqual(
    viewport.height,
  );
}

test.describe('overlays and menus', () => {
  test('a tooltip shows on keyboard focus and hides on Escape', async ({ page }) => {
    const entry = await gotoEntry(page, 'tooltip', 'Tooltip');
    const trigger = entry.getByRole('button', { name: 'Next day' });

    await trigger.focus();
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toHaveText('Advance one day');
    await expect(trigger).toHaveAccessibleDescription('Advance one day');
    const bubble = page.locator('[data-radix-popper-content-wrapper]').first();
    await expectInsideViewport(page, bubble, 'the tooltip');

    await page.keyboard.press('Escape');
    await expect(tooltip).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test('a tooltip shows on hover and hides when the pointer leaves', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'Touch screens have no hover; focus shows tooltips there.');
    const entry = await gotoEntry(page, 'tooltip', 'Tooltip');

    await entry.getByRole('button', { name: 'Hint right' }).hover();
    await expect(page.getByRole('tooltip')).toHaveText('Shown on the right');

    // Move away in steps, as a real pointer does, so it leaves the path to the tooltip.
    await page.mouse.move(5, 5, { steps: 5 });
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });

  test('a popover opens on click, fits the screen, and Escape returns focus', async ({ page }) => {
    const entry = await gotoEntry(page, 'popover', 'Popover');
    const trigger = entry.getByRole('button', { name: 'Attendance breakdown' });

    await trigger.click();
    const popover = page.getByRole('dialog', { name: 'Attendance' });
    await expect(popover).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(popover).toBeFocused();
    await expectInsideViewport(page, popover, 'the popover');
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page, { include: ['[role="dialog"]'] });

    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('a popover closes from its Close button and on a click outside', async ({ page }) => {
    const entry = await gotoEntry(page, 'popover', 'Popover');
    const trigger = entry.getByRole('button', { name: 'Roster filters' });
    const popover = page.getByRole('dialog', { name: 'Show on the roster' });

    await trigger.click();
    await expect(popover).toBeVisible();
    await expect(popover.getByRole('switch', { name: 'Injured workers' })).toBeFocused();
    await expect(entry.getByText('Open', { exact: true })).toBeVisible();
    await popover.getByRole('button', { name: 'Close' }).click();
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.click();
    await expect(popover).toBeVisible();
    await page.getByRole('heading', { level: 1, name: 'Component gallery' }).click();
    await expect(popover).toBeHidden();
    await expect(entry.getByText('Closed', { exact: true })).toBeVisible();
  });

  test('a dropdown menu opens from the keyboard and moves with the arrows', async ({ page }) => {
    const entry = await gotoEntry(page, 'dropdown-menu', 'DropdownMenu');
    const trigger = entry.getByRole('button', { name: 'Actions', exact: true });

    await trigger.focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Worker actions' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'View profile' })).toBeFocused();
    await expectInsideViewport(page, menu, 'the menu');
    await expectNoSeriousA11yViolations(page, { include: ['[role="menu"]'] });

    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Book on next show' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(menu.getByRole('menuitem', { name: 'Release' })).toBeFocused();
    // The disabled "Give a title shot" is skipped on the way back up.
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitem', { name: 'Renegotiate contract' })).toBeFocused();
    // And the list wraps from the top to the bottom.
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowUp');
    await expect(menu.getByRole('menuitem', { name: 'Release' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('a row menu opened by click fits the screen and runs the chosen action', async ({
    page,
  }) => {
    const entry = await gotoEntry(page, 'dropdown-menu', 'DropdownMenu');

    await entry.getByRole('button', { name: 'More actions' }).click();
    const menu = page.getByRole('menu', { name: 'More actions for this row' });
    await expect(menu).toBeVisible();
    await expectInsideViewport(page, menu, 'the row menu');
    await expectNoHorizontalScroll(page);

    await menu.getByRole('menuitem', { name: 'Renegotiate contract' }).click();
    await expect(menu).toBeHidden();
    await expect(entry.getByText('Chose: Renegotiate contract.')).toBeVisible();
  });

  test('a select opens below its field, fits the screen and picks with the keyboard', async ({
    page,
  }) => {
    const entry = await gotoEntry(page, 'select', 'Select');
    const field = entry.getByRole('combobox', { name: 'Match type' });

    await field.click();
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await expectInsideViewport(page, listbox, 'the option list');
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page, { include: ['[role="listbox"]'] });

    await page.keyboard.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(field).toBeFocused();
    await expect(field).toHaveText('Singles');

    await page.keyboard.press('Enter');
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole('option', { name: 'Singles' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(listbox.getByRole('option', { name: 'Tag team' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(listbox).toBeHidden();
    await expect(field).toHaveText('Tag team');
    await expect(entry.getByText('Chosen: tag')).toBeVisible();
  });

  test('a switch toggles with Space and with a tap on its label', async ({ page }) => {
    const entry = await gotoEntry(page, 'switch', 'Switch');
    const toggle = entry.getByRole('switch', { name: 'Autosave' });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');

    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expect(entry.getByText('Autosave is off.')).toBeVisible();

    await entry.getByText('Pause on injuries').click();
    await expect(entry.getByRole('switch', { name: 'Pause on injuries' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
