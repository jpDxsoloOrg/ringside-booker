/**
 * The component gallery at /dev/gallery, on desktop and phone. Every entry opens without console
 * errors (the fixture fails the test on any), fits the viewport with no horizontal scroll, and has
 * no serious accessibility issues in either theme. On desktop the entry list and the phone frame
 * work; on a phone a select replaces the list, buttons meet the touch target and the entry panel
 * runs edge to edge. The interactive primitives (Tabs, Sheet, ConfirmDialog) are opened from their
 * entries and driven from the keyboard too.
 */
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const GALLERY_PATH = '/dev/gallery';

/** The panel that holds the selected entry. */
const ENTRY_PANEL = '#gallery-entry';

/** The smallest touch target, 2.75rem at the default 16px root size. */
const TAP_TARGET_MIN_PX = 44;

/** Width of the phone frame, in CSS pixels. */
const PHONE_FRAME_WIDTH_PX = 390;

/** Attribute the keyboard test stamps on each button so it can tell them apart. */
const TAB_PROBE_ATTRIBUTE = 'data-tab-probe';

/** A bottom sheet on a phone is capped at 85% of the viewport height. */
const BOTTOM_SHEET_MAX_HEIGHT_RATIO = 0.85;

/** Opens one gallery entry by deep link and waits for its heading. */
async function gotoEntry(page: Page, entryId: string, entryTitle: string): Promise<void> {
  await page.goto(`${GALLERY_PATH}#${entryId}`);
  await expect(
    page.getByRole('heading', { level: 2, name: entryTitle, exact: true }),
  ).toBeVisible();
}

/** Opens a sheet from the gallery's Sheet entry, with motion off so its box is final at once. */
async function openSheet(
  page: Page,
  openerName: string,
): Promise<{ opener: Locator; sheet: Locator }> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoEntry(page, 'sheet', 'Sheet');
  const opener = page.locator(ENTRY_PANEL).getByRole('button', { name: openerName });
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

interface GalleryEntrySummary {
  readonly id: string;
  readonly title: string;
}

/**
 * The entries as the page lists them. The phone select carries every entry on both layouts (it
 * is only hidden on desktop), so it is the one place to read them from.
 */
async function readEntries(page: Page): Promise<readonly GalleryEntrySummary[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('select option'), (option) => ({
      id: option.getAttribute('value') ?? '',
      title: option.textContent,
    })),
  );
}

/** Opens an entry the way a person would on this layout: the list on desktop, the select on a phone. */
async function openEntry(page: Page, entry: GalleryEntrySummary, phone: boolean): Promise<void> {
  if (phone) {
    await page.getByLabel('Entry').selectOption(entry.id);
  } else {
    await page
      .getByRole('navigation', { name: 'Gallery entries' })
      .getByRole('link', { name: entry.title, exact: true })
      .click();
  }
  await expect(page).toHaveURL(new RegExp(`#${entry.id}$`));
  await expect(
    page.getByRole('heading', { level: 2, name: entry.title, exact: true }),
  ).toBeVisible();
}

