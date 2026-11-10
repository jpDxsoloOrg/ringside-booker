/**
 * The PopularityDrilldown demo in the component gallery, opened all the way down: continents into
 * countries into regions, with the places at 0 brought back. It has to fit a 390px phone with no
 * sideways scroll, keep 44px disclosures there with the bar under the name, pass the
 * accessibility scan while open, and explain a country with its regions.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const GALLERY_PATH = '/dev/gallery#popularity-drilldown';

/** The smallest touch target, 2.75rem at the default 16px root size. */
const TAP_TARGET_MIN_PX = 44;

/** The local hero's drill-down: one country with fans, the rest behind the toggle. */
function localHero(page: Page): Locator {
  return page.getByRole('group', { name: 'Popularity of Dusty Marlowe by place' });
}

/** Opens every closed disclosure under `root`, level by level, until none are left. */
async function openEverything(root: Locator): Promise<void> {
  const closed = root.locator('button[aria-expanded="false"]');
  while ((await closed.count()) > 0) {
    await closed.first().click();
  }
}

test.describe('PopularityDrilldown in the gallery', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(GALLERY_PATH);
    await expect(
      page.getByRole('heading', { level: 2, name: 'PopularityDrilldown', exact: true }),
    ).toBeVisible();
  });

  test('opens from continents down to regions and fits the page', async ({ page }) => {
    const hero = localHero(page);
    await expect(hero.getByRole('button', { name: 'North America', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(hero.getByRole('button', { name: 'Europe', exact: true })).toHaveCount(0);

    await hero.getByRole('button', { name: /^Show places with no fans/ }).click();
    await expect(hero.getByRole('button', { name: 'Europe', exact: true })).toBeVisible();
    await openEverything(hero);

    await expect(hero.getByRole('list', { name: 'Regions of United States' })).toBeVisible();
    await expect(hero.getByRole('list', { name: 'Regions of Japan' })).toBeVisible();
    await expect(hero.getByRole('meter', { name: 'Popularity in Southeast' })).toHaveAttribute(
      'aria-valuenow',
      '62',
    );
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('toggles a continent from the keyboard', async ({ page }) => {
    const continent = localHero(page).getByRole('button', { name: 'North America', exact: true });
    await continent.focus();
    await page.keyboard.press('Enter');
    await expect(continent).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press('Space');
    await expect(continent).toHaveAttribute('aria-expanded', 'true');
  });

  test('explains a country with its regions and their population shares', async ({ page }) => {
    await localHero(page)
      .getByRole('button', { name: /^Why is Popularity in United States/ })
      .click();
    const panel = page.getByRole('dialog', { name: 'Popularity in United States' });
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/42\.9% of the population/)).toBeVisible();
    await expect(panel.getByText(/21\.4% of the population/)).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('on a phone every disclosure is a touch target and the bar sits under the name', async ({
    page,
  }, testInfo) => {
    test.skip(!isPhone(testInfo), 'The stacked layout is the phone layout.');
    const hero = localHero(page);
    await hero.getByRole('button', { name: /^Show places with no fans/ }).click();
    await openEverything(hero);

    const disclosures = hero.locator('button[aria-expanded]');
    const count = await disclosures.count();
    expect(count).toBeGreaterThan(5);
    const short: string[] = [];
    for (let index = 0; index < count; index += 1) {
      const button = disclosures.nth(index);
      const box = await button.boundingBox();
      if (box === null || box.height < TAP_TARGET_MIN_PX) {
        short.push(
          `${await button.innerText()}: ${box === null ? 'not rendered' : String(box.height)}`,
        );
      }
    }
    expect(short, `Disclosures shorter than ${String(TAP_TARGET_MIN_PX)}px`).toEqual([]);

    const nameBox = await hero
      .getByRole('button', { name: 'United States', exact: true })
      .boundingBox();
    const barBox = await hero
      .getByRole('meter', { name: 'Popularity in United States' })
      .boundingBox();
    expect(nameBox).not.toBeNull();
    expect(barBox).not.toBeNull();
    if (nameBox !== null && barBox !== null) {
      expect(barBox.y, 'the bar starts below the name').toBeGreaterThanOrEqual(
        nameBox.y + nameBox.height - 1,
      );
    }
    await expectNoHorizontalScroll(page);
  });
});
