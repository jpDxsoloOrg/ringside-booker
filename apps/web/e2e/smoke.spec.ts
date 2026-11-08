import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { enterShell, navigateInApp } from './helpers/shell';
import { routesUnderTest } from './routes-under-test';

test.describe('smoke', () => {
  for (const route of routesUnderTest) {
    test(`${route.name} (${route.path}) loads and fits the viewport`, async ({ page }) => {
      if (route.needsWorld) {
        // In-game routes need a loaded world: enter the shell, then move inside the app.
        await enterShell(page);
        await navigateInApp(page, route.path);
      } else {
        await page.goto(route.path);
      }

      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('h1')).toBeVisible();
      if (route.heading !== undefined) {
        await expect(page.locator('h1')).toHaveText(route.heading);
      }
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });
  }
});