test.describe('component gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(GALLERY_PATH);
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
  });

  test('lists entries in the tokens, primitives, art and engine groups', async ({ page }) => {
    const entries = await readEntries(page);
    const ids = entries.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining(['tokens-colours', 'button', 'stat-bar', 'art-people', 'engine']),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('shows the entry list on desktop and a select on a phone', async ({ page }, testInfo) => {
    const entryList = page.getByRole('navigation', { name: 'Gallery entries' });
    const picker = page.getByLabel('Entry');
    if (isPhone(testInfo)) {
      await expect(entryList).toBeHidden();
      await expect(picker).toBeVisible();
    } else {
      await expect(entryList).toBeVisible();
      await expect(picker).toBeHidden();
    }
  });

  test('opens every entry without errors, sideways scroll or serious a11y issues', async ({
    page,
  }, testInfo) => {
    test.slow();
    const phone = isPhone(testInfo);
    for (const entry of await readEntries(page)) {
      await test.step(entry.title, async () => {
        await openEntry(page, entry, phone);
        await expectNoHorizontalScroll(page);
        await expectNoSeriousA11yViolations(page);
      });
    }
  });

  test('has no serious accessibility issues in the dark theme', async ({ page }, testInfo) => {
    test.slow();
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const phone = isPhone(testInfo);
    for (const entry of await readEntries(page)) {
      await test.step(entry.title, async () => {
        await openEntry(page, entry, phone);
        await expectNoSeriousA11yViolations(page);
      });
    }
  });

  test('deep links to an entry by #id', async ({ page }) => {
    await page.goto(`${GALLERY_PATH}#stat-bar`);
    await expect(page.getByRole('heading', { level: 2, name: 'StatBar' })).toBeVisible();
  });

  test('switches theme from the toolbar', async ({ page }) => {
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByRole('button', { name: 'System', exact: true }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  });

  test('renders the entry in a 390px phone frame on desktop', async ({ page }, testInfo) => {
    const frameToggle = page.getByRole('button', { name: 'Phone frame' });
    if (isPhone(testInfo)) {
      await expect(frameToggle).toBeHidden();
      return;
    }

    await page.goto(`${GALLERY_PATH}#badge`);
    await page.getByRole('button', { name: 'Dark', exact: true }).click();
    await frameToggle.click();
    await expect(frameToggle).toHaveAttribute('aria-pressed', 'true');

    const frameElement = page.getByTitle('Badge at phone width');
    await expect(frameElement).toBeVisible();
    const box = await frameElement.boundingBox();
    expect(box?.width).toBe(PHONE_FRAME_WIDTH_PX);

    const frame = page.frameLocator('iframe[title="Badge at phone width"]');
    await expect(frame.getByRole('heading', { level: 1, name: 'Badge' })).toBeVisible();
    await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
    const frameFits = await frame
      .locator('html')
      .evaluate((root) => root.scrollWidth <= root.clientWidth);
    expect(frameFits, 'The entry fits the phone frame without sideways scroll').toBe(true);
  });

  test('reaches every enabled button in the Button entry with the Tab key', async ({ page }) => {
    await page.goto(`${GALLERY_PATH}#button`);
    await expect(page.getByRole('heading', { level: 2, name: 'Button' })).toBeVisible();

    const buttonCount = await page.evaluate(
      ({ probeAttribute, panelSelector }) => {
        const buttons = Array.from(
          document.querySelectorAll(`${panelSelector} button:not([disabled])`),
        );
        buttons.forEach((button, index) => {
          button.setAttribute(probeAttribute, String(index));
        });
        return buttons.length;
      },
      { probeAttribute: TAB_PROBE_ATTRIBUTE, panelSelector: ENTRY_PANEL },
    );
    expect(buttonCount).toBeGreaterThan(20);

    const focusableCount = await page.evaluate(
      () =>
        document.querySelectorAll('main a[href], main button:not([disabled]), main select').length,
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
    await page.goto(`${GALLERY_PATH}#panel`);
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

  test('regenerates the placeholder art', async ({ page }) => {
    await page.goto(`${GALLERY_PATH}#art-people`);
    await expect(page.getByText('gallery-art-1')).toBeVisible();
    await page.getByRole('button', { name: 'Regenerate' }).click();
    await expect(page.getByText('gallery-art-2')).toBeVisible();
  });

  test('runs the engine in the browser', async ({ page }) => {
    await page.goto(`${GALLERY_PATH}#engine`);
    await expect(page.getByText('Same seed, same rolls')).toBeVisible();
    await expect(page.locator(`${ENTRY_PANEL} ol li`)).toHaveCount(20);
  });

  test('every button in the Button entry meets the touch target on a phone', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Touch targets apply to the phone projects.');
    await page.goto(`${GALLERY_PATH}#button`);

    const buttons = page.locator(`${ENTRY_PANEL} button`);
    await expect(buttons.first()).toBeVisible();
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

  test('the entry panel runs edge to edge on a phone', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Full-bleed panels are the phone layout.');

    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const panel = page.locator(ENTRY_PANEL);
    const box = await panel.boundingBox();
    expect(box, 'the entry panel is rendered').not.toBeNull();
    expect(box?.x, 'the entry panel starts at the left edge').toBe(0);
    expect(box?.width, 'the entry panel spans the viewport').toBe(viewportWidth);
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

    // The drag handle is visual only: a tap on the strip around it is inside the sheet, not on
    // the backdrop, so the sheet stays open.
    await page.mouse.click(sheetBox.x + 24, sheetBox.y + 6);
    await expect(sheet).toBeVisible();

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
    await gotoEntry(page, 'tabs', 'Tabs');

    const strip = page.locator(`${ENTRY_PANEL} [role="tablist"]`).first();
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
    await gotoEntry(page, 'tabs', 'Tabs');
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
    await gotoEntry(page, 'confirm-dialog', 'ConfirmDialog');
    const opener = page.locator(ENTRY_PANEL).getByRole('button', {
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
    await gotoEntry(page, 'confirm-dialog', 'ConfirmDialog');
    await page.locator(ENTRY_PANEL).getByRole('button', { name: 'Delete locked save' }).click();
    const confirm = page.getByRole('alertdialog', { name: 'Delete the locked save?' });
    await confirm.getByRole('button', { name: 'Delete anyway' }).click();

    await expect(confirm.getByRole('alert')).toContainText('locked by another tab');
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: 'Delete anyway' })).toBeEnabled();
    // The error state is the busiest the dialog gets: title, body, alert and both buttons.
    await expectNoSeriousA11yViolations(page, { include: ['dialog[open]'] });
  });

  test('confirm buttons stack full width with touch-sized targets on a phone', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Stacked buttons are the phone layout.');

    // No open animation, so the buttons are measured at full size.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoEntry(page, 'confirm-dialog', 'ConfirmDialog');
    await page.locator(ENTRY_PANEL).getByRole('button', { name: 'Advance a week' }).click();
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
