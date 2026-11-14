/**
 * The booker's title actions in a new default-world game as Altura (CRTV1-05): create "Test Crown"
 * (singles, women's, secondary) and land on its page, vacant, with the starting prestige's Why?;
 * award it to one of the women the award sheet lists; vacate it; retire it and find it under
 * Retired; bring it back vacant from its card's menu. A rival's title page has no actions. On a
 * phone each sheet opens from the bottom and nothing scrolls sideways; every step passes the
 * accessibility scan.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { startDefaultWorldGame } from './helpers/game';
import { expectFormFieldsAtLeast16px, expectNoHorizontalScroll } from './helpers/layout';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';
const CROWN = 'Test Crown';

/** Building the default world and starting the game takes a while on a loaded machine. */
const GAME_TIMEOUT_MS = 300_000;

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
  await expect(page.getByRole('heading', { level: 1, name: 'Titles' })).toBeVisible();
}

function actionBar(page: Page): Locator {
  return page.getByRole('group', { name: `Change the ${CROWN}` });
}

/** Presses one of the title page's actions: a button, or on a phone maybe in the More menu. */
async function pageAction(page: Page, name: string): Promise<void> {
  const bar = actionBar(page);
  const button = bar.getByRole('button', { name, exact: true });
  if ((await button.count()) > 0) {
    await button.click();
    return;
  }
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/** Confirms the open confirm dialog with its named button. */
async function confirm(page: Page, title: string, button: string): Promise<void> {
  const dialog = page.getByRole('alertdialog', { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** On a phone, the open sheet is a bottom sheet and the page doesn't scroll sideways. */
async function checkSheet(page: Page, sheet: Locator, phone: boolean): Promise<void> {
  await expect(sheet).toBeVisible();
  if (phone) {
    await expect(sheet).toHaveAttribute('data-side', 'bottom');
    await expectNoHorizontalScroll(page);
    await expectFormFieldsAtLeast16px(page);
  }
  await expectNoSeriousA11yViolations(page);
}

test.describe('Creative > Titles: actions', () => {
  test('create, award, vacate, retire and bring back a title', async ({ page }, testInfo) => {
    test.setTimeout(GAME_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, ALTURA);
    await openTitles(page, phone);

    // Create "Test Crown": singles, women's, secondary.
    await page.getByRole('button', { name: 'New title' }).click();
    const form = page.getByRole('dialog', { name: 'New title' });
    await checkSheet(page, form, phone);
    await form.getByRole('textbox', { name: 'Name' }).fill(CROWN);
    await form.getByRole('radio', { name: 'Singles' }).check();
    await form.getByRole('radio', { name: "Women's" }).check();
    await form.getByRole('radio', { name: /^Secondary/ }).check();
    await form.getByRole('button', { name: 'Create title' }).click();

    // Its page: vacant, prestige 44 from the secondary tier.
    await expect(page.getByRole('heading', { level: 1, name: CROWN })).toBeVisible();
    const champion = page.getByRole('region', { name: 'Champion' });
    await expect(champion.getByText(/^Vacant since/)).toBeVisible();
    await page.getByRole('button', { name: 'Why is Prestige 44?' }).click();
    const why = page.getByRole('dialog', { name: `Prestige: ${CROWN}` });
    await expect(why.getByText(/titles\.startPrestige\.secondary/).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(why).toBeHidden();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    // Award it: only women are offered; pick the first.
    await pageAction(page, 'Award');
    const award = page.getByRole('dialog', { name: `Award the ${CROWN}` });
    const wrestlers = award.getByRole('group', { name: 'Wrestlers' });
    await expect(wrestlers.getByRole('radio').first()).toBeVisible();
    await award.getByRole('switch', { name: "Show who can't hold it" }).click();
    const cannot = award.getByRole('group', { name: "Can't hold it" });
    await expect(cannot.getByRole('checkbox').first()).toBeVisible();
    const refusals = await cannot.getByRole('listitem').allInnerTexts();
    expect(refusals.length).toBeGreaterThan(0);
    for (const text of refusals) expect(text).toMatch(/women's title|Only wrestlers/);
    await checkSheet(page, award, phone);
    const first = wrestlers.getByRole('listitem').first();
    const winner = (await first.locator('[class*="pickName"]').innerText()).trim();
    await first.getByRole('radio').check();
    await award.getByRole('button', { name: 'Award', exact: true }).click();
    await expect(award).toBeHidden();
    await expect(champion.getByRole('link', { name: winner })).toBeVisible();
    const reigns = page.getByRole('region', { name: 'Lineage' }).locator('[data-row-id]');
    await expect(reigns.first()).toContainText('Current');
    await expectNoHorizontalScroll(page);

    // Vacate it.
    await pageAction(page, 'Vacate');
    await confirm(page, `Vacate the ${CROWN}?`, 'Vacate');
    await expect(champion.getByText(/^Vacant since/)).toBeVisible();
    await expect(reigns.first()).toContainText('Vacated');

    // Retire it: it shows as Retired, and under the Retired filter.
    await pageAction(page, 'Retire');
    await confirm(page, `Retire the ${CROWN}?`, 'Retire');
    await expect(actionBar(page).getByRole('button', { name: 'Reactivate' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Titles' }).click();
    // The filter lives in the URL: click, then wait for it to settle (check() races the router).
    await page.getByRole('radio', { name: /^Retired/ }).click();
    await expect(page).toHaveURL(/status=retired/);
    const card = page.getByRole('article', { name: CROWN });
    await expect(card).toBeVisible();

    // Bring it back from its card's menu: active again, vacant.
    await card.getByRole('button', { name: `Actions for the ${CROWN}` }).click();
    await page.getByRole('menuitem', { name: 'Reactivate' }).click();
    await confirm(page, `Bring the ${CROWN} back?`, 'Bring it back');
    await page.getByRole('radio', { name: /^Active/ }).click();
    await expect(page).not.toHaveURL(/status=retired/);
    await expect(card).toBeVisible();
    await expect(card.getByText('Vacant')).toBeVisible();

    // Its edit sheet fits the phone too.
    await card.getByRole('button', { name: `Actions for the ${CROWN}` }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    const edit = page.getByRole('dialog', { name: `Edit ${CROWN}` });
    await checkSheet(page, edit, phone);
    await edit.getByRole('button', { name: 'Cancel' }).click();
    await expect(edit).toBeHidden();

    // A rival's title: no menu on its card, no actions on its page.
    await page.getByRole('tab', { name: 'Around the world' }).click();
    const rivalCard = page.getByRole('main').getByRole('article').first();
    await expect(rivalCard).toBeVisible();
    await expect(rivalCard.getByRole('button', { name: /^Actions for/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New title' })).toHaveCount(0);
    await rivalCard.getByRole('heading').getByRole('link').click();
    await expect(page.getByRole('region', { name: 'Lineage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Award', exact: true })).toHaveCount(0);
  });
});
