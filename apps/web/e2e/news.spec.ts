/**
 * Office > News with a real world (DAY1-04): the sample save's two stories in the feed, a story
 * sheet opened from a headline and closed again, the filters kept in the URL, and on a phone the
 * filters in a bottom sheet. Every view fits the viewport with no serious axe findings.
 *
 * With its partners (DAY1-06), on the played save's three weeks of shows: the Office's Top stories
 * panel (DAY2) opens a story on the News screen, the run shows are Result stories (EVT3), and a
 * result story's "See results" opens that show's results.
 *
 * The owner test (DAY1-07), on a new default-world game as Altura: the opening story in the ticker
 * and on the front page, the reign milestones after a month of skipping, a buzz Why?, the filters,
 * the Skip sheet's targets, the "My champions" alert stopping a long skip and surviving Main menu,
 * and every sheet fitting the screen (at 150% UI scale too). The player's own shows stop every
 * skip on their nights; the specs cancel them, the way a player who isn't booking would.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { gameDate, openNewsButton, waitForDayBarSettled } from './helpers/booking';
import { clearDayStop, dayButton } from './helpers/contracts';
import {
  enterGameFromPlayedSave,
  enterGameFromSampleSave,
  openNews,
  skipDays,
  startDefaultWorldGame,
} from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const SEASON_HEADLINE = 'Season 1 has begun';
/** A show-result story's headline (EVT3 on the wire): "<Show> scores 62 out of 100". */
const SHOW_RESULT_HEADLINE = / scores \d+ out of 100$/;

