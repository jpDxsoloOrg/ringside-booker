/**
 * The rival desk end to end in a new default-world game (AIP1-08), the way the owner tests it:
 * World > Promotions with all twelve companies and the Rival rules chip, Tessen Pro Wrestling's
 * profile through its three tabs with every Why? opened, a week of days that fills its decision
 * log with a roster review, your own profile, and a second game with the level playing field.
 * The phone projects also check the cards, the chip's bottom sheet, the KPI grid and the tab strip,
 * and that nothing scrolls sideways at 150% UI scale.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { skipDaysCancellingShows } from './helpers/booking';
import { enterGameFromSampleSave, openPromotions, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const PLAYER = 'Longleaf Championship Wrestling';
const RIVAL = 'Tessen Pro Wrestling';

/** A new game builds the default world in the worker and the flow skips a week. */
const FLOW_TIMEOUT_MS = 300_000;

/** The default world's promotions. */
const PROMOTION_COUNT = 12;

/** The six Rival rules shortcuts, in the order the list shows them. */
const SHORTCUTS = [
  'No in-match injuries',
  'No morale from results',
  'Score bonus',
  'Simpler booking',
  'No media requests',
  'No worker requests',
];

/** A money figure in any currency the formatter might use. */
const MONEY_FIGURE = /[$€£¥]\s?\d/;

/** The list's items: grid rows on desktop, cards on a phone. Header rows are left out. */
function promotionItems(page: Page, phone: boolean): Locator {
  return phone
    ? page.getByRole('list', { name: 'Promotions' }).getByRole('listitem')
    : page
        .getByRole('grid', { name: 'Promotions' })
        .getByRole('row')
        .filter({ has: page.getByRole('gridcell') });
}

/** One promotion's row or card. */
function promotionItem(page: Page, phone: boolean, name: string): Locator {
  return promotionItems(page, phone).filter({
    has: page.getByRole('link', { name, exact: true }),
  });
}

/**
 * Opens a Why? and checks it reads cleanly: expanded in full, no `undefined` or `NaN` anywhere.
 * Returns the open panel; the caller closes it.
 */
async function openWhy(page: Page, button: Locator, title: string | RegExp): Promise<Locator> {
  await button.click();
  const panel = page.getByRole('dialog', { name: title });
  await expect(panel).toBeVisible();
  const expandAll = panel.getByRole('button', { name: 'Expand all' });
  if (await expandAll.isVisible()) await expandAll.click();
  await expect(panel).not.toContainText(/undefined|NaN/);
  return panel;
}

async function closeWhy(page: Page, panel: Locator): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
}

/** Opens the Rival rules chip: a popover on desktop, a bottom sheet on a phone. */
async function openRivalRules(page: Page, phone: boolean, chipText: string): Promise<Locator> {
  await page.getByRole('button', { name: chipText, exact: true }).click();
  const rules = page.getByRole('dialog', { name: 'Rival rules' });
  await expect(rules).toBeVisible();
  if (phone) await expect(rules).toHaveAttribute('data-side', 'bottom');
  return rules;
}

/** Each shortcut in the open Rival rules list, with the state its badge shows. */
async function expectShortcutStates(
  rules: Locator,
  stateOf: (label: string) => string,
): Promise<void> {
  const items = rules.getByRole('list', { name: 'Shortcuts' }).getByRole('listitem');
  await expect(items).toHaveCount(SHORTCUTS.length);
  for (const [index, label] of SHORTCUTS.entries()) {
    const item = items.nth(index);
    await expect(item).toContainText(label);
    await expect(item).toContainText(stateOf(label));
  }
}

/** Fits the phone, and passes the accessibility scan. */
async function expectScreenFits(page: Page): Promise<void> {
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
}

/** The profile's tab strip scrolls sideways inside itself, never the page. */
async function expectTabStripScrollsInside(page: Page): Promise<void> {
  const overflowX = await page
    .getByRole('tablist')
    .evaluate((element) => window.getComputedStyle(element).overflowX);
  expect(['auto', 'scroll']).toContain(overflowX);
}

