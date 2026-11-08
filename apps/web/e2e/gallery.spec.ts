/**
 * The component gallery at /dev/gallery, on desktop and phone. Every entry opens without console
 * errors (the fixture fails the test on any), fits the viewport with no horizontal scroll, and has
 * no serious accessibility issues in either theme. On desktop the entry list and the phone frame
 * work; on a phone a select replaces the list, buttons meet the touch target and the entry panel
 * runs edge to edge.
 */
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
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
});