test.describe('news', () => {
  test('reads the feed, opens a story and filters by kind', async ({ page }, testInfo) => {
    const phone = isPhone(testInfo);
    await enterGameFromSampleSave(page);
    // The crawl along the bottom carries the same stories.
    await expect(page.getByRole('region', { name: 'News ticker' })).toContainText(SEASON_HEADLINE);
    await navigateInApp(page, '/game/news');
    await expect(page.getByRole('heading', { level: 1, name: 'News' })).toBeVisible();

    const feed = page.getByRole('region', { name: 'All stories' });
    await expect(feed.getByText('2 stories')).toBeVisible();
    await expect(feed.getByRole('link', { name: SEASON_HEADLINE })).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);

    await feed.getByRole('link', { name: SEASON_HEADLINE }).click();
    await expect(page).toHaveURL(/story=nws_/);
    const sheet = page.getByRole('dialog', { name: SEASON_HEADLINE });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Kept in the archive');
    await expect(sheet).toContainText('Front page');
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).not.toHaveURL(/story=/);

    if (phone) {
      await feed.getByRole('button', { name: 'Filters' }).click();
      const filters = page.getByRole('dialog', { name: 'Filters' });
      await filters.getByRole('button', { name: 'Season', exact: true }).click();
      await expect(page).toHaveURL(/kind=season/);
      await expect(filters.getByRole('button', { name: 'Season', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expectNoSeriousA11yViolations(page);
      await filters.getByRole('button', { name: 'Show stories' }).click();
      await expect(filters).toBeHidden();
      await expect(feed.getByRole('button', { name: 'Filters, 1 on' })).toBeVisible();
    } else {
      await feed.getByRole('button', { name: 'Season', exact: true }).click();
      await expect(page).toHaveURL(/kind=season/);
    }
    await expect(feed.getByText('1 story')).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  test('the partners on the wire: Top stories on the Office, results and See results', async ({
    page,
  }, testInfo) => {
    const phone = isPhone(testInfo);
    await enterGameFromPlayedSave(page);

    await test.step('DAY2: Top stories on the Office opens a story', async () => {
      const panel = page.getByRole('region', { name: 'Top stories' });
      const stories = panel.getByRole('list', { name: 'Top stories' }).getByRole('listitem');
      await expect(stories.first()).toBeVisible();
      await expect(panel.getByRole('link', { name: 'Open news' })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await stories.first().getByRole('link').first().click();
      await expect(page).toHaveURL(/\/game\/news\?story=nws_/);
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    });

    await test.step('EVT3: a run show is a Result story with See results', async () => {
      await navigateInApp(page, '/game/news');
      const feed = page.getByRole('region', { name: 'All stories' });
      if (phone) {
        await feed.getByRole('button', { name: 'Filters' }).click();
        const filters = page.getByRole('dialog', { name: 'Filters' });
        await filters.getByRole('button', { name: 'Result', exact: true }).click();
        await filters.getByRole('button', { name: 'Show stories' }).click();
        await expect(filters).toBeHidden();
      } else {
        await feed.getByRole('button', { name: 'Result', exact: true }).click();
      }
      await expect(page).toHaveURL(/kind=result/);
      const headline = feed.getByRole('link', { name: SHOW_RESULT_HEADLINE }).first();
      await expect(headline).toBeVisible();
      await expectNoHorizontalScroll(page);
      await headline.click();
      const sheet = page.getByRole('dialog', { name: SHOW_RESULT_HEADLINE });
      await expect(sheet).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await sheet.getByRole('link', { name: 'See results' }).click();
      await expect(page).toHaveURL(/\/game\/event-history\/evi_/);
    });
  });
});

/* ---------------------------------------------------------------- the owner test (DAY1-07) */

const ALTURA = 'Altura Wrestling Entertainment';
/** The default world's first day. */
const GAME_START = '2027-01-04';
/** Far enough for the 1 February milestones to post (they post on Mondays). */
const MILESTONES_BY = '2027-02-02';
/** The latest a "My champions" stop may come (docs: Altura's champions on Monday 15 March). */
const CHAMPIONS_STOP_BY = '2027-03-16';
/** No news text mentions the clock or a match's length (D-10). */
const CLOCK_WORDS = /\bminutes?\b|\bmins?\b|\bhours?\b|\blength\b/i;
/** A reign milestone's headline: "<holders> reach(es) 300 days holding the <title>". */
const REIGN_MILESTONE_DAYS = [100, 200, 300] as const;

/** One of the default world pack's JSON files, as its records. */
function worldRecords(name: string): Record<string, unknown>[] {
  const url = new URL(`../../../content/worlds/default/${name}`, import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(url, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${name} is not a list`);
  return parsed.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  );
}

function textField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === 'string' ? value : '';
}

/** Altura's open reigns in the default world, with title and holder names. */
function alturaReigns(): { title: string; holders: string[]; wonOn: string }[] {
  const people = new Map(
    worldRecords('people.json').map((person) => [
      textField(person, 'key'),
      textField(person, 'defaultRingName'),
    ]),
  );
  const altura = new Map(
    worldRecords('titles.json')
      .filter((title) => textField(title, 'promotionKey') === 'pro-flagship')
      .map((title) => [textField(title, 'key'), textField(title, 'name')]),
  );
  return worldRecords('reigns.json')
    .filter((reign) => reign['lostOn'] === null && altura.has(textField(reign, 'titleKey')))
    .map((reign) => {
      const holderKeys = reign['holderPersonKeys'];
      return {
        title: altura.get(textField(reign, 'titleKey')) ?? '',
        holders: (Array.isArray(holderKeys) ? holderKeys : []).map((key) =>
          typeof key === 'string' ? (people.get(key) ?? key) : '',
        ),
        wonOn: textField(reign, 'wonOn'),
      };
    });
}

function addIso(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Altura's 100/200/300-day reign marks that fall from day one up to `until`. */
function alturaMilestonesUntil(until: string): { title: string; days: number }[] {
  const marks: { title: string; days: number }[] = [];
  for (const reign of alturaReigns()) {
    for (const days of REIGN_MILESTONE_DAYS) {
      const on = addIso(reign.wonOn, days);
      if (on >= GAME_START && on <= until) marks.push({ title: reign.title, days });
    }
  }
  return marks;
}

/** "Jan 11, 2027" in a feed row as an ISO date. */
function isoFromShortDate(text: string): string | null {
  const match = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(text);
  if (match === null) return null;
  const parsed = new Date(`${match[1] ?? ''} ${match[2] ?? ''}, ${match[3] ?? ''} UTC`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

/** "Mon 1 Feb 2027", the Skip sheet's chip detail date. */
function dayMonthYear(iso: string): string {
  const at = new Date(`${iso}T00:00:00Z`);
  const weekday = at.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const month = at.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${weekday} ${String(at.getUTCDate())} ${month} ${String(at.getUTCFullYear())}`;
}

/** The feed's rows: table rows on desktop, cards on a phone. */
function feedRows(page: Page): Locator {
  return page
    .getByRole('region', { name: 'All stories' })
    .locator('tbody tr[data-row-id], li[data-row-id]');
}

/** Sets the Kind filter to one kind: the bar's chip on desktop, the Filters sheet on a phone. */
async function filterByKind(page: Page, phone: boolean, kind: string): Promise<void> {
  const feed = page.getByRole('region', { name: 'All stories' });
  if (phone) {
    await feed.getByRole('button', { name: /^Filters/ }).click();
    const filters = page.getByRole('dialog', { name: 'Filters' });
    await filters.getByRole('button', { name: kind, exact: true }).click();
    await filters.getByRole('button', { name: 'Show stories' }).click();
    await expect(filters).toBeHidden();
  } else {
    await feed.getByRole('button', { name: kind, exact: true }).click();
  }
}

/** Switches "My promotion only" on: in the bar on desktop, in the Filters sheet on a phone. */
async function filterMyPromotion(page: Page, phone: boolean): Promise<void> {
  const feed = page.getByRole('region', { name: 'All stories' });
  if (phone) {
    await feed.getByRole('button', { name: /^Filters/ }).click();
    const filters = page.getByRole('dialog', { name: 'Filters' });
    await filters.getByRole('switch', { name: 'My promotion only' }).click();
    await filters.getByRole('button', { name: 'Show stories' }).click();
    await expect(filters).toBeHidden();
  } else {
    await feed.getByRole('switch', { name: 'My promotion only' }).click();
  }
}

/**
 * Skips with the "30 days" chip until the date reaches `date`, clearing each stop the way a
 * player who isn't booking does (tonight's show cancelled, notices marked seen, news read).
 * `onNewsStop` sees each news stop first; returning true means it has cleared the stop.
 */
async function skipThroughStopsTo(
  page: Page,
  date: string,
  onNewsStop?: () => Promise<boolean>,
): Promise<void> {
  for (let round = 0; (await gameDate(page)) < date; round += 1) {
    expect(round, 'the skip keeps stopping').toBeLessThan(60);
    await waitForDayBarSettled(page);
    if (onNewsStop !== undefined && (await openNewsButton(page).isVisible())) {
      if (await onNewsStop()) continue;
    }
    if (await clearDayStop(page)) continue;
    await skipDays(page, { chip: '30 days' });
  }
}

declare global {
  interface Window {
    /** What the stubbed clipboard was last given. */
    __copiedText?: string;
  }
}

/** Stubs the clipboard so "Copy as text" can be read back on every browser. */
async function captureClipboard(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          window.__copiedText = text;
          return Promise.resolve();
        },
      },
    });
  });
}

