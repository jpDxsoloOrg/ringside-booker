/**
 * The DataTable demo in the component gallery: on desktop a table whose headers sort the rows; on
 * a phone the same rows as stacked cards with a "Sort by" select, fitting a 390px screen.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const GALLERY_PATH = '/dev/gallery';
const SECTION_SELECTOR = '#gallery-data-table';
const FIXTURE_ROW_COUNT = 40;

/** The smallest touch target, 2.75rem at the default 16px root size. */
const TAP_TARGET_MIN_PX = 44;

function section(page: Page): Locator {
  return page.locator(SECTION_SELECTOR);
}

/** The popularity of every table row, top to bottom, read from each row's meter. */
async function tablePopularities(page: Page): Promise<number[]> {
  const meters = section(page).locator('tbody td[data-column-id="popularity"] [role="meter"]');
  const values = await meters.evaluateAll((elements) =>
    elements.map((element) => Number(element.getAttribute('aria-valuenow'))),
  );
  return values;
}

/** The title of every card, top to bottom. */
async function cardNames(page: Page): Promise<string[]> {
  return section(page).locator('li [data-column-id="name"]').allInnerTexts();
}

function sortedCopy(values: readonly number[], direction: 'asc' | 'desc'): number[] {
  return [...values].sort((left, right) => (direction === 'asc' ? left - right : right - left));
}

test.describe('DataTable on desktop', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'The table layout is the desktop layout.');
    await page.goto(GALLERY_PATH);
  });

  test('clicking the Popularity header sorts high to low, then low to high', async ({ page }) => {
    const table = section(page).getByRole('grid', { name: 'Roster (gallery fixtures)' });
    await expect(table).toBeVisible();
    await expect(table.locator('tbody tr')).toHaveCount(FIXTURE_ROW_COUNT);

    const header = table.getByRole('columnheader', { name: 'Popularity' });
    const unsorted = await tablePopularities(page);

    await header.getByRole('button', { name: 'Popularity' }).click();
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    expect(await tablePopularities(page)).toEqual(sortedCopy(unsorted, 'desc'));

    await header.getByRole('button', { name: 'Popularity' }).click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    expect(await tablePopularities(page)).toEqual(sortedCopy(unsorted, 'asc'));
  });

  test('arrow keys select rows and Enter opens the selected one', async ({ page }) => {
    const table = section(page).getByRole('grid');
    await table.focus();

    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(table.locator('tr[aria-selected="true"]')).toContainText('Worker 2');

    await page.keyboard.press('Enter');
    await expect(section(page).getByText('Opened Worker 2.')).toBeVisible();
  });
});

test.describe('DataTable on a phone', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'Cards are the phone layout.');
    await page.goto(GALLERY_PATH);
  });

  test('shows cards that fit the screen, with "Sort by" changing their order', async ({ page }) => {
    const list = section(page).getByRole('list', { name: 'Roster (gallery fixtures)' });
    await expect(list.getByRole('listitem')).toHaveCount(FIXTURE_ROW_COUNT);
    await expect(section(page).getByRole('grid')).toHaveCount(0);

    await expectNoHorizontalScroll(page);

    const firstCard = list.getByRole('button').first();
    await firstCard.scrollIntoViewIfNeeded();
    const viewport = page.viewportSize();
    const box = await firstCard.boundingBox();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box !== null && viewport !== null) {
      expect(box.x, 'first card starts on screen').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'first card ends on screen').toBeLessThanOrEqual(viewport.width);
      expect(box.height, 'first card is a comfortable tap target').toBeGreaterThanOrEqual(
        TAP_TARGET_MIN_PX,
      );
    }

    const before = await cardNames(page);
    expect(before[0]).toBe('Worker 1');

    await section(page).getByLabel('Sort by').selectOption({ label: 'Popularity' });
    // Wait for the re-render rather than reading the list straight after the change event.
    await expect.poll(async () => cardNames(page)).not.toEqual(before);
    const after = await cardNames(page);
    expect([...after].sort()).toEqual([...before].sort());

    // High to low first: the first card's popularity meter is the largest.
    const popularities = await list
      .locator('dd[data-column-id="popularity"] [role="meter"]')
      .evaluateAll((elements) =>
        elements.map((element) => Number(element.getAttribute('aria-valuenow'))),
      );
    expect(popularities).toEqual(sortedCopy(popularities, 'desc'));

    await expectNoHorizontalScroll(page);
  });

  test('tapping a card opens it', async ({ page }) => {
    const card = section(page).getByRole('button', { name: 'Worker 3', exact: true });
    await card.tap();
    await expect(section(page).getByText('Opened Worker 3.')).toBeVisible();
  });
});