async function selectTab(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

async function openRivalProfile(page: Page, phone: boolean): Promise<void> {
  await promotionItem(page, phone, RIVAL).getByRole('link', { name: RIVAL, exact: true }).click();
  await expect(page).toHaveURL(/\/game\/promotions\/pro_[a-z0-9]+$/);
  await expect(page.getByRole('heading', { level: 1, name: RIVAL })).toBeVisible();
}

/** Sets the UI scale on the settings screen; it is stored, so the game opens with it. */
async function setUiScale(page: Page, scale: string): Promise<void> {
  await page.goto('/settings');
  await page.getByRole('slider', { name: 'UI scale' }).fill(scale);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')))
    .toBe(scale);
}

test.describe('Promotions and the rival desk in a new game', () => {
  test('lists every promotion, explains a rival and fills its decision log', async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PLAYER, { phone });

    await test.step('World > Promotions lists the twelve with who runs each', async () => {
      await openPromotions(page, phone);
      const items = promotionItems(page, phone);
      await expect(items).toHaveCount(PROMOTION_COUNT);
      await expect(page.getByText('12 promotions · 11 run by the computer')).toBeVisible();
      await expect(promotionItem(page, phone, PLAYER)).toContainText('You');
      for (const item of await items.all()) {
        if ((await item.getByRole('link', { name: PLAYER, exact: true }).count()) > 0) continue;
        await expect(item).toContainText('Computer');
      }
      await expect(page.getByRole('main')).not.toContainText(MONEY_FIGURE);
      await expectScreenFits(page);
    });

    await test.step('Tessen’s popularity is Japan’s regions weighted by population', async () => {
      const panel = await openWhy(
        page,
        promotionItem(page, phone, RIVAL).getByRole('button', {
          name: /^Why is Popularity in Japan/,
        }),
        'Popularity in Japan',
      );
      for (const region of ['Kanto', 'Kansai', 'Hokkaido'])
        await expect(panel).toContainText(region);
      await expect(panel).toContainText(/\d+\.\d% of the population/);
      await closeWhy(page, panel);
    });

    await test.step('the Rival rules chip lists six shortcuts, all on', async () => {
      const rules = await openRivalRules(page, phone, 'Rival rules: 6 on');
      await expectShortcutStates(rules, (label) => (label === 'Score bonus' ? '+3' : 'On'));
      await expect(rules).toContainText('apply only to promotions run by the computer');
      if (phone) await expectNoHorizontalScroll(page);
      await page.keyboard.press('Escape');
      await expect(rules).toBeHidden();
    });

    await test.step('Tessen’s Overview: key numbers, needs and the rules', async () => {
      await openRivalProfile(page, phone);
      if (!phone) {
        await expect(
          page
            .getByRole('navigation', { name: 'Main' })
            .getByRole('link', { name: 'Promotions', exact: true }),
        ).toHaveAttribute('aria-current', 'page');
      }
      await expect(page.getByText('Hard-hitting', { exact: true })).toBeVisible();
      await expect(page.getByText('Run by: Computer')).toBeVisible();
      for (const tab of ['Overview', 'Roster', 'Decision log']) {
        await expect(page.getByRole('tab', { name: tab, exact: true })).toBeVisible();
      }
      const kpis = page.getByRole('group', { name: 'Key numbers' });
      for (const kpi of [
        'Popularity at home',
        'Prestige',
        'Roster',
        'Champions',
        'Shows a month',
      ]) {
        await expect(kpis.getByRole('group', { name: kpi, exact: true })).toBeVisible();
      }
      await expect(kpis.getByRole('group', { name: 'Cash' })).toContainText('Private');
      await expect(page.getByRole('main')).not.toContainText(MONEY_FIGURE);

      for (const [label, title] of [
        [/^Why is Popularity in Japan/, 'Popularity in Japan'],
        [/^Why is Worldwide popularity/, 'Worldwide popularity'],
      ] as const) {
        const panel = await openWhy(
          page,
          page.getByRole('main').getByRole('button', { name: label }).first(),
          title,
        );
        await closeWhy(page, panel);
      }

      // The roster's measure always has a Why?; each need, when there is one, has its own.
      const demanded = await openWhy(
        page,
        page.getByRole('button', { name: /^Why is Wrestlers its largest show calls for/ }),
        /Wrestlers/,
      );
      await expect(demanded.getByText(/aip\.needs\./).first()).toBeVisible();
      await closeWhy(page, demanded);
      const needs = page.getByRole('list', { name: 'Needs, most pressing first' });
      if ((await needs.count()) > 0) {
        const need = await openWhy(
          page,
          needs.getByRole('button', { name: /^Why is Severity of / }).first(),
          /^Severity of /,
        );
        await expect(need.getByText(/aip\.needs\./).first()).toBeVisible();
        await closeWhy(page, need);
      } else {
        await expect(page.getByText('No pressing needs')).toBeVisible();
      }

      // A country in the drill-down explains itself the same way as the home figure.
      const places = page.getByRole('group', { name: `Popularity of ${RIVAL} by place` });
      const asia = places.getByRole('button', { name: 'Asia', exact: true });
      if ((await asia.getAttribute('aria-expanded')) === 'false') await asia.click();
      const country = await openWhy(
        page,
        places.getByRole('button', { name: /^Why is Popularity in Japan/ }),
        'Popularity in Japan',
      );
      await expect(country).toContainText(/% of the population/);
      await closeWhy(page, country);

      const scoreBonus = await openWhy(
        page,
        page.getByRole('button', { name: /^Why is Rival shortcut Score bonus/ }),
        /Score bonus/i,
      );
      await expect(scoreBonus).toContainText('ai.scoreBonus');
      await closeWhy(page, scoreBonus);

      if (phone) await expectTabStripScrollsInside(page);
      await expectScreenFits(page);
    });

    await test.step('Roster: a card value explains markets, taste and age', async () => {
      await selectTab(page, 'Roster');
      const panel = await openWhy(
        page,
        page.getByRole('button', { name: /^Why is Card value at / }).first(),
        `Card value at ${RIVAL}`,
      );
      await expect(panel).toContainText('markets');
      await expect(panel).toContainText('Style taste: Hard-hitting');
      await expect(panel).toContainText(/Age \d+/);
      await expect(panel.getByText(/aip\.cardValue\./).first()).toBeVisible();
      await closeWhy(page, panel);
      await expectScreenFits(page);
    });

    await test.step('a week of days brings a weekly roster review', async () => {
      await selectTab(page, 'Decision log');
      await expect(page.getByText('No decisions yet')).toBeVisible();
      await expectScreenFits(page);
      const profileUrl = new URL(page.url());

      // The skip stops on the player's Saturday show; the helper cancels it from the Calendar.
      await skipDaysCancellingShows(page, 7, phone);
      await navigateInApp(page, `${profileUrl.pathname}${profileUrl.search}`);
      await expect(page.getByRole('tab', { name: 'Decision log' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const entries = page.getByRole('list', { name: 'Decisions, newest first' });
      const review = entries.getByRole('listitem').filter({ hasText: 'Weekly roster review' });
      await expect(review).toHaveCount(1);
      const panel = await openWhy(
        page,
        review.getByRole('button', { name: /^Why is / }),
        /^Weekly roster review/,
      );
      await expect(panel).toContainText(/need/i);
      await closeWhy(page, panel);
      await expectScreenFits(page);
    });

    await test.step('your own profile shows your cash and no decision log', async () => {
      await page.getByRole('link', { name: 'Back to Promotions' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Promotions' })).toBeVisible();
      await promotionItem(page, phone, PLAYER)
        .getByRole('link', { name: PLAYER, exact: true })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: PLAYER })).toBeVisible();
      const cash = page.getByRole('group', { name: 'Cash' });
      await expect(cash).toContainText(MONEY_FIGURE);
      await expect(
        page.getByText(/^Plays by the full rules: rival shortcuts apply only/),
      ).toBeVisible();
      await expect(page.getByRole('tab', { name: 'Decision log' })).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });
  });

  test('the level playing field turns every shortcut off', async ({ page }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT_MS);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, PLAYER, { phone, settings: { levelPlayingField: true } });
    await openPromotions(page, phone);

    const rules = await openRivalRules(page, phone, 'Level playing field');
    await expect(rules).toContainText('This game was started with the level playing field');
    await expectShortcutStates(rules, () => 'Off');
    await page.keyboard.press('Escape');
    await expect(rules).toBeHidden();

    await openRivalProfile(page, phone);
    await expect(
      page.getByText(
        'Plays by the full rules: this game was started with the level playing field.',
      ),
    ).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('phone: nothing scrolls sideways at 150% UI scale', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'The phone layout at a larger UI scale');
    await setUiScale(page, '1.5');
    await enterGameFromSampleSave(page);
    await openPromotions(page, true);
    await expect(page.getByRole('list', { name: 'Promotions' })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.getByRole('button', { name: /^Rival rules/ }).click();
    await expect(page.getByRole('dialog', { name: 'Rival rules' })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await page.keyboard.press('Escape');

    await page.getByRole('link', { name: 'Test Promotion B', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Test Promotion B' })).toBeVisible();
    await expectTabStripScrollsInside(page);
    for (const tab of ['Overview', 'Roster', 'Decision log']) {
      await selectTab(page, tab);
      await expectNoHorizontalScroll(page);
    }
  });
});
