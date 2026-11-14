/**
 * Creative > Titles end to end, the owner's "How to test it" for CRTV1 (CRTV1-07), in one new
 * default-world game as Altura:
 *
 * - Our titles: six cards in Altura Mainstage, Altura Overclock and Promotion-wide; the World
 *   Championship's prestige Why? says the world file set it.
 * - Its page: the lineage newest first with a days-held Why?, the records, and the champion's
 *   Career tab linking back to the title.
 * - "Test Crown" (Singles, Women's, Secondary, Promotion-wide): prestige 44 from
 *   `titles.startPrestige.secondary`; awarded to a woman ("Won today"); Main menu (which saves)
 *   and Continue keep it, its lineage and its Why?; awarded to another woman ("Stripped");
 *   vacated (its Why? says the booker did it); retired and found under Retired; reactivated,
 *   vacant.
 * - Around the world: 22 cards in 11 groups, and a rival title's page with no actions.
 *
 * On a phone the cards stack in one column, the lineage is cards, every sheet and Why? panel opens
 * from the bottom (confirms stay the app's centred dialog) and nothing scrolls sideways, also at
 * 150% UI scale. Every Why? opened here is checked for "undefined" / "NaN", Why? panels and the
 * edit sheet hand focus back to their button, and every step passes the accessibility scan.
 *
 * It replaces the CRTV1-04 and CRTV1-05 specs (titles.spec.ts, titles-actions.spec.ts), which
 * each started their own default-world game for a subset of these steps.
 */
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { startDefaultWorldGame } from './helpers/game';
import { expectFormFieldsAtLeast16px, expectNoHorizontalScroll } from './helpers/layout';
import { closeWithEscape } from './helpers/overlays';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const ALTURA = 'Altura Wrestling Entertainment';
const WORLD_TITLE = 'Altura World Championship';
const OWN_GROUPS = ['Altura Mainstage', 'Altura Overclock', 'Promotion-wide'] as const;
const CROWN = 'Test Crown';

/** A new default-world game and the whole flow take a while, longest on phone WebKit. */
const FLOW_TIMEOUT_MS = 480_000;

/* ------------------------------------------------------------------------------ navigation */

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

/** On desktop the sidebar's Titles item stays highlighted on a title's page. */
async function expectTitlesNavCurrent(page: Page, phone: boolean): Promise<void> {
  if (phone) return;
  await expect(
    page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Titles', exact: true }),
  ).toHaveAttribute('aria-current', 'page');
}

