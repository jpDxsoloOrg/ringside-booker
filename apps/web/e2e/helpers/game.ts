import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The e2e sample save: the engine's golden save (`v1-tiny.json`) encoded with `encodeSave` by
 * `fixtures/build-sample-save.ts`, which `npm run e2e` runs first.
 */
export const SAMPLE_SAVE_PATH = fileURLToPath(
  new URL('../fixtures/sample.rbsave', import.meta.url),
);

/** The slot label an imported sample gets. */
export const SAMPLE_SLOT_LABEL = 'Test save (imported)';

/** The sample world's date when it loads. */
export const SAMPLE_GAME_DATE = '2026-04-10';

/**
 * Enters a real game the way a player would: import the sample save from the title screen, load
 * it from the saved games list and wait for the office. The engine and the day pipeline then run
 * for real in the worker, with no dev-only loader and no test fixtures in the app bundle.
 */
export async function enterGameFromSampleSave(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
  await page.getByTestId('import-save-input').setInputFiles(SAMPLE_SAVE_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();
  await page
    .getByRole('article', { name: SAMPLE_SLOT_LABEL, exact: true })
    .getByRole('button', { name: `Load ${SAMPLE_SLOT_LABEL}` })
    .click();
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/**
 * The played e2e save: a default-world game three weeks in, with booked and run shows, built by
 * `fixtures/build-played-save.ts` (which `npm run e2e` runs first). Long tables, ledgers and a
 * filled calendar, for the phone layout checks.
 */
export const PLAYED_SAVE_PATH = fileURLToPath(
  new URL('../fixtures/sample-played.rbsave', import.meta.url),
);

/** The slot label the imported played save gets. */
export const PLAYED_SLOT_LABEL = 'Played save (imported)';

/** Imports the played save from the title screen, loads it and waits for the office. */
export async function enterGameFromPlayedSave(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
  await page.getByTestId('import-save-input').setInputFiles(PLAYED_SAVE_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();
  await page
    .getByRole('article', { name: PLAYED_SLOT_LABEL, exact: true })
    .getByRole('button', { name: `Load ${PLAYED_SLOT_LABEL}` })
    .click();
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}
