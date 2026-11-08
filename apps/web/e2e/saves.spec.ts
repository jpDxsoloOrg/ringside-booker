/**
 * Save slots end to end, from a fresh browser profile, on desktop and phone: import the sample
 * `.rbsave` (built from the engine's golden save by `fixtures/build-sample-save.ts`), load it into
 * the shell, leave through Main menu (which saves), Continue from the title screen, load a backup
 * after a confirmation, export it as a file, import that file again and delete both. A file that
 * is not a save opens the error report instead of breaking anything; on a phone it is a bottom
 * sheet.
 */
import { fileURLToPath } from 'node:url';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const SAMPLE_SAVE = fileURLToPath(new URL('./fixtures/sample.rbsave', import.meta.url));
const IMPORTED_LABEL = 'Test save (imported)';
const REIMPORTED_LABEL = 'Test save (imported) (imported)';
/** What Continue shows for the imported sample: label, promotion and game date. */
const SAMPLE_SUMMARY = `${IMPORTED_LABEL} · Test Promotion A · Apr 10, 2026`;

function slotCard(page: Page, label: string) {
  return page.getByRole('article', { name: label, exact: true });
}

async function importFile(page: Page, filePath: string): Promise<void> {
  await page.getByTestId('import-save-input').setInputFiles(filePath);
}

async function expectInGame(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/** Leaves the game through "Main menu": the sidebar on desktop, the More sheet on a phone. */
async function leaveToMainMenu(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('button', { name: 'Main menu' })
      .click();
  } else {
    await page.getByTestId('sidebar').getByRole('button', { name: 'Main menu' }).click();
  }
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
}

/** The box of a visible element, failing the test when it has none. */
async function boxOf(locator: Locator): Promise<{ x: number; y: number; width: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The element did not lay out');
  return box;
}

/**
 * Phone layout of a slot card: Load spans the card as a full-width primary button, and Export,
 * Backups and Delete sit in a row under it.
 */
async function expectPhoneCardLayout(card: Locator, label: string): Promise<void> {
  const cardBox = await boxOf(card);
  const loadBox = await boxOf(card.getByRole('button', { name: `Load ${label}` }));
  const exportBox = await boxOf(card.getByRole('button', { name: `Export ${label}` }));
  const deleteBox = await boxOf(card.getByRole('button', { name: `Delete ${label}` }));
  expect(loadBox.width).toBeGreaterThan(cardBox.width * 0.8);
  expect(exportBox.y).toBeGreaterThan(loadBox.y);
  expect(Math.abs(deleteBox.y - exportBox.y)).toBeLessThan(1);
}

/** Phone layout of the title screen: one column of menu items, each as wide as the others. */
async function expectPhoneTitleLayout(page: Page): Promise<void> {
  const menu = page.getByRole('navigation', { name: 'Main menu' });
  const items = [
    menu.getByRole('button', { name: /^Continue/ }),
    menu.getByRole('link', { name: 'New game' }),
    menu.getByRole('link', { name: 'Load game' }),
    menu.getByRole('button', { name: 'Import save' }),
    menu.getByRole('link', { name: 'Settings' }),
  ];
  const boxes = await Promise.all(items.map((item) => boxOf(item)));
  const [first] = boxes;
  if (first === undefined) throw new Error('The title menu is empty');
  boxes.forEach((box, index) => {
    expect(Math.abs(box.x - first.x)).toBeLessThan(1);
    expect(Math.abs(box.width - first.width)).toBeLessThan(1);
    const previous = boxes[index - 1];
    if (previous !== undefined) expect(box.y).toBeGreaterThan(previous.y);
  });
}

async function deleteSlot(page: Page, label: string): Promise<void> {
  await slotCard(page, label)
    .getByRole('button', { name: `Delete ${label}` })
    .click();
  const dialog = page.getByRole('alertdialog', { name: `Delete ${label}?` });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(slotCard(page, label)).toHaveCount(0);
}

