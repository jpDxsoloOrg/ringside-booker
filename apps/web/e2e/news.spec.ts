/**
 * Office > News with a real world (DAY1-04): the sample save's two stories in the feed, a story
 * sheet opened from a headline and closed again, the filters kept in the URL, and on a phone the
 * filters in a bottom sheet. Every view fits the viewport with no serious axe findings.
 */
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromSampleSave } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

const SEASON_HEADLINE = 'Season 1 has begun';

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
});
