/**
 * A save from an older build, end to end on desktop and phone: import the frozen file
 * (`src/screens/saves/fixtures/older-build.rbsave`, never regenerated), try to load it and get
 * the short "Made with an older build" sheet with Export and Delete instead of a list of issues.
 */
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const OLDER_BUILD_SAVE = fileURLToPath(
  new URL('../src/screens/saves/fixtures/older-build.rbsave', import.meta.url),
);
const IMPORTED_LABEL = 'Older build test save (imported)';

function slotCard(page: Page, label: string) {
  return page.getByRole('article', { name: label, exact: true });
}

test.describe('a save made with an older build', () => {
  test('says so, exports the file and deletes the slot', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);

    await test.step('the frozen save imports from the title screen', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
      await page.getByTestId('import-save-input').setInputFiles(OLDER_BUILD_SAVE);
      await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();
      await expect(slotCard(page, IMPORTED_LABEL)).toBeVisible();
    });

    const sheet = page.getByRole('dialog', { name: 'Made with an older build' });

    await test.step('Load opens the older-build sheet, not the issue list', async () => {
      await slotCard(page, IMPORTED_LABEL)
        .getByRole('button', { name: `Load ${IMPORTED_LABEL}` })
        .click();
      await expect(sheet).toBeVisible();
      await expect(sheet).toContainText(
        "This save was made with an older build of Ringside Booker, and this build can't open it.",
      );
      await expect(sheet.getByRole('button', { name: 'Export this save' })).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Delete this save' })).toBeVisible();
      await expect(sheet.getByRole('link', { name: 'Start a new game' })).toBeVisible();
      await expect(page.getByTestId('load-error')).toHaveCount(0);
      await expect(sheet.getByRole('listitem')).toHaveCount(0);
      await expect(page).toHaveURL(/\/load$/);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });

    if (phone) {
      await test.step('on a phone the actions stack full width', async () => {
        const exportBox = await sheet
          .getByRole('button', { name: 'Export this save' })
          .boundingBox();
        const deleteBox = await sheet
          .getByRole('button', { name: 'Delete this save' })
          .boundingBox();
        if (exportBox === null || deleteBox === null)
          throw new Error('The actions did not lay out');
        expect(deleteBox.y).toBeGreaterThan(exportBox.y);
        expect(Math.abs(deleteBox.width - exportBox.width)).toBeLessThan(1);
        expect(Math.abs(deleteBox.x - exportBox.x)).toBeLessThan(1);
      });
    }

    await test.step('Export downloads an .rbsave file', async () => {
      const downloadEvent = page.waitForEvent('download');
      await sheet.getByRole('button', { name: 'Export this save' }).click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toMatch(/\.rbsave$/);
    });

    await test.step('Delete asks first, then removes the card', async () => {
      await sheet.getByRole('button', { name: 'Delete this save' }).click();
      const dialog = page.getByRole('alertdialog', { name: `Delete ${IMPORTED_LABEL}?` });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
      await expect(slotCard(page, IMPORTED_LABEL)).toHaveCount(0);
      await expect(sheet).toHaveCount(0);
      await expect(page.getByText('No saved games yet')).toBeVisible();
    });
  });
});