test.describe('save slots', () => {
  test('import, load, leave, continue, export, re-import and delete', async ({
    page,
  }, testInfo) => {
    const phone = isPhone(testInfo);

    await test.step('a fresh profile has no saves and no Continue', async () => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'New game' })).toBeVisible();
      await expect(page.getByRole('button', { name: /^Continue/ })).toHaveCount(0);
      await page.getByRole('link', { name: 'Load game' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();
      await expect(page.getByText('No saved games yet')).toBeVisible();
    });

    await test.step('importing the sample adds and points out a slot', async () => {
      await importFile(page, SAMPLE_SAVE);
      const card = slotCard(page, IMPORTED_LABEL);
      await expect(card).toBeVisible();
      await expect(card).toHaveClass(/highlighted/);
      await expect(card.getByText('Test Promotion A')).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      if (phone) await expectPhoneCardLayout(card, IMPORTED_LABEL);
    });

    await test.step('Load enters the shell', async () => {
      await slotCard(page, IMPORTED_LABEL)
        .getByRole('button', { name: `Load ${IMPORTED_LABEL}` })
        .click();
      await expectInGame(page);
    });

    await test.step('Main menu saves and returns to the title screen', async () => {
      await leaveToMainMenu(page, phone);
    });

    await test.step('Continue loads the same save again', async () => {
      const continueButton = page.getByRole('button', { name: /^Continue/ });
      await expect(continueButton).toContainText(SAMPLE_SUMMARY);
      await expectNoHorizontalScroll(page);
      if (phone) await expectPhoneTitleLayout(page);
      await continueButton.click();
      await expectInGame(page);
      await leaveToMainMenu(page, phone);
    });

    await test.step('a backup loads after a confirmation', async () => {
      await page.getByRole('link', { name: 'Load game' }).click();
      // Each Main menu save rotated the previous save into a backup.
      await slotCard(page, IMPORTED_LABEL)
        .getByRole('button', { name: `Backups of ${IMPORTED_LABEL}` })
        .click();
      const sheet = page.getByRole('dialog', { name: `Backups of ${IMPORTED_LABEL}` });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute('data-side', phone ? 'bottom' : 'right');
      await sheet
        .getByRole('button', { name: /^Load this backup/ })
        .first()
        .click();
      const confirm = page.getByRole('alertdialog', { name: 'Load this backup?' });
      await expect(confirm).toContainText('Your latest save stays in the slot');
      await confirm.getByRole('button', { name: 'Load backup' }).click();
      await expectInGame(page);
      await leaveToMainMenu(page, phone);
    });

    const exportedPath = await test.step('Export downloads an .rbsave file', async () => {
      await page.getByRole('link', { name: 'Load game' }).click();
      const downloadEvent = page.waitForEvent('download');
      await slotCard(page, IMPORTED_LABEL)
        .getByRole('button', { name: `Export ${IMPORTED_LABEL}` })
        .click();
      const download = await downloadEvent;
      expect(download.suggestedFilename()).toMatch(/^test-save-imported-2026-04-10\.rbsave$/);
      const savedPath = testInfo.outputPath(download.suggestedFilename());
      await download.saveAs(savedPath);
      return savedPath;
    });

    await test.step('the exported file imports again and loads', async () => {
      await importFile(page, exportedPath);
      const card = slotCard(page, REIMPORTED_LABEL);
      await expect(card).toBeVisible();
      await card.getByRole('button', { name: `Load ${REIMPORTED_LABEL}` }).click();
      await expectInGame(page);
      await leaveToMainMenu(page, phone);
      await page.getByRole('link', { name: 'Load game' }).click();
    });

    await test.step('Delete asks first, then removes each slot', async () => {
      await deleteSlot(page, REIMPORTED_LABEL);
      await deleteSlot(page, IMPORTED_LABEL);
      await expect(page.getByText('No saved games yet')).toBeVisible();
    });
  });

  test('a file that is not a save opens the error report', async ({ page }, testInfo) => {
    await page.goto('/load');
    await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();

    await page.getByTestId('import-save-input').setInputFiles({
      name: 'notes.rbsave',
      mimeType: 'application/x-ringside-save',
      buffer: Buffer.from('these are my booking notes, not a save'),
    });

    const sheet = page.getByRole('dialog', { name: "Couldn't import that file" });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Unpacking the file');
    await expect(sheet.getByRole('button', { name: 'Copy details' })).toBeVisible();
    await expect(sheet).toHaveAttribute('data-side', isPhone(testInfo) ? 'bottom' : 'right');
    await expectNoSeriousA11yViolations(page, { include: ['[role="dialog"]'] });
    await expect(page.getByRole('article')).toHaveCount(0);
  });
});
