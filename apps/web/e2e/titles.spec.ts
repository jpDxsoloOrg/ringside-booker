/**
 * Creative > Titles in a new default-world game as Altura (CRTV1-04): our six titles under
 * Altura Mainstage, Altura Overclock and Promotion-wide, the World Championship's prestige Why?
 * (set by the world file), its page with the lineage and records, and Around the world with the
 * other promotions' 22 titles in 11 groups. On a phone the cards stack in one column, and the list
 * and the title page fit with no sideways scroll at 100% and 150% UI scale. Every step passes the
 * accessibility scan.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';
const WORLD_TITLE = 'Altura World Championship';
const OWN_GROUPS = ['Altura Mainstage', 'Altura Overclock', 'Promotion-wide'] as const;

/** Building the default world and starting the game takes a while on a loaded machine. */
const GAME_TIMEOUT_MS = 240_000;

/** Opens Creative > Titles: the sidebar on desktop, the More sheet on a phone. */
async function openTitles(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('link', { name: 'Titles', exact: true })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Titles', exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/game\/titles(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Titles' })).toBeVisible();
}

function cards(page: Page): Locator {
  return page.getByRole('main').getByRole('article');
}

/** On a phone each list is one column: its cards share a left edge and stack downwards. */
async function expectOneColumn(list: Locator): Promise<void> {
  await expect(list).toHaveAttribute('data-layout', 'stack');
  const boxes = await list.getByRole('article').evaluateAll((articles) =>
    articles.map((article) => {
      const box = article.getBoundingClientRect();
      return { left: Math.round(box.left), top: Math.round(box.top) };
    }),
  );
  const [first, second] = boxes;
  if (first === undefined || second === undefined) return;
  expect(second.left).toBe(first.left);
  expect(second.top).toBeGreaterThan(first.top);
}

/** Sets the UI scale on the settings screen without reloading, so the game stays loaded. */
async function setUiScale(page: Page, scale: string): Promise<void> {
  await navigateInApp(page, '/settings');
  await page.getByRole('slider', { name: 'UI scale' }).fill(scale);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')))
    .toBe(scale);
}

test.describe('Creative > Titles', () => {
  test('our belts by brand, a title’s lineage and the world’s titles', async ({
    page,
  }, testInfo) => {
    test.setTimeout(GAME_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, ALTURA);
    await openTitles(page, phone);

    // Our titles: three groups, six cards.
    for (const group of OWN_GROUPS) {
      await expect(page.getByRole('region', { name: group, exact: true })).toBeVisible();
    }
    await expect(cards(page)).toHaveCount(6);
    if (phone) {
      for (const group of OWN_GROUPS) {
        await expectOneColumn(page.getByRole('region', { name: `${group} titles` }));
      }
    }
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    // The World Championship's prestige came from the world file.
    const worldCard = page.getByRole('article', { name: WORLD_TITLE });
    await worldCard
      .getByRole('button', { name: new RegExp(`^Why\\? ${WORLD_TITLE} prestige`) })
      .click();
    const why = page.getByRole('dialog', { name: `Prestige: ${WORLD_TITLE}` });
    await expect(why.getByText(/Prestige set by the world file/).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(why).toBeHidden();

    // Its page: the lineage starts with the current reign, newest first, and the records.
    await worldCard.getByRole('link', { name: WORLD_TITLE }).click();
    await expect(page.getByRole('heading', { level: 1, name: WORLD_TITLE })).toBeVisible();
    const lineage = page.getByRole('region', { name: 'Lineage' });
    const reigns = lineage.locator('[data-row-id]');
    await expect(reigns.first()).toContainText('Current');
    const count = await reigns.count();
    for (let index = 1; index < count; index += 1) {
      await expect(reigns.nth(index)).not.toContainText('Current');
    }
    await expect(page.getByRole('region', { name: 'Records' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Champion' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    // Back to the list, then Around the world: 22 titles in 11 promotion groups.
    await page.getByRole('link', { name: 'Back to Titles' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Titles' })).toBeVisible();
    await page.getByRole('tab', { name: 'Around the world' }).click();
    await expect(page).toHaveURL(/\?tab=world$/);
    await expect(cards(page)).toHaveCount(22);
    await expect(page.getByRole('main').getByRole('region', { name: / titles$/ })).toHaveCount(11);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    // A rival's title page from Around the world, then Back keeps the tab.
    await cards(page).first().getByRole('heading').getByRole('link').click();
    await expect(page.getByRole('region', { name: 'Lineage' })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\?tab=world$/);
    await expect(cards(page)).toHaveCount(22);

    if (phone) {
      // At 150% UI scale the list and the title page still fit.
      await setUiScale(page, '1.5');
      await navigateInApp(page, '/game/titles');
      await expect(cards(page)).toHaveCount(6);
      await expectNoHorizontalScroll(page);
      await page
        .getByRole('article', { name: WORLD_TITLE })
        .getByRole('link', { name: WORLD_TITLE })
        .click();
      await expect(page.getByRole('region', { name: 'Records' })).toBeVisible();
      await expectNoHorizontalScroll(page);
    }
  });
});
