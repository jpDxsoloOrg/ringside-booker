/**
 * Business > Production in a real game (the sample save): the header cards, the eight areas in
 * their two groups, and raising Camera through the change dialog, which shows the fee and the
 * numbers it moves and changes the level when confirmed. Every step fits a 390px phone with no
 * sideways scroll (at 150% UI scale too) and passes the accessibility scan.
 */
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromSampleSave } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

/**
 * The widest right edge of anything on the Production screen or in an open dialog, in CSS pixels,
 * against the viewport. The shell around it (top bar, ticker) has its own checks.
 */
async function overflowOf(page: Page): Promise<{ readonly right: number; readonly width: number }> {
  return page.evaluate(() => {
    const roots = Array.from(document.querySelectorAll('main, [role="alertdialog"]'));
    let right = 0;
    for (const root of roots) {
      for (const element of [root, ...Array.from(root.querySelectorAll('*'))]) {
        right = Math.max(right, element.getBoundingClientRect().right);
      }
    }
    return { right: Math.round(right), width: document.documentElement.clientWidth };
  });
}

async function openProduction(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('link', { name: 'Production', exact: true })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Production', exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/game\/production$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Production' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Every month' })).toBeVisible();
}

test.describe('Business > Production', () => {
  test('shows the areas and raises Camera through the change dialog', async ({
    page,
  }, testInfo) => {
    const phone = isPhone(testInfo);
    // Motion off, so the dialog is fully faded in when the accessibility scan reads its colours.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterGameFromSampleSave(page);
    await openProduction(page, phone);

    const header = page.getByRole('group', { name: 'Production at a glance' });
    await expect(header.getByRole('group', { name: 'Popularity ceiling' })).toBeVisible();
    await expect(header.getByRole('group', { name: 'Monthly overhead' })).toBeVisible();
    for (const group of ['On every show', 'Every month']) {
      await expect(
        page.getByRole('region', { name: group }).getByRole('heading', { level: 3 }),
      ).toHaveCount(4);
    }
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    const camera = page.getByRole('listitem', { name: 'Camera' });
    const meter = camera.getByRole('meter', { name: 'Camera level' });
    const from = Number(await meter.getAttribute('aria-valuenow'));
    await camera.getByRole('button', { name: 'Raise Camera' }).click();

    const dialog = page.getByRole('alertdialog', {
      name: `Camera: level ${String(from)} → ${String(from + 1)}`,
    });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('One-time fee')).toBeVisible();
    await expect(dialog.getByText('Show quality ceiling')).toBeVisible();
    const confirm = dialog.getByRole('button', { name: /^Pay \$[\d,]+ and raise$/ });
    await expect(confirm).toBeEnabled();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect(meter).toHaveAttribute('aria-valuenow', String(from + 1));
  });

  test('phone: the screen and the dialog fit at 150% UI scale', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'The phone layout at a large UI scale');
    await page.goto('/settings');
    await page.getByRole('slider', { name: 'UI scale' }).fill('1.5');
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')),
      )
      .toBe('1.5');
    await enterGameFromSampleSave(page);
    await openProduction(page, true);
    const screenFit = await overflowOf(page);
    expect(screenFit.right).toBeLessThanOrEqual(screenFit.width);

    await page
      .getByRole('listitem', { name: 'Marketing' })
      .getByRole('button', { name: 'Lower Marketing' })
      .click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByText('Lowering is free')).toBeVisible();
    const dialogFit = await overflowOf(page);
    expect(dialogFit.right).toBeLessThanOrEqual(dialogFit.width);
  });
});
