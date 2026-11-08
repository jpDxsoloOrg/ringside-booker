/**
 * The component gallery at /dev/gallery, on desktop and phone: the page fits the viewport, has no
 * serious accessibility issues in either theme, every enabled button can be reached with Tab, and
 * on a phone the buttons meet the touch target and the panels run edge to edge. The interactive
 * primitives (Tabs, Sheet, ConfirmDialog) are opened and driven from the keyboard here too.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const GALLERY_PATH = '/dev/gallery';

/** Anchor ids of the gallery sections; each one is a Panel. */
const SECTION_IDS = [
  'gallery-button',
  'gallery-icon',
  'gallery-panel',
  'gallery-badge',
  'gallery-stat-bar',
  'gallery-empty-state',
  'gallery-layout',
  'gallery-format',
  'gallery-image-slot',
  'gallery-tabs',
  'gallery-sheet',
  'gallery-confirm-dialog',
] as const;

/** The smallest touch target, 2.75rem at the default 16px root size. */
const TAP_TARGET_MIN_PX = 44;

/** Attribute the keyboard test stamps on each button so it can tell them apart. */
const TAB_PROBE_ATTRIBUTE = 'data-tab-probe';

/** A bottom sheet on a phone is capped at 85% of the viewport height. */
const BOTTOM_SHEET_MAX_HEIGHT_RATIO = 0.85;

/** Opens a sheet from the gallery's Sheet section, with motion off so its box is final at once. */
async function openSheet(
  page: Page,
  openerName: string,
): Promise<{ opener: Locator; sheet: Locator }> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const opener = page.locator('#gallery-sheet').getByRole('button', { name: openerName });
  await opener.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return { opener, sheet };
}

/** Alpha of a computed CSS colour such as `rgba(29, 28, 26, 0.6)`; 1 for an opaque `rgb()`. */
function colourAlpha(colour: string): number {
  const channels = colour.match(/[\d.]+/g) ?? [];
  return channels.length >= 4 ? Number(channels[3]) : 1;
}