async function copiedText(page: Page): Promise<string> {
  return page.evaluate(() => window.__copiedText ?? '');
}

/** Leaves through Main menu (which saves), then Continue back into the game. */
async function mainMenuAndContinue(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page.getByRole('dialog', { name: 'Menu' }).getByTestId('main-menu').click();
  } else {
    await page.getByTestId('main-menu').click();
  }
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
  await page.getByRole('button', { name: /^Continue/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

test.describe('the news wire in a new game (DAY1-07)', () => {
  test('opening story, milestones, Why?, filters and the Skip sheet as Altura', async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(480_000);
    const phone = isPhone(testInfo);
    await startDefaultWorldGame(page, ALTURA);

    await test.step('the opening story in the ticker and on the front page', async () => {
      const ticker = page.getByRole('region', { name: 'News ticker' });
      await expect(ticker).toContainText(SEASON_HEADLINE);
      await expect(page.getByText('Sample news')).toHaveCount(0);
      await openNews(page, testInfo);
      const lead = page.getByRole('region', { name: 'Front page' }).getByRole('article').first();
      await expect(lead.getByRole('link', { name: SEASON_HEADLINE })).toBeVisible();
      await expect(lead).toContainText('Season');
      await expect(lead).toContainText('Buzz');
      await expect(lead.getByRole('button', { name: /^Why is Buzz \d+\?$/ })).toBeVisible();
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
    });

    await test.step('keyboard: Enter opens a headline, Escape closes it and focus returns', async () => {
      const headline = page
        .getByRole('region', { name: 'Front page' })
        .getByRole('link', { name: SEASON_HEADLINE });
      await headline.focus();
      await page.keyboard.press('Enter');
      const sheet = page.getByRole('dialog', { name: SEASON_HEADLINE });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute('data-side', phone ? 'bottom' : 'right');
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
      await expect(headline).toBeFocused();
    });

    await test.step('a month of skipping: the first news stop opens its story', async () => {
      const seen = { newsStop: false };
      await skipThroughStopsTo(page, MILESTONES_BY, async () => {
        if (seen.newsStop) return false;
        seen.newsStop = true;
        await openNewsButton(page).click();
        // The screen clears the alert and drops `alert=1`, keeping the story open.
        await expect(page).toHaveURL(/\/game\/news\?story=nws_[a-z0-9]+$/);
        const story = page.getByRole('dialog');
        await expect(story).toBeVisible();
        await story.getByRole('button', { name: 'Close' }).click();
        await expect(story).toBeHidden();
        await waitForDayBarSettled(page);
        await expect(openNewsButton(page)).toBeHidden();
        return true;
      });
      testInfo.annotations.push({
        type: 'news stop on the way',
        description: seen.newsStop ? 'yes' : 'no front-page alert before February',
      });
    });

    await test.step("Altura's reign milestones are in the feed, once each, dated in the month", async () => {
      await openNews(page, testInfo);
      await filterByKind(page, phone, 'Milestone');
      await expect(page).toHaveURL(/kind=milestone/);
      const rows = feedRows(page);
      await expect(rows.first()).toBeVisible();
      const texts = await rows.allTextContents();
      for (const text of texts) expect(text).toContain('Milestone');
      const expected = alturaMilestonesUntil('2027-02-01');
      expect(expected.length).toBeGreaterThanOrEqual(2);
      for (const { title, days } of expected) {
        await expect(
          rows.getByRole('link', {
            name: new RegExp(`reach(es)? ${String(days)} days holding the ${title}$`),
          }),
        ).toHaveCount(1);
      }
      for (const text of texts) {
        const iso = isoFromShortDate(text);
        expect(iso, text).not.toBeNull();
        const date = iso ?? '';
        expect(date >= GAME_START && date <= '2027-02-03', `${date} is within the skip`).toBe(true);
      }
      const headlines = await rows
        .getByRole('link')
        .evaluateAll((links) =>
          links
            .filter((link) => link.closest('h3, td, li') !== null)
            .map((link) => link.textContent),
        );
      expect(new Set(headlines).size, 'no story twice').toBe(headlines.length);
      // D-10: nothing on the page talks about the clock or a match's length.
      expect(await page.getByRole('main').innerText()).not.toMatch(CLOCK_WORDS);
      expect(await page.getByRole('region', { name: 'News ticker' }).innerText()).not.toMatch(
        CLOCK_WORDS,
      );
      await expectNoHorizontalScroll(page);
    });

    await test.step("a milestone's buzz Why? names its settings", async () => {
      await captureClipboard(page);
      const row = feedRows(page).filter({ hasText: 'Altura World Championship' }).first();
      await row.getByRole('button', { name: /^Why is Buzz \d+\?$/ }).click();
      const panel = page.getByRole('dialog', { name: /Buzz/ });
      await expect(panel).toBeVisible();
      await expect(panel).toContainText('Base for a milestone story');
      await expect(panel).toContainText('Importance');
      await expect(panel).toContainText('Popularity of');
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await panel.getByRole('button', { name: 'Copy as text' }).click();
      await expect(panel.getByRole('status')).toHaveText('Copied');
      const text = await copiedText(page);
      for (const key of [
        'news.buzz.kindBase.milestone',
        'news.buzz.importancePoints',
        'news.buzz.popularitySoftCap',
      ]) {
        expect(text).toContain(key);
      }
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
    });

    await test.step('My promotion only, and Back closes a story but keeps the filters', async () => {
      const before = await feedRows(page).count();
      await filterMyPromotion(page, phone);
      await expect(page).toHaveURL(/mine=1/);
      await expect(page).toHaveURL(/kind=milestone/);
      const rows = feedRows(page);
      await expect(rows.filter({ hasText: 'Altura World Championship' })).toHaveCount(1);
      expect(await rows.count()).toBeLessThanOrEqual(before);
      for (const text of await rows.allTextContents()) {
        expect(text).not.toMatch(/Eisenwerk|Cielo Alto|Tessen|Longleaf|Blast Furnace/);
      }
      if (phone) {
        // The feed is cards on a phone, and the filters a sheet from the bottom.
        await expect(rows.first()).toHaveJSProperty('tagName', 'LI');
        await page
          .getByRole('region', { name: 'All stories' })
          .getByRole('button', { name: /^Filters/ })
          .click();
        const filters = page.getByRole('dialog', { name: 'Filters' });
        await expect(filters).toHaveAttribute('data-side', 'bottom');
        const box = await filters.boundingBox();
        const viewport = page.viewportSize();
        expect(box !== null && viewport !== null).toBe(true);
        if (box !== null && viewport !== null) {
          expect(Math.abs(box.y + box.height - viewport.height)).toBeLessThanOrEqual(1);
        }
        await expectNoHorizontalScroll(page);
        await expectNoSeriousA11yViolations(page);
        await filters.getByRole('button', { name: 'Show stories' }).click();
        await expect(filters).toBeHidden();
      }
      await rows.getByRole('link', { name: /Altura World Championship$/ }).click();
      await expect(page).toHaveURL(/story=nws_/);
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.goBack();
      await expect(page.getByRole('dialog')).toBeHidden();
      await expect(page).not.toHaveURL(/story=/);
      await expect(page).toHaveURL(/kind=milestone/);
      await expect(page).toHaveURL(/mine=1/);
    });

    await test.step('the Skip sheet: its targets, and Until the 1st of next month', async () => {
      // On a show day the sheet is closed until the show is dealt with.
      await clearDayStop(page);
      await waitForDayBarSettled(page);
      const today = await gameDate(page);
      const firstOfNext = `${today.slice(0, 5)}${String(Number(today.slice(5, 7)) + 1).padStart(2, '0')}-01`;
      const daysToFirst = Math.round(
        (Date.parse(`${firstOfNext}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
      );
      if (phone) {
        await page.getByRole('banner').getByTestId('status-date').click();
        await page
          .getByRole('dialog', { name: 'Status' })
          .getByRole('button', { name: 'Skip days' })
          .click();
      } else {
        await page.getByRole('banner').getByRole('button', { name: 'Skip days' }).click();
      }
      const sheet = page.getByRole('dialog', { name: 'Skip days' });
      await expect(sheet).toBeVisible();
      const labels = await sheet.locator('[data-target-id] > span:first-child').allTextContents();
      // EVT1's "Until next show" (DAY1-06) comes first while a show of ours is ahead.
      expect(labels).toEqual([
        'Until next show',
        '7 days',
        '30 days',
        '90 days',
        'Until the 1st of next month',
      ]);
      await expect(
        sheet.getByRole('button', { name: 'Until the 1st of next month' }),
      ).toHaveAccessibleDescription(
        `${dayMonthYear(firstOfNext)} · ${String(daysToFirst)} day${daysToFirst === 1 ? '' : 's'}`,
      );
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await sheet.getByRole('button', { name: 'Cancel' }).click();
      await expect(sheet).toBeHidden();

      await skipDays(page, { chip: 'Until the 1st of next month' });
      const reached = await gameDate(page);
      if (reached !== firstOfNext) {
        // An earlier stop says why: tonight's show, or a story.
        expect(reached < firstOfNext).toBe(true);
        await expect(dayButton(page, /^(?!Next day$)/)).toBeVisible();
        await expect(page.getByRole('region', { name: 'Last advance' })).toBeVisible();
      }
    });
  });

  test('the My champions alert stops a long skip and survives Main menu', async ({
    page,
  }, testInfo: TestInfo) => {
    test.setTimeout(480_000);
    const phone = isPhone(testInfo);
    const champions = alturaReigns().flatMap((reign) => reign.holders);
    await startDefaultWorldGame(page, ALTURA);

    await test.step('News > Alerts: front-page stories on, the rest off; turn on My champions', async () => {
      await openNews(page, testInfo);
      await page.getByRole('button', { name: 'Alerts' }).click();
      const alerts = page.getByRole('dialog', { name: 'News alerts' });
      await expect(alerts).toHaveAttribute('data-side', phone ? 'bottom' : 'right');
      await expect(alerts.getByRole('switch', { name: 'Front-page stories' })).toBeChecked();
      for (const name of [
        'Stories about my promotion',
        'My roster',
        'My champions',
        'Title changes anywhere',
      ]) {
        await expect(alerts.getByRole('switch', { name })).not.toBeChecked();
      }
      await expectNoHorizontalScroll(page);
      await expectNoSeriousA11yViolations(page);
      await alerts.getByRole('switch', { name: 'My champions' }).click();
      await alerts.getByRole('button', { name: 'Save' }).click();
      await expect(alerts).toBeHidden();
    });

    await test.step('a 180-day skip stops for a story about an Altura champion', async () => {
      let found = false;
      for (let round = 0; !found; round += 1) {
        expect(round, 'a news stop comes').toBeLessThan(60);
        expect((await gameDate(page)) <= CHAMPIONS_STOP_BY, 'stopped by 16 March').toBe(true);
        await waitForDayBarSettled(page);
        if (await openNewsButton(page).isVisible()) {
          const summary = page.getByRole('region', { name: 'Last advance' });
          await expect(summary.getByText(/^News: /)).toBeVisible();
          await openNewsButton(page).click();
          await expect(page).toHaveURL(/\/game\/news\?story=nws_[a-z0-9]+$/);
          const story = page.getByRole('dialog');
          await expect(story).toBeVisible();
          const text = await story.innerText();
          found = champions.some((name) => text.includes(name));
          await story.getByRole('button', { name: 'Close' }).click();
          await expect(story).toBeHidden();
          await waitForDayBarSettled(page);
          await expect(openNewsButton(page)).toBeHidden();
          if (found) await expect(dayButton(page, 'Next day')).toBeVisible();
          continue;
        }
        if (await clearDayStop(page)) continue;
        await skipDays(page, 180);
      }
      expect((await gameDate(page)) <= CHAMPIONS_STOP_BY, 'stopped by 16 March').toBe(true);
    });

    await test.step('Main menu and Continue keep My champions on', async () => {
      await mainMenuAndContinue(page, phone);
      await openNews(page, testInfo);
      await page.getByRole('button', { name: 'Alerts' }).click();
      const alerts = page.getByRole('dialog', { name: 'News alerts' });
      await expect(alerts.getByRole('switch', { name: 'My champions' })).toBeChecked();
      await alerts.getByRole('button', { name: 'Cancel' }).click();
      await expect(alerts).toBeHidden();
    });
  });

  test('News and its sheets fit the screen at 150% UI scale with the ticker', async ({
    page,
  }, testInfo: TestInfo) => {
    const phone = isPhone(testInfo);
    await page.goto('/settings');
    await page.getByRole('slider', { name: 'UI scale' }).fill('1.5');
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.style.getPropertyValue('--ui-scale')),
      )
      .toBe('1.5');
    await enterGameFromSampleSave(page);
    await expect(page.getByRole('region', { name: 'News ticker' })).toBeVisible();
    await openNews(page, testInfo);
    await expectNoHorizontalScroll(page);

    const feed = page.getByRole('region', { name: 'All stories' });
    await feed.getByRole('link', { name: SEASON_HEADLINE }).click();
    const story = page.getByRole('dialog', { name: SEASON_HEADLINE });
    await expect(story).toBeVisible();
    await expectNoHorizontalScroll(page);
    await story.getByRole('button', { name: 'Close' }).click();
    await expect(story).toBeHidden();

    if (phone) {
      await feed.getByRole('button', { name: /^Filters/ }).click();
      const filters = page.getByRole('dialog', { name: 'Filters' });
      await expect(filters).toBeVisible();
      await expectNoHorizontalScroll(page);
      await filters.getByRole('button', { name: 'Show stories' }).click();
      await expect(filters).toBeHidden();
    }

    await page.getByRole('button', { name: 'Alerts' }).click();
    const alerts = page.getByRole('dialog', { name: 'News alerts' });
    await expect(alerts).toBeVisible();
    await expectNoHorizontalScroll(page);
    await expectNoSeriousA11yViolations(page);
    await alerts.getByRole('button', { name: 'Cancel' }).click();
    await expect(alerts).toBeHidden();
  });
});
