/**
 * The office kit in the component gallery, on desktop and phone. The gallery spec already opens
 * every entry for console errors, sideways scroll and accessibility; this spec checks the layouts
 * the kit promises at each size: KPI cards fill the row on desktop and go 2-up on a phone, and
 * champion cards sit in a grid on desktop and a horizontal swipe row on a phone that scrolls
 * inside itself, never the page.
 */
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const GALLERY_PATH = '/dev/gallery';
const ENTRY_PANEL = '#gallery-entry';

/** Boxes on one row can differ by a pixel or two of rounding. */
const SAME_ROW_TOLERANCE_PX = 2;

async function gotoEntry(page: Page, entryId: string, entryTitle: string): Promise<Locator> {
  await page.goto(`${GALLERY_PATH}#${entryId}`);
  await expect(
    page.getByRole('heading', { level: 2, name: entryTitle, exact: true }),
  ).toBeVisible();
  return page.locator(ENTRY_PANEL);
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, 'element is rendered').not.toBeNull();
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

test.describe('office kit', () => {
  test('KPI cards fill the row on desktop and go 2-up on a phone', async ({ page }, testInfo) => {
    const entry = await gotoEntry(page, 'kpi-card', 'KpiCard');
    const grid = entry.getByRole('group', { name: 'Key numbers' });
    const cards = grid.locator(':scope > [role="group"]');
    await expect(cards).toHaveCount(5);
    const [first, second, third] = await Promise.all(
      [0, 1, 2].map((index) => boxOf(cards.nth(index))),
    );
    if (first === undefined || second === undefined || third === undefined) return;

    expect(
      Math.abs(second.y - first.y),
      'the second card shares the first row',
    ).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
    if (isPhone(testInfo)) {
      expect(third.y, 'the third card starts a second row').toBeGreaterThanOrEqual(
        first.y + first.height,
      );
      expect(Math.abs(third.x - first.x)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
    } else {
      expect(Math.abs(third.y - first.y)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
    }
    await expectNoHorizontalScroll(page);
  });

  test('champion cards are a grid on desktop and a swipe row on a phone', async ({
    page,
  }, testInfo) => {
    const entry = await gotoEntry(page, 'champion-card', 'ChampionCard');
    const row = entry.getByRole('region', { name: 'Champions' });
    const cards = row.getByRole('article');
    await expect(cards).toHaveCount(4);
    const [first, second] = await Promise.all([0, 1].map((index) => boxOf(cards.nth(index))));
    if (first === undefined || second === undefined) return;

    if (isPhone(testInfo)) {
      await expect(row).toHaveAttribute('data-layout', 'swipe');
      await expect(row).toHaveAttribute('tabindex', '0');
      expect(Math.abs(second.y - first.y), 'cards share one row').toBeLessThanOrEqual(
        SAME_ROW_TOLERANCE_PX,
      );
      expect(second.x).toBeGreaterThan(first.x + first.width);

      const overflow = await row.evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
      }));
      expect(overflow.scrollWidth, 'the row scrolls sideways').toBeGreaterThan(
        overflow.clientWidth,
      );

      // The keyboard can scroll the row too.
      await row.focus();
      await page.keyboard.press('ArrowRight');
      await expect.poll(() => row.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    } else {
      await expect(row).toHaveAttribute('data-layout', 'grid');
      await expect(row).not.toHaveAttribute('tabindex');
      expect(Math.abs(second.y - first.y)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
    }
    await expectNoHorizontalScroll(page);
  });

  // CRTV1-04: the Titles screen's stacked variant is one card per row on a phone, no tab stop.
  test('stacked champion cards are one column on a phone', async ({ page }, testInfo) => {
    const entry = await gotoEntry(page, 'champion-card', 'ChampionCard');
    const list = entry.getByRole('region', { name: 'Stacked title cards' });
    const cards = list.getByRole('article');
    await expect(cards).toHaveCount(2);
    const [first, second] = await Promise.all([0, 1].map((index) => boxOf(cards.nth(index))));
    if (first === undefined || second === undefined) return;
    await expect(list).not.toHaveAttribute('tabindex');
    if (isPhone(testInfo)) {
      await expect(list).toHaveAttribute('data-layout', 'stack');
      expect(Math.abs(second.x - first.x)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
      expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
    } else {
      await expect(list).toHaveAttribute('data-layout', 'grid');
    }
    await expectNoHorizontalScroll(page);
  });
});