/** Leaves through Main menu (which saves), then Continue from the title screen. */
async function saveAndContinue(page: Page, phone: boolean): Promise<void> {
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
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Main menu' })
    .getByRole('button', { name: /^Continue/ })
    .click();
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/** Sets the UI scale on the settings screen without reloading, so the game stays loaded. */
async function setUiScale(page: Page, scale: string): Promise<void> {
  await navigateInApp(page, '/settings');
  await page.getByRole('slider', { name: 'UI scale' }).fill(scale);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')))
    .toBe(scale);
}

/* ------------------------------------------------------------------------------ the list */

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

/** Clicks one of the list's status filters and waits for the URL (check() races the router). */
async function showStatus(page: Page, status: 'Active' | 'Retired'): Promise<void> {
  await page.getByRole('radio', { name: new RegExp(`^${status}`) }).click();
  if (status === 'Retired') {
    await expect(page).toHaveURL(/status=retired/);
  } else {
    await expect(page).not.toHaveURL(/status=retired/);
  }
}

/* ------------------------------------------------------------------------------ Why? panels */

/**
 * Opens the Why? behind `button`, checks the panel reads cleanly (no "undefined" or "NaN"),
 * shows `expected`, then closes it with Escape and checks focus went back to the button.
 */
async function checkWhy(
  page: Page,
  button: Locator,
  panelName: string | RegExp,
  expected: readonly (string | RegExp)[],
): Promise<void> {
  await button.click();
  const panel = page.getByRole('dialog', { name: panelName });
  await expect(panel).toBeVisible();
  if (isPhoneLayout(page)) {
    await expect(panel).toHaveAttribute('data-side', 'bottom');
    await expectNoHorizontalScroll(page);
  }
  for (const text of expected) {
    await expect(panel.getByText(text).first()).toBeVisible();
  }
  await expect(panel).not.toContainText(/undefined|NaN/);
  await closeWithEscape(page, panel);
  await expect(button).toBeFocused();
}

/* ------------------------------------------------------------------------------ title page */

function lineage(page: Page): Locator {
  return page.getByRole('region', { name: 'Lineage' });
}

function reigns(page: Page): Locator {
  return lineage(page).locator('[data-row-id]');
}

function championPanel(page: Page): Locator {
  return page.getByRole('region', { name: 'Champion' });
}

/** The lineage is a table on desktop and a card per reign on a phone. */
async function expectLineageLayout(page: Page, phone: boolean): Promise<void> {
  await expect(lineage(page).locator('[data-layout]').first()).toHaveAttribute(
    'data-layout',
    phone ? 'cards' : 'table',
  );
}

/** Presses one of the title page's actions: a button, or on a phone maybe in the More menu. */
async function pageAction(page: Page, name: string): Promise<void> {
  const bar = page.getByRole('group', { name: `Change the ${CROWN}` });
  const button = bar.getByRole('button', { name, exact: true });
  if ((await button.count()) > 0) {
    await button.click();
    return;
  }
  await bar.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

/** Confirms the open confirm dialog with its named button. */
async function confirm(page: Page, title: string | RegExp, button: string): Promise<void> {
  const dialog = page.getByRole('alertdialog', { name: title });
  await expect(dialog).toBeVisible();
  // Confirms are the app's centred dialog on every screen; on a phone they must still fit.
  if (isPhoneLayout(page)) await expectNoHorizontalScroll(page);
  await dialog.getByRole('button', { name: button, exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** The width under which the app uses its phone layout (`--bp-mobile`, 48rem). */
function isPhoneLayout(page: Page): boolean {
  return (page.viewportSize()?.width ?? 1440) < 768;
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

/** Awards the Test Crown from the open award sheet to its `index`th wrestler; returns her name. */
async function pickInAwardSheet(award: Locator, index: number): Promise<string> {
  const wrestlers = award.getByRole('group', { name: 'Wrestlers' });
  const pick = wrestlers.getByRole('listitem').nth(index);
  const name = (await pick.locator('[class*="pickName"]').innerText()).trim();
  await pick.getByRole('radio').check();
  await award.getByRole('button', { name: 'Award', exact: true }).click();
  return name;
}

test.describe('Creative > Titles, end to end', () => {
  test('our belts, a lineage, a new title through its whole life, and the world’s titles', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, ALTURA);

    await test.step('Our titles: three groups, six cards', async () => {
      await openTitles(page, phone);
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
    });

    const worldCard = page.getByRole('article', { name: WORLD_TITLE });
    await test.step('The World Championship’s prestige came from the world file', async () => {
      await checkWhy(
        page,
        worldCard.getByRole('button', { name: new RegExp(`^Why\\? ${WORLD_TITLE} prestige`) }),
        `Prestige: ${WORLD_TITLE}`,
        [/Prestige set by the world file/],
      );
    });

    await test.step('Its page: lineage newest first, days held explained, records', async () => {
      await worldCard.getByRole('link', { name: WORLD_TITLE }).click();
      await expect(page).toHaveURL(/\/game\/titles\/tit_[^/?]+$/);
      await expect(page.getByRole('heading', { level: 1, name: WORLD_TITLE })).toBeVisible();
      await expectTitlesNavCurrent(page, phone);
      await expect(championPanel(page).getByRole('list', { name: 'Champions' })).toBeVisible();
      await expectLineageLayout(page, phone);
      await expect(reigns(page).first()).toContainText('Current');
      const count = await reigns(page).count();
      expect(count).toBeGreaterThan(1);
      for (let index = 1; index < count; index += 1) {
        await expect(reigns(page).nth(index)).not.toContainText('Current');
      }
      // Days held for the reign still going, and for one that ended.
      await checkWhy(
        page,
        reigns(page)
          .first()
          .getByRole('button', { name: /^Why\? Days held in reign/ }),
        /Days held/,
        [/\d{1,2} [A-Z][a-z]{2} \d{4}/],
      );
      await checkWhy(
        page,
        reigns(page)
          .nth(1)
          .getByRole('button', { name: /^Why\? Days held in reign/ }),
        /Days held/,
        [/\d{1,2} [A-Z][a-z]{2} \d{4}/],
      );
      const records = page.getByRole('region', { name: 'Records' });
      for (const label of ['Longest reign', 'Most defences in a reign', 'Most reigns']) {
        await expect(records.getByText(label, { exact: true })).toBeVisible();
      }
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });

    await test.step('The champion’s Career tab links back to the title', async () => {
      await championPanel(page)
        .getByRole('list', { name: 'Champions' })
        .getByRole('link')
        .first()
        .click();
      await page.getByRole('tab', { name: 'Career' }).click();
      await page.getByRole('main').getByRole('link', { name: WORLD_TITLE }).first().click();
      await expect(page.getByRole('heading', { level: 1, name: WORLD_TITLE })).toBeVisible();
    });

    await test.step('New title: Test Crown, singles, women’s, secondary, promotion-wide', async () => {
      await openTitles(page, phone);
      const newTitle = page.getByRole('button', { name: 'New title' });
      await newTitle.click();
      const form = page.getByRole('dialog', { name: 'New title' });
      await checkSheet(page, form, phone);
      await form.getByRole('textbox', { name: 'Name' }).fill(CROWN);
      await form.getByRole('combobox', { name: 'Brand' }).click();
      await page.getByRole('option', { name: 'Promotion-wide', exact: true }).click();
      await form.getByRole('radio', { name: 'Singles' }).check();
      await form.getByRole('radio', { name: "Women's" }).check();
      await form.getByRole('radio', { name: /^Secondary/ }).check();
      await form.getByRole('button', { name: 'Create title' }).click();

      await expect(page.getByRole('heading', { level: 1, name: CROWN })).toBeVisible();
      await expect(page).toHaveURL(/\/game\/titles\/tit_[^/?]+$/);
      await expect(championPanel(page).getByText(/^Vacant since/)).toBeVisible();
      await expect(lineage(page).getByText('No champions yet')).toBeVisible();
      await checkWhy(
        page,
        page.getByRole('button', { name: 'Why is Prestige 44?' }),
        `Prestige: ${CROWN}`,
        [/titles\.startPrestige\.secondary/],
      );
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });

    let firstChampion = '';
    await test.step('Award it: only women are offered; she won it today', async () => {
      await pageAction(page, 'Award');
      const award = page.getByRole('dialog', { name: `Award the ${CROWN}` });
      await expect(
        award.getByRole('group', { name: 'Wrestlers' }).getByRole('radio').first(),
      ).toBeVisible();
      await award.getByRole('switch', { name: "Show who can't hold it" }).click();
      const cannot = award.getByRole('group', { name: "Can't hold it" });
      await expect(cannot.getByRole('checkbox').first()).toBeVisible();
      const refusals = await cannot.getByRole('listitem').allInnerTexts();
      expect(refusals.length).toBeGreaterThan(0);
      for (const text of refusals) expect(text).toMatch(/women's title|Only wrestlers/);
      await award.getByRole('switch', { name: "Show who can't hold it" }).click();
      await expect(cannot).toBeHidden();
      await checkSheet(page, award, phone);
      firstChampion = await pickInAwardSheet(award, 0);
      await expect(award).toBeHidden();
      await expect(championPanel(page).getByRole('link', { name: firstChampion })).toBeVisible();
      await expect(championPanel(page)).toContainText('Won today');
      await expect(reigns(page)).toHaveCount(1);
      await expect(reigns(page).first()).toContainText('Current');
      await expectNoHorizontalScroll(page);
    });

    await test.step('Main menu saves; Continue keeps Test Crown, its lineage and Why?', async () => {
      await saveAndContinue(page, phone);
      await openTitles(page, phone);
      const crown = page.getByRole('article', { name: CROWN });
      await expect(crown).toContainText(firstChampion);
      await crown.getByRole('link', { name: CROWN }).click();
      await expect(page.getByRole('heading', { level: 1, name: CROWN })).toBeVisible();
      await expect(championPanel(page).getByRole('link', { name: firstChampion })).toBeVisible();
      await expect(reigns(page)).toHaveCount(1);
      await checkWhy(
        page,
        page.getByRole('button', { name: 'Why is Prestige 44?' }),
        `Prestige: ${CROWN}`,
        [/titles\.startPrestige\.secondary/],
      );
    });

    await test.step('Award it to another woman: her reign ends as Stripped', async () => {
      await pageAction(page, 'Award');
      const award = page.getByRole('dialog', { name: `Award the ${CROWN}` });
      await expect(
        award.getByRole('group', { name: 'Wrestlers' }).getByRole('radio').first(),
      ).toBeVisible();
      const second = await pickInAwardSheet(award, 1);
      expect(second).not.toBe(firstChampion);
      const strip = page.getByRole('alertdialog', { name: `Award the ${CROWN} to ${second}?` });
      await expect(strip).toContainText(`${firstChampion}'s reign ends as Stripped.`);
      await confirm(page, `Award the ${CROWN} to ${second}?`, 'Award');
      await expect(championPanel(page).getByRole('link', { name: second })).toBeVisible();
      await expect(reigns(page)).toHaveCount(2);
      await expect(reigns(page).first()).toContainText('Current');
      await expect(reigns(page).nth(1)).toContainText('Stripped');
    });

    await test.step('Vacate it: the reign ends Vacated, and its Why? names the booker', async () => {
      await pageAction(page, 'Vacate');
      await confirm(page, `Vacate the ${CROWN}?`, 'Vacate');
      await expect(championPanel(page).getByText(/^Vacant since/)).toBeVisible();
      await expect(reigns(page).first()).toContainText('Vacated');
      await checkWhy(
        page,
        reigns(page)
          .first()
          .getByRole('button', { name: /^Why\? How reign \d+ ended/ }),
        /How it ended/,
        [/Vacated by the booker/],
      );
    });

    await test.step('Retire it: gone from Active, found under Retired', async () => {
      await pageAction(page, 'Retire');
      await confirm(page, `Retire the ${CROWN}?`, 'Retire');
      await expect(championPanel(page).getByText(/^Retired on/)).toBeVisible();
      await page.getByRole('link', { name: 'Back to Titles' }).click();
      await expect(cards(page)).toHaveCount(6);
      await expect(page.getByRole('article', { name: CROWN })).toHaveCount(0);
      await showStatus(page, 'Retired');
      const card = page.getByRole('article', { name: CROWN });
      await expect(card).toBeVisible();
      await card.getByRole('link', { name: CROWN }).click();
      await expect(page.getByRole('heading', { level: 1, name: CROWN })).toBeVisible();
      await expect(reigns(page)).toHaveCount(2);
    });

    await test.step('Reactivate it: active again, vacant', async () => {
      await pageAction(page, 'Reactivate');
      await confirm(page, `Bring the ${CROWN} back?`, 'Bring it back');
      await expect(championPanel(page).getByText(/^Vacant since/)).toBeVisible();
      await page.getByRole('link', { name: 'Back to Titles' }).click();
      await showStatus(page, 'Active');
      const card = page.getByRole('article', { name: CROWN });
      await expect(card).toBeVisible();
      await expect(card.getByText('Vacant')).toBeVisible();
      await expect(cards(page)).toHaveCount(7);
    });

    await test.step('Its edit sheet fits and hands focus back to the card’s menu', async () => {
      const menu = page
        .getByRole('article', { name: CROWN })
        .getByRole('button', { name: `Actions for the ${CROWN}` });
      await menu.click();
      await page.getByRole('menuitem', { name: 'Edit' }).click();
      const edit = page.getByRole('dialog', { name: `Edit ${CROWN}` });
      await checkSheet(page, edit, phone);
      await edit.getByRole('button', { name: 'Cancel' }).click();
      await expect(edit).toBeHidden();
      await expect(menu).toBeFocused();
    });

    await test.step('Around the world: 22 titles, and a rival title has no actions', async () => {
      await expect(page.getByRole('button', { name: 'New title' })).toBeVisible();
      await page.getByRole('tab', { name: 'Around the world' }).click();
      await expect(page).toHaveURL(/\?tab=world$/);
      await expect(cards(page)).toHaveCount(22);
      await expect(page.getByRole('main').getByRole('region', { name: / titles$/ })).toHaveCount(
        11,
      );
      await expect(page.getByRole('button', { name: 'New title' })).toHaveCount(0);
      await expect(
        page.getByRole('main').getByRole('button', { name: /^Actions for/ }),
      ).toHaveCount(0);
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);

      await cards(page).first().getByRole('heading').getByRole('link').click();
      await expect(lineage(page)).toBeVisible();
      await expect(page.getByRole('region', { name: 'Records' })).toBeVisible();
      await expect(page.getByRole('group', { name: /^Change the / })).toHaveCount(0);
      for (const name of ['Edit', 'Award', 'Vacate', 'Retire', 'Reactivate', 'More']) {
        await expect(page.getByRole('main').getByRole('button', { name, exact: true })).toHaveCount(
          0,
        );
      }
      await expectNoHorizontalScroll(page);
      await page.goBack();
      await expect(page).toHaveURL(/\?tab=world$/);
      await expect(cards(page)).toHaveCount(22);
    });

    if (phone) {
      await test.step('At 150% UI scale the list, a title page and a sheet still fit', async () => {
        await setUiScale(page, '1.5');
        await navigateInApp(page, '/game/titles');
        await expect(cards(page)).toHaveCount(7);
        await expectNoHorizontalScroll(page);
        await page.getByRole('button', { name: 'New title' }).click();
        const form = page.getByRole('dialog', { name: 'New title' });
        await expect(form).toHaveAttribute('data-side', 'bottom');
        await expectNoHorizontalScroll(page);
        await closeWithEscape(page, form);
        await page
          .getByRole('article', { name: WORLD_TITLE })
          .getByRole('link', { name: WORLD_TITLE })
          .click();
        await expect(page.getByRole('region', { name: 'Records' })).toBeVisible();
        await expectLineageLayout(page, phone);
        await expectNoHorizontalScroll(page);
      });
    }
  });
});
