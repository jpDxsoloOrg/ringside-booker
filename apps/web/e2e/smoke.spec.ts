import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { routesUnderTest } from './routes-under-test';

const standaloneRoutes = routesUnderTest.filter((route) => !route.needsWorld);

test.describe('smoke', () => {
  for (const route of standaloneRoutes) {
    test(`${route.name} (${route.path}) loads and fits the viewport`, async ({ page }) => {
      await page.goto(route.path);

      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });
  }
});
