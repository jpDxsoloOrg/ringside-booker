/**
 * The DataTable demo in the component gallery: on desktop a table whose headers sort the rows,
 * with a filter box, row checkboxes and a column picker; on a phone the same rows as stacked cards
 * with a "Sort by" select, fitting a 390px screen.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

/** The DataTable entry, deep linked by its id. */
const GALLERY_PATH = '/dev/gallery#data-table';
/** The panel that holds the selected gallery entry. */
const SECTION_SELECTOR = '#gallery-entry';
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

/** Picks a "Sort by" option on the phone layout (a styled select that opens a listbox). */
async function chooseSortBy(page: Page, optionLabel: string): Promise<void> {
  await section(page).getByRole('combobox', { name: 'Sort by' }).click();
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
}

function sortedCopy(values: readonly number[], direction: 'asc' | 'desc'): number[] {
  return [...values].sort((left, right) => (direction === 'asc' ? left - right : right - left));
}

test.describe('DataTable on desktop', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'The table layout is the desktop layout.');
    await page.goto(GALLERY_PATH);
    // The gallery is its own chunk, so wait until every row and its popularity meter is drawn
    // before a test reads the starting order.
    await expect(
      section(page).locator('tbody td[data-column-id="popularity"] [role="meter"]'),
    ).toHaveCount(FIXTURE_ROW_COUNT);
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

  test('a third header click goes back to the given order', async ({ page }) => {
    const table = section(page).getByRole('grid');
    const header = table.getByRole('columnheader', { name: 'Popularity' });
    const unsorted = await tablePopularities(page);

    for (let click = 0; click < 3; click += 1) {
      await header.getByRole('button', { name: 'Popularity' }).click();
    }
    await expect(header).toHaveAttribute('aria-sort', 'none');
    expect(await tablePopularities(page)).toEqual(unsorted);
  });

  test('the filter box narrows the rows and "Clear filter" brings them back', async ({ page }) => {
    const table = section(page).getByRole('grid');
    const filter = section(page).getByRole('searchbox', { name: 'Filter workers' });

    await filter.fill('worker 1');
    // Worker 1 and Workers 10 to 19.
    await expect(table.locator('tbody tr')).toHaveCount(11);
    await expect(section(page).getByText('11 matches')).toBeVisible();

    await filter.fill('nobody at all');
    await expect(section(page).getByText('No matches')).toBeVisible();
    await section(page).getByRole('button', { name: 'Clear filter' }).click();
    await expect(table.locator('tbody tr')).toHaveCount(FIXTURE_ROW_COUNT);
  });

  test('row checkboxes select rows without opening them', async ({ page }) => {
    const table = section(page).getByRole('grid');

    await table.getByRole('checkbox', { name: 'Select Worker 2', exact: true }).check();
    await table.getByRole('checkbox', { name: 'Select Worker 5', exact: true }).click({
      modifiers: ['Shift'],
    });
    await expect(section(page).getByText('4 selected')).toBeVisible();
    await expect(section(page).getByText(/^Opened /)).toHaveCount(0);

    const selectAll = table.getByRole('checkbox', { name: 'Select all rows' });
    await selectAll.click();
    await expect(section(page).getByText(`${String(FIXTURE_ROW_COUNT)} selected`)).toBeVisible();
    await section(page).getByRole('button', { name: 'Clear selection' }).click();
    await expect(section(page).getByText(/selected$/)).toHaveCount(0);
  });

  test('the column picker hides a column', async ({ page }) => {
    const table = section(page).getByRole('grid');
    await expect(table.getByRole('columnheader', { name: 'Age', exact: true })).toBeVisible();

    await section(page).getByRole('button', { name: 'Columns' }).click();
    await page
      .getByRole('dialog', { name: 'Columns' })
      .getByRole('checkbox', { name: 'Age', exact: true })
      .uncheck();
    await expect(table.getByRole('columnheader', { name: 'Age', exact: true })).toHaveCount(0);
    await expect(table.locator('td[data-column-id="age"]')).toHaveCount(0);
  });

  test('headers use the condensed display face in capitals', async ({ page }) => {
    const header = section(page).getByRole('columnheader', { name: 'Momentum' });
    const headerStyle = await header.evaluate((element) => {
      const computed = getComputedStyle(element);
      return { family: computed.fontFamily, transform: computed.textTransform };
    });
    expect(headerStyle.family).toContain('Barlow Condensed');
    expect(headerStyle.transform).toBe('uppercase');
    await expect(section(page).locator('td[data-column-id="momentum"]').first()).toHaveCSS(
      'text-align',
      'end',
    );
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

    await chooseSortBy(page, 'Popularity');
    // Wait for the re-render rather than reading the list straight after the choice.
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

  test('filters and ticks cards at phone width without sideways scroll', async ({ page }) => {
    const list = section(page).getByRole('list', { name: 'Roster (gallery fixtures)' });

    await section(page).getByRole('searchbox', { name: 'Filter workers' }).fill('worker 3');
    // Worker 3 and Workers 30 to 39.
    await expect(list.getByRole('listitem')).toHaveCount(11);

    const checkbox = list.getByRole('checkbox', { name: 'Select Worker 3', exact: true });
    await checkbox.tap();
    await expect(checkbox).toBeChecked();
    await expect(section(page).getByText('1 selected')).toBeVisible();
    await expect(section(page).getByText(/^Opened /)).toHaveCount(0);

    const viewport = page.viewportSize();
    const checkboxBox = await checkbox.boundingBox();
    expect(checkboxBox).not.toBeNull();
    if (checkboxBox !== null && viewport !== null) {
      expect(checkboxBox.x + checkboxBox.width, 'checkbox ends on screen').toBeLessThanOrEqual(
        viewport.width,
      );
    }

    await expectNoHorizontalScroll(page);
  });

  test('tapping a card opens it', async ({ page }) => {
    const card = section(page).getByRole('button', { name: /^Worker 3\b/ });
    await card.tap();
    await expect(section(page).getByText('Opened Worker 3.')).toBeVisible();
  });
});
