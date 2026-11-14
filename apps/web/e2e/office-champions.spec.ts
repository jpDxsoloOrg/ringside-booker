/**
 * The Office's Champions panel (CRTV1-06) in a new default-world game as Altura: our six active
 * titles as title cards in the side column (a swipe row on a phone that scrolls inside itself,
 * never the page), each name linking to its title page, and "All titles" opening Creative >
 * Titles. Passes the accessibility scan.
 */
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';
const WORLD_TITLE = 'Altura World Championship';

/** Building the default world and starting the game takes a while on a loaded machine. */
const GAME_TIMEOUT_MS = 240_000;

test.describe('Office: Champions', () => {
  test('our champions on the Office, each linking to its title page', async ({
    page,
  }, testInfo) => {
    test.setTimeout(GAME_TIMEOUT_MS);
    await startDefaultWorldGame(page, ALTURA);
    await navigateInApp(page, '/game/office');

    const panel = page.getByRole('region', { name: 'Champions', exact: true });
    const list = panel.getByRole('region', { name: 'Your champions' });
    await expect(list.getByRole('article')).toHaveCount(6);
    await expect(list).toHaveAttribute('data-layout', isPhone(testInfo) ? 'swipe' : 'grid');
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await list.getByRole('link', { name: WORLD_TITLE, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: WORLD_TITLE })).toBeVisible();

    await navigateInApp(page, '/game/office');
    await page
      .getByRole('region', { name: 'Champions', exact: true })
      .getByRole('link', { name: 'All titles' })
      .click();
    await expect(page).toHaveURL(/\/game\/titles(\?.*)?$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Titles' })).toBeVisible();
  });
});
