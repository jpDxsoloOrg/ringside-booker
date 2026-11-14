/**
 * Business > Networks in a real game (ECO8-06).
 *
 * - The sample save: Your deals with the one deal, its sheet (terms, health, airing history),
 *   Available networks with what each network carries, and the calendar show sheet's "On TV"
 *   section (ECO8-07).
 * - A new Hardpan game (the owner's script): Bluebonnet Cable 7 would sign Hardpan Friday but the
 *   deal loses money every airing, and the Propose sheet says so before signing; signing switches
 *   to Your deals, and the Finances Overview gains its TV income card.
 *
 * Every step fits a 390px phone with no sideways scroll, sheets are bottom sheets on a phone, the
 * accessibility scan passes and no screen talks about minutes.
 */
import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromSampleSave, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { useFullMoney } from './helpers/money';
import { isPhone } from './helpers/viewport';

const CLOCK_WORDS = /\bmin(ute)?s?\b|hours?\b/i;

async function openFromNav(page: Page, phone: boolean, name: string): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('link', { name, exact: true })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name, exact: true })
      .click();
  }
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
}

async function expectNoClockWords(page: Page): Promise<void> {
  expect(await page.locator('main').innerText()).not.toMatch(CLOCK_WORDS);
}

/** On a phone a sheet comes up from the bottom and reaches the bottom of the screen. */
async function expectBottomSheetOnPhone(
  page: Page,
  sheet: ReturnType<Page['getByRole']>,
  phone: boolean,
): Promise<void> {
  if (!phone) return;
  const box = await sheet.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error('No sheet box');
  expect(Math.round(box.y + box.height)).toBeGreaterThanOrEqual(viewport.height - 2);
  expect(box.width).toBeGreaterThanOrEqual(viewport.width - 2);
}

test.describe('Business > Networks', () => {
  test('your deal, its sheet and the networks that reach your fans', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterGameFromSampleSave(page);
    await openFromNav(page, phone, 'Networks');
    await expect(page).toHaveURL(/\/game\/networks$/);

    const open = page.getByRole('button', { name: 'Test Network North · Test Weekly' });
    await expect(open).toBeVisible();
    await expect(page.getByText('Thu · Prime time · Live').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    await expectNoClockWords(page);

    await open.click();
    const sheet = page.getByRole('dialog', { name: 'Test Network North · Test Weekly' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Terms' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Airing history' })).toBeVisible();
    await expect(sheet.getByText('Safe').first()).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Renegotiate' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Cancel deal' })).toBeVisible();
    await expect(page).toHaveURL(/\?deal=dea_/);
    await expectBottomSheetOnPhone(page, sheet, phone);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    await page.getByRole('tab', { name: 'Available networks' }).click();
    await expect(page).toHaveURL(/\?tab=eco\.available$/);
    await expect(page.getByText('Networks that reach places where fans know you.')).toBeVisible();
    await expect(page.getByText('Test Network North', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Test Weekly · Test Promotion A').first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    await expectNoClockWords(page);

    // ECO8-07: the calendar show sheet says what the last Test Weekly drew on TV and paid (the
    // tiny world stores no Test Weekly still to come; the other states are in OnTvSection.test).
    await navigateInApp(page, '/game/calendar');
    await expect(page.getByRole('heading', { level: 1, name: 'Calendar' })).toBeVisible();
    await page
      .locator('button[data-own="true"][title="Test Weekly"][data-status="completed"]')
      .first()
      .click();
    const showSheet = page.getByRole('dialog', { name: 'Test Weekly', exact: true });
    await expect(showSheet.getByRole('heading', { name: 'On TV' })).toBeVisible();
    await expect(
      showSheet.getByText(/^Test Network North: [\d.]+[KM]? viewers · \$/),
    ).toBeVisible();
    await expectBottomSheetOnPhone(page, showSheet, phone);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('a Hardpan deal with Bluebonnet loses money per airing, and says so before signing', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    const phone = isPhone(testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await useFullMoney(page);
    await startDefaultWorldGame(page, 'Hardpan Pro Wrestling');
    await openFromNav(page, phone, 'Networks');

    await expect(page.getByRole('heading', { name: 'No TV deals yet' })).toBeVisible();
    await page.getByRole('button', { name: 'See available networks' }).click();
    await expect(page.getByText('Bluebonnet Cable 7', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoClockWords(page);

    await page.locator('[data-propose]').first().waitFor();
    const row = phone
      ? page.getByRole('listitem').filter({ hasText: 'Bluebonnet Cable 7' })
      : page.getByRole('row').filter({ hasText: 'Bluebonnet Cable 7' });
    await row.getByRole('button', { name: 'Propose' }).click();
    const sheet = page.getByRole('dialog', { name: 'Propose a deal to Bluebonnet Cable 7' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Would accept')).toBeVisible();
    await expect(
      sheet.getByText(
        'This deal loses money every airing: the airtime costs more than the network pays.',
      ),
    ).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^Why is Income per airing/ })).toBeVisible();
    await expectBottomSheetOnPhone(page, sheet, phone);
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    await expectNoClockWords(page);

    await sheet.getByRole('button', { name: 'Propose deal' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\?tab=eco\.yourDeals$/);
    await expect(page.getByRole('button', { name: /^Bluebonnet Cable 7 · / })).toBeFocused();

    await openFromNav(page, phone, 'Finances');
    const card = page.getByRole('group', { name: 'TV income (30 days)' });
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: /^Why is TV income/ })).toBeVisible();
    await expect(card.getByText('Nothing has aired yet')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
});
