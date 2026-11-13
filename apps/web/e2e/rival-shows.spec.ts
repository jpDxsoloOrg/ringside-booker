/**
 * AIP4-07 in a real game (the played save: three weeks of shows on the default world, the rivals'
 * cards booked by the rival desk) and in the gallery, on desktop and phone:
 *
 * - Promotions > a rival > Shows: the recent shows open onto their cards, slot by slot, with a
 *   working Why? on every filled slot; shows still to air reveal nothing.
 * - Booking > Auto-fill empty slots fills the player's next show and opens the reasons sheet,
 *   with no winner picked.
 * - The gallery's rival show card (long names, a four-way, three chips) fits a phone, its header
 *   and Why? buttons are full tap targets, and the reasons sheet fills a phone's screen.
 *
 * Nothing on these screens is a length or a time.
 */
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromPlayedSave, openPromotions } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

/** The smallest touch target, 2.75rem at the default 16px root size. */
const TAP_TARGET_MIN_PX = 44;

/** A show's disclosure button: any button that is not a Why?. */
const SHOW_TOGGLE = /^(?!Why)/;

/** Where the spec leaves its screenshots, when asked (`E2E_SHOTS=<folder>`). */
const SHOTS_DIR = process.env['E2E_SHOTS'];

async function shot(page: Page, name: string, projectName: string): Promise<void> {
  if (SHOTS_DIR === undefined) return;
  await page.screenshot({ path: `${SHOTS_DIR}/${name}-${projectName}.png`, fullPage: true });
}

/** Opens the first computer-run promotion's profile from the Promotions list. */
async function openRivalProfile(page: Page, phone: boolean): Promise<void> {
  await openPromotions(page, phone);
  const hrefs = await page
    .locator('main a[href*="/game/promotions/pro_"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
  for (const href of [...new Set(hrefs)]) {
    await navigateInApp(page, href.split('?')[0] ?? href);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    if ((await page.getByText('Run by: Computer').count()) > 0) return;
  }
  throw new Error('The played save has no computer-run promotion.');
}

test.describe('rival shows and Auto-fill', () => {
  test('a rival’s aired show opens onto its card with a Why? per slot', async ({
    page,
  }, testInfo) => {
    const phone = isPhone(testInfo);
    await enterGameFromPlayedSave(page);
    await openRivalProfile(page, phone);

    await page.getByRole('tab', { name: 'Shows' }).click();
    await expect(page).toHaveURL(/\?tab=shows$/);
    const recent = page.getByRole('region', { name: 'Recent shows' });
    const upcoming = page.getByRole('region', { name: 'Coming up' });
    await expect(recent).toBeVisible();
    await expect(upcoming).toBeVisible();

    const aired = recent.locator('article[data-status="completed"]').first();
    const toggle = aired.getByRole('button', { name: SHOW_TOGGLE }).first();
    expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const card = aired.getByRole('list', { name: / card$/ });
    const filled = card.locator('article[data-state="booked"]');
    await expect(filled.first()).toBeVisible();
    const whys = card.getByRole('button', { name: /^Why this segment\? Slot / });
    await expect(whys).toHaveCount(await filled.count());
    await expect(card).not.toContainText(/minute/i);
    await expectNoHorizontalScroll(page);
    await shot(page, 'shows-tab', testInfo.project.name);

    await whys.last().click();
    const panel = page.getByRole('dialog', { name: /^Why this segment\? / });
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();

    const next = upcoming.locator('article[data-revealed="false"]').first();
    if ((await next.count()) > 0) {
      await next.getByRole('button', { name: SHOW_TOGGLE }).first().click();
      await expect(next.getByText('Card is revealed when the show airs')).toBeVisible();
    }
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
  });

  test('Auto-fill fills the player’s next show and leaves the winners open', async ({
    page,
  }, testInfo) => {
    await enterGameFromPlayedSave(page);
    await navigateInApp(page, '/game/booking');
    const panel = page.getByRole('region', { name: 'Auto-fill' });
    await expect(panel).toBeVisible();
    const fill = panel.getByRole('button', { name: 'Auto-fill empty slots' });
    await expect(fill).toBeEnabled();
    await expectNoHorizontalScroll(page);
    await shot(page, 'auto-fill-panel', testInfo.project.name);

    await fill.click();
    const sheet = page.getByRole('dialog', { name: /^Filled \d+ slots?$/ });
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByText('Pick a winner for each match before you run the show.'),
    ).toBeVisible();
    await expect(
      sheet.getByRole('button', { name: /^Why this segment\? Slot / }).first(),
    ).toBeVisible();
    await expect(sheet).not.toContainText(/minute/i);
    await expectNoHorizontalScroll(page);
    await shot(page, 'auto-fill-sheet', testInfo.project.name);
    await expectNoSeriousA11yViolations(page);

    await sheet.getByRole('button', { name: 'Done' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.locator('[data-part="winner"]')).toHaveCount(0);
  });

  test('the gallery’s rival show card fits, with full tap targets', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await page.goto('/dev/gallery#rival-show-card');
    await expect(
      page.getByRole('heading', { level: 2, name: 'Rival show card', exact: true }),
    ).toBeVisible();
    const entry = page.locator('#gallery-entry');
    await expectNoHorizontalScroll(page);
    await shot(page, 'rival-show-card-gallery', testInfo.project.name);
    if (phone) {
      for (const button of await entry.getByRole('button', { name: /^Why this/ }).all()) {
        const box = await button.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);
      }
    }
    await entry
      .getByRole('button', { name: /^Why this segment\? Slot 4/ })
      .first()
      .click();
    await expect(page.getByRole('dialog', { name: /^Why this segment\? / })).toBeVisible();
  });

  test('the reasons sheet fills a phone’s screen', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/dev/gallery#auto-fill-panel');
    await page
      .locator('#gallery-entry')
      .getByRole('button', { name: 'Open the reasons sheet' })
      .click();
    const sheet = page.getByRole('dialog', { name: 'Filled 3 slots' });
    await expect(sheet).toBeVisible();
    await expectNoHorizontalScroll(page);
    if (phone) {
      const box = await sheet.boundingBox();
      const viewport = page.viewportSize();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual((viewport?.height ?? 0) * 0.95);
    }
    await shot(page, 'auto-fill-sheet-gallery', testInfo.project.name);
  });
});
