/**
 * The component gallery at /dev/gallery, on desktop and phone: the page fits the viewport, has no
 * serious accessibility issues in either theme, every enabled button can be reached with Tab, and
 * on a phone the buttons meet the touch target and the panels run edge to edge.
 */
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
  'gallery-data-table',
] as const;

/** The smallest touch target, 2.75rem at the default 16px root size. */
const TAP_TARGET_MIN_PX = 44;

/** Attribute the keyboard test stamps on each button so it can tell them apart. */
const TAB_PROBE_ATTRIBUTE = 'data-tab-probe';

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
      const buttons = Array.from(document.querySelectorAll('main button:not([disabled])'));
      buttons.forEach((button, index) => {
        button.setAttribute(probeAttribute, String(index));
      });
      return buttons.length;
    }, TAB_PROBE_ATTRIBUTE);
    expect(buttonCount).toBeGreaterThan(20);

    // Every Tab stop, not only buttons: links, selects and custom widgets such as the DataTable
    // grid and its phone cards take a turn too.
    const focusableCount = await page.evaluate(
      () =>
        document.querySelectorAll(
          'main a[href], main button:not([disabled]), main select, main [tabindex="0"]',
        ).length,
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
});
