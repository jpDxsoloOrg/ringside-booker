/**
 * The engine in its real Web Worker. The gallery's dev-only "Engine worker" entry pings the
 * engine through Comlink and shows the version the worker reports, and its "Crash engine" button
 * makes the worker throw, which must swap the whole app for the "simulation stopped" screen
 * rather than leave a frozen page. On a phone that screen is one column with full-width buttons
 * and error details that wrap.
 */
import { allowConsoleError, expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const ENTRY_PATH = '/dev/gallery#engine-worker';
const ENTRY_PANEL = '#gallery-entry';

/** The engine version in packages/engine/src/index.ts. */
const ENGINE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

/** The message the worker throws when asked to crash (CRASH_FOR_TESTING_MESSAGE). */
const CRASH_MESSAGE = 'Engine crash requested for testing';

test.describe('engine worker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(ENTRY_PATH);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Engine worker', exact: true }),
    ).toBeVisible();
  });

  test('pings the engine through the worker and shows its version', async ({ page }) => {
    const entry = page.locator(ENTRY_PANEL);
    await entry.getByRole('button', { name: 'Ping engine' }).click();

    await expect(entry.getByText('Worker answered')).toBeVisible();
    const version = entry.locator('dt', { hasText: 'Engine version' }).locator('xpath=../dd');
    await expect(version).toHaveText(ENGINE_VERSION_PATTERN);
    // The engine runs in a worker named "engine", never on the page itself.
    expect(page.workers().map((worker) => worker.url())).toContainEqual(
      expect.stringContaining('engine.worker'),
    );
  });

  test('shows the simulation-stopped screen when the worker crashes', async ({
    page,
  }, testInfo) => {
    allowConsoleError(CRASH_MESSAGE);
    await page.locator(ENTRY_PANEL).getByRole('button', { name: 'Crash engine' }).click();

    const heading = page.getByRole('heading', { level: 1, name: 'The simulation stopped' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle(/The simulation stopped/);
    // The gallery is gone: the screen replaces every route.
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toHaveCount(0);

    await page.getByText('Error details', { exact: true }).click();
    await expect(page.locator('pre')).toContainText(CRASH_MESSAGE);
    const reload = page.getByRole('button', { name: 'Reload' });
    const copy = page.getByRole('button', { name: 'Copy error details' });
    await expect(reload).toBeVisible();
    await expect(copy).toBeVisible();

    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    if (isPhone(testInfo)) {
      const reloadBox = await reload.boundingBox();
      const copyBox = await copy.boundingBox();
      const cardBox = await page.locator('main > div').boundingBox();
      if (reloadBox === null || copyBox === null || cardBox === null) {
        throw new Error('The stopped screen did not lay out');
      }
      // One column: the buttons stack and each spans the card's content width.
      expect(copyBox.y).toBeGreaterThan(reloadBox.y);
      expect(Math.abs(reloadBox.width - copyBox.width)).toBeLessThan(1);
      expect(reloadBox.width).toBeGreaterThan(cardBox.width * 0.8);
    }

    await reload.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
  });
});
