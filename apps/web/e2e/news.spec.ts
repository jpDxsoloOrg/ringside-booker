/**
 * Office > News with a real world (DAY1-04): the sample save's two stories in the feed, a story
 * sheet opened from a headline and closed again, the filters kept in the URL, and on a phone the
 * filters in a bottom sheet. Every view fits the viewport with no serious axe findings.
 *
 * With its partners (DAY1-06), on the played save's three weeks of shows: the Office's Top stories
 * panel (DAY2) opens a story on the News screen, the run shows are Result stories (EVT3), and a
 * result story's "See results" opens that show's results.
 */
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromPlayedSave, enterGameFromSampleSave } from './helpers/game';
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