test.describe('component gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(GALLERY_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
  });

  test('has a section anchor for every primitive', async ({ page }) => {
    for (const sectionId of SECTION_IDS) {
      await expect(page.locator(`#${sectionId}`)).toBeVisible();
    }
  });

  test('fits the viewport with no horizontal scroll', async ({ page }) => {
    await expectNoHorizontalScroll(page);
  });

  test('has no serious accessibility issues in the light theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await expectNoSeriousA11yViolations(page);
  });

  test('has no serious accessibility issues in the dark theme', async ({ page }) => {
    await page.getByRole('button', { name: 'dark', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await expectNoSeriousA11yViolations(page);
  });

  test('reaches every enabled button with the Tab key', async ({ page }) => {
    const buttonCount = await page.evaluate((probeAttribute) => {
      // Unselected tabs use a roving tabindex: the arrow keys reach them, not Tab.
      const buttons = Array.from(
        document.querySelectorAll('main button:not([disabled]):not([tabindex="-1"])'),
      );
      buttons.forEach((button, index) => {
        button.setAttribute(probeAttribute, String(index));
      });
      return buttons.length;
    }, TAB_PROBE_ATTRIBUTE);
    expect(buttonCount).toBeGreaterThan(20);

    const focusableCount = await page.evaluate(
      () => document.querySelectorAll('main a[href], main button:not([disabled])').length,
    );
    const reached = new Set<string>();
    // Start before the first element so the first Tab lands on the page's first control.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    for (let step = 0; step < focusableCount + 5 && reached.size < buttonCount; step += 1) {
      await page.keyboard.press('Tab');
      const probe = await page.evaluate(
        (probeAttribute) => document.activeElement?.getAttribute(probeAttribute) ?? null,
        TAB_PROBE_ATTRIBUTE,
      );
      if (probe !== null) {
        reached.add(probe);
      }
    }

    const missed = await page.evaluate(
      ({ probeAttribute, reachedProbes }) =>
        Array.from(document.querySelectorAll(`[${probeAttribute}]`))
          .filter((button) => !reachedProbes.includes(button.getAttribute(probeAttribute) ?? ''))
          .map((button) => button.getAttribute('aria-label') ?? button.textContent),
      { probeAttribute: TAB_PROBE_ATTRIBUTE, reachedProbes: Array.from(reached) },
    );
    expect(missed, 'Buttons the Tab key never reached').toEqual([]);
  });

  test('toggles a collapsible panel with Enter and Space', async ({ page }) => {
    const toggle = page.getByRole('button', { name: 'Collapsible panel' });
    const body = page.getByText('Enter or Space on the title shows and hides this.');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.focus();
    await page.keyboard.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(body).toBeHidden();

    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(body).toBeVisible();
  });

  test('every button in the Button section meets the touch target on a phone', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Touch targets apply to the phone projects.');

    const buttons = page.locator('#gallery-button button');
    const count = await buttons.count();
    expect(count).toBeGreaterThan(20);

    const shortButtons: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const button = buttons.nth(index);
      const box = await button.boundingBox();
      if (box === null || box.height < TAP_TARGET_MIN_PX) {
        const name = (await button.getAttribute('aria-label')) ?? (await button.innerText());
        shortButtons.push(`${name}: ${box === null ? 'not rendered' : `${String(box.height)}px`}`);
      }
    }
    expect(shortButtons, `Buttons shorter than ${String(TAP_TARGET_MIN_PX)}px`).toEqual([]);
  });

  test('panels run edge to edge on a phone', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Full-bleed panels are the phone layout.');

    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    for (const sectionId of SECTION_IDS) {
      const panel = page.locator(`#${sectionId}`);
      const box = await panel.boundingBox();
      expect(box, `#${sectionId} is rendered`).not.toBeNull();
      expect(box?.x, `#${sectionId} starts at the left edge`).toBe(0);
      expect(box?.width, `#${sectionId} spans the viewport`).toBe(viewportWidth);

      const sideMargins = await panel.evaluate((element) => {
        const computed = window.getComputedStyle(element);
        return [computed.marginLeft, computed.marginRight];
      });
      expect(sideMargins, `#${sectionId} side margins`).toEqual(['0px', '0px']);
    }
  });

  test('a right sheet slides in on the right over the page, and Escape returns focus', async ({
    page,
  }, testInfo) => {
    test.skip(isPhone(testInfo), 'On a phone every sheet is a bottom sheet.');

    const { opener, sheet } = await openSheet(page, 'Open right md');
    await expect(sheet).toHaveAttribute('data-side', 'right');
    await expect(sheet.getByRole('heading', { name: 'Right sheet (md)' })).toBeVisible();

    const viewport = page.viewportSize();
    const sheetBox = await sheet.boundingBox();
    expect(viewport).not.toBeNull();
    expect(sheetBox).not.toBeNull();
    if (viewport === null || sheetBox === null) return;
    expect(Math.round(sheetBox.x + sheetBox.width), 'right edge').toBe(viewport.width);
    expect(sheetBox.x, 'leaves the page showing on the left').toBeGreaterThan(viewport.width / 2);
    expect(Math.round(sheetBox.height)).toBe(viewport.height);

    // The page heading sits beside the sheet, under a see-through backdrop.
    const headingBox = await page
      .getByRole('heading', { level: 1, name: 'Component gallery' })
      .boundingBox();
    expect(headingBox).not.toBeNull();
    expect(headingBox?.x ?? Number.POSITIVE_INFINITY).toBeLessThan(sheetBox.x);
    const backdropColour = await sheet.evaluate(
      (element) => window.getComputedStyle(element, '::backdrop').backgroundColor,
    );
    expect(colourAlpha(backdropColour), `backdrop ${backdropColour}`).toBeGreaterThan(0);
    expect(colourAlpha(backdropColour), `backdrop ${backdropColour}`).toBeLessThan(1);

    // Focus starts inside the sheet and the page behind it stops scrolling.
    await expect(sheet.getByRole('button', { name: 'Release worker' })).toBeFocused();
    await expect(page.locator('html')).toHaveClass(/scroll-locked/);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
    await expect(page.locator('html')).not.toHaveClass(/scroll-locked/);
  });

  test('a backdrop click closes the sheet', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'The phone sheet leaves only a strip of backdrop.');

    const { opener, sheet } = await openSheet(page, 'Open left sm');
    await expect(sheet).toHaveAttribute('data-side', 'left');

    const viewport = page.viewportSize();
    await page.mouse.click((viewport?.width ?? 0) - 20, (viewport?.height ?? 0) / 2);
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('on a phone a right sheet opens from the bottom and scrolls inside itself', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Bottom sheets replace side sheets on phones.');

    const { opener, sheet } = await openSheet(page, 'Open right md');
    await expect(sheet).toHaveAttribute('data-side', 'bottom');

    const viewport = page.viewportSize();
    const sheetBox = await sheet.boundingBox();
    expect(viewport).not.toBeNull();
    expect(sheetBox).not.toBeNull();
    if (viewport === null || sheetBox === null) return;
    expect(sheetBox.x).toBeGreaterThanOrEqual(0);
    expect(sheetBox.y).toBeGreaterThanOrEqual(0);
    expect(Math.round(sheetBox.width)).toBe(viewport.width);
    expect(Math.round(sheetBox.y + sheetBox.height), 'bottom edge').toBe(viewport.height);
    expect(sheetBox.height).toBeLessThanOrEqual(
      viewport.height * BOTTOM_SHEET_MAX_HEIGHT_RATIO + 1,
    );

    const pageScrollBefore = await page.evaluate(() => window.scrollY);
    const body = sheet.locator('[data-sheet-body]');
    const scroll = await body.evaluate((element) => {
      const overflow = element.scrollHeight - element.clientHeight;
      element.scrollTop = overflow;
      return { overflow, scrollTop: element.scrollTop };
    });
    expect(scroll.overflow, 'the body has more content than fits').toBeGreaterThan(0);
    expect(scroll.scrollTop, 'the body scrolled').toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollBefore);
    await expect(sheet.getByRole('button', { name: 'Save notes' })).toBeInViewport();

    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('an open sheet has no serious accessibility issues', async ({ page }) => {
    const { sheet } = await openSheet(page, 'Open bottom lg');
    await expect(sheet).toHaveAttribute('data-side', 'bottom');
    await expectNoSeriousA11yViolations(page, { include: ['dialog[open]'] });
  });

  test('a confirm opened from a sheet keeps the page locked until both close', async ({ page }) => {
    const { sheet } = await openSheet(page, 'Open right sm');
    const releaseButton = sheet.getByRole('button', { name: 'Release worker' });
    await releaseButton.click();

    const confirm = page.getByRole('alertdialog', { name: 'Release this worker?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(releaseButton).toBeFocused();
    await expect(page.locator('html')).toHaveClass(/scroll-locked/);

    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page.locator('html')).not.toHaveClass(/scroll-locked/);
  });

  test('the tab strip scrolls sideways inside itself on a phone', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Eight tabs fit the desktop strip.');

    const strip = page.locator('#gallery-tabs [role="tablist"]').first();
    await strip.scrollIntoViewIfNeeded();
    const widths = await strip.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }));
    expect(widths.scrollWidth, 'the tabs overflow the strip').toBeGreaterThan(widths.clientWidth);

    await strip.getByRole('tab', { name: 'Overview' }).click();
    await page.keyboard.press('End');
    const lastTab = strip.getByRole('tab', { name: 'History' });
    await expect(lastTab).toBeFocused();
    await expect(lastTab).toHaveAttribute('aria-selected', 'true');
    await expect(lastTab).toBeInViewport();

    await expect.poll(() => strip.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
    await expectNoHorizontalScroll(page);
  });

  test('manual tabs move focus with the arrows and select on Enter', async ({ page }) => {
    const strip = page.locator('[data-tabs-demo="manual"] [role="tablist"]');
    await strip.getByRole('tab', { name: 'Overview' }).focus();
    await page.keyboard.press('ArrowRight');

    const rosterTab = strip.getByRole('tab', { name: 'Roster' });
    await expect(rosterTab).toBeFocused();
    await expect(rosterTab).toHaveAttribute('aria-selected', 'false');

    await page.keyboard.press('Enter');
    await expect(rosterTab).toHaveAttribute('aria-selected', 'true');
  });

  test('the danger confirm opens centred with Cancel focused', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const opener = page.locator('#gallery-confirm-dialog').getByRole('button', {
      name: 'Delete save',
      exact: true,
    });
    await opener.click();

    const confirm = page.getByRole('alertdialog', { name: 'Delete this save?' });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused();

    // Centred in the viewport.
    const viewport = page.viewportSize();
    const box = await confirm.boundingBox();
    expect(viewport).not.toBeNull();
    expect(box).not.toBeNull();
    if (viewport !== null && box !== null) {
      expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(1);
    }

    await page.keyboard.press('Escape');
    await expect(confirm).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('a confirm whose action fails stays open and shows the error', async ({ page }) => {
    await page
      .locator('#gallery-confirm-dialog')
      .getByRole('button', { name: 'Delete locked save' })
      .click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete the locked save?' });
    await confirm.getByRole('button', { name: 'Delete anyway' }).click();

    await expect(confirm.getByRole('alert')).toContainText('locked by another tab');
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Delete anyway' })).toBeEnabled();
  });

  test('confirm buttons stack full width with touch-sized targets on a phone', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Stacked buttons are the phone layout.');

    // No open animation, so the buttons are measured at full size.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page
      .locator('#gallery-confirm-dialog')
      .getByRole('button', { name: 'Advance a week' })
      .click();
    const confirm = page.getByRole('alertdialog', { name: 'Advance to next week?' });
    await expect(confirm).toBeVisible();

    const cancelBox = await confirm.getByRole('button', { name: 'Cancel' }).boundingBox();
    const confirmBox = await confirm.getByRole('button', { name: 'Advance' }).boundingBox();
    expect(cancelBox).not.toBeNull();
    expect(confirmBox).not.toBeNull();
    if (cancelBox === null || confirmBox === null) return;
    expect(cancelBox.height).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);
    expect(confirmBox.height).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);
    expect(Math.round(confirmBox.width)).toBe(Math.round(cancelBox.width));
    expect(confirmBox.y, 'stacked, not side by side').toBeGreaterThan(cancelBox.y);
    await expectNoHorizontalScroll(page);
  });
});
