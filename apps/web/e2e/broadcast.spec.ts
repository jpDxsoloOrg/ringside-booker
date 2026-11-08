/**
 * The broadcast kit in the component gallery, on desktop and phone. The gallery spec already opens
 * every entry for console errors, sideways scroll and accessibility; this spec checks what the kit
 * promises at each size: card slot sides stack on a phone, a four-stat score bug wraps to 2×2, the
 * ticker crawls, pauses and goes static with reduced motion, and the live bug meets the touch
 * target and holds its dot still with reduced motion.
 */
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { isPhone } from './helpers/viewport';

const GALLERY_PATH = '/dev/gallery';
const ENTRY_PANEL = '#gallery-entry';

/** The smallest touch target, 2.75rem at the default 16px root size. */
const TAP_TARGET_MIN_PX = 44;

/** Boxes on one row can differ by a pixel or two of rounding. */
const SAME_ROW_TOLERANCE_PX = 2;

async function gotoEntry(page: Page, entryId: string, entryTitle: string): Promise<Locator> {
  await page.goto(`${GALLERY_PATH}#${entryId}`);
  await expect(
    page.getByRole('heading', { level: 2, name: entryTitle, exact: true }),
  ).toBeVisible();
  return page.locator(ENTRY_PANEL);
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, 'element is rendered').not.toBeNull();
  return box ?? { x: 0, y: 0, width: 0, height: 0 };
}

async function computed(locator: Locator, property: string): Promise<string> {
  return locator.evaluate(
    (element, name) => window.getComputedStyle(element).getPropertyValue(name),
    property,
  );
}

test.describe('broadcast kit', () => {
  test('card slot sides sit side by side on desktop and stack on a phone', async ({
    page,
  }, testInfo) => {
    const entry = await gotoEntry(page, 'card-slot', 'CardSlot');
    const slot = entry.getByRole('article', { name: 'Slot 1: Opener' });
    const sideA = await boxOf(slot.locator('[data-side="a"]'));
    const sideB = await boxOf(slot.locator('[data-side="b"]'));

    if (isPhone(testInfo)) {
      expect(sideB.y, 'side B is below side A').toBeGreaterThanOrEqual(sideA.y + sideA.height);
      expect(Math.abs(sideB.x - sideA.x)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
    } else {
      expect(sideB.x, 'side B is right of side A').toBeGreaterThan(sideA.x + sideA.width);
      expect(Math.abs(sideB.y - sideA.y)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
    }

    // The empty slot offers both actions, and they meet the touch target on a phone.
    const empty = entry.getByRole('article', { name: 'Slot 3: Midcard' });
    for (const name of ['Add match', 'Add promo']) {
      const button = empty.getByRole('button', { name });
      await expect(button).toBeVisible();
      if (isPhone(testInfo)) {
        expect((await boxOf(button)).height).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);
      }
    }
  });

  test('a four-stat score bug is one row on desktop and 2×2 on a phone', async ({
    page,
  }, testInfo) => {
    const entry = await gotoEntry(page, 'score-bug', 'ScoreBug');
    const bug = entry.getByRole('group', { name: 'Last show' });
    const stats = bug.locator('dl > div');
    await expect(stats).toHaveCount(4);
    const boxes = await Promise.all([0, 1, 2, 3].map((index) => boxOf(stats.nth(index))));
    const [first, second, third, fourth] = boxes;
    if (first === undefined || second === undefined || third === undefined || fourth === undefined)
      return;

    if (isPhone(testInfo)) {
      expect(Math.abs(second.y - first.y)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
      expect(third.y, 'the third stat starts a second row').toBeGreaterThanOrEqual(
        first.y + first.height,
      );
      expect(Math.abs(third.x - first.x)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
      expect(Math.abs(fourth.y - third.y)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
    } else {
      for (const box of [second, third, fourth]) {
        expect(Math.abs(box.y - first.y)).toBeLessThanOrEqual(SAME_ROW_TOLERANCE_PX);
      }
    }
  });

  test('the ticker crawls, pauses from its button and keeps to the page width', async ({
    page,
  }) => {
    const entry = await gotoEntry(page, 'ticker', 'Ticker');
    const ticker = entry.getByRole('region', { name: 'News ticker' });
    const track = ticker.locator('[data-part="track"]');

    await expect(ticker).toHaveAttribute('data-motion', 'crawl');
    expect(await computed(track, 'animation-name')).not.toBe('none');
    expect(await computed(track, 'animation-play-state')).toBe('running');

    const pause = ticker.getByRole('button', { name: 'Pause ticker' });
    await pause.click();
    await expect(pause).toHaveAttribute('aria-pressed', 'true');
    // Move focus away so only the button state holds the crawl still.
    await page.getByRole('heading', { level: 2, name: 'Ticker' }).click();
    expect(await computed(track, 'animation-play-state')).toBe('paused');

    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const tickerBox = await boxOf(ticker);
    expect(tickerBox.x + tickerBox.width).toBeLessThanOrEqual(viewportWidth);
  });

  test('the ticker pauses under the pointer', async ({ page }, testInfo) => {
    test.skip(isPhone(testInfo), 'There is no hover on a touch screen.');

    const entry = await gotoEntry(page, 'ticker', 'Ticker');
    const ticker = entry.getByRole('region', { name: 'News ticker' });
    const track = ticker.locator('[data-part="track"]');
    // The headlines move, so point at the strip just past the badge rather than at an item.
    const badge = await boxOf(ticker.getByText('Breaking', { exact: true }));
    await page.mouse.move(badge.x + badge.width + 40, badge.y + badge.height / 2);
    expect(await computed(track, 'animation-play-state')).toBe('paused');
  });

  test('with reduced motion the ticker is a static list and the live dot holds still', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const tickerEntry = await gotoEntry(page, 'ticker', 'Ticker');
    const ticker = tickerEntry.getByRole('region', { name: 'News ticker' });
    await expect(ticker).toHaveAttribute('data-motion', 'static');
    await expect(ticker.locator('[data-part="loop-copy"]')).toHaveCount(0);
    await expect(ticker.getByRole('button')).toHaveCount(0);
    expect(await computed(ticker.locator('[data-part="track"]'), 'animation-name')).toBe('none');
    // Every headline is on screen: the static list wraps instead of clipping.
    for (const item of await ticker.getByRole('listitem').all()) {
      await expect(item).toBeInViewport();
    }

    const bugEntry = await gotoEntry(page, 'live-bug-button', 'LiveBugButton');
    const dot = bugEntry.getByRole('button', { name: 'Go live' }).locator('[data-part="dot"]');
    await expect(dot).toHaveAttribute('data-motion', 'static');
    expect(await computed(dot, 'animation-name')).toBe('none');
  });

  test('the in-game reduced motion setting also stills the ticker', async ({ page }) => {
    const entry = await gotoEntry(page, 'ticker', 'Ticker');
    const ticker = entry.getByRole('region', { name: 'News ticker' });
    await expect(ticker).toHaveAttribute('data-motion', 'crawl');

    await entry.getByRole('switch', { name: 'Reduced motion' }).click();
    await expect(ticker).toHaveAttribute('data-motion', 'static');
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'on');
  });

  test('live bug buttons pulse and meet the touch target on a phone', async ({
    page,
  }, testInfo) => {
    const entry = await gotoEntry(page, 'live-bug-button', 'LiveBugButton');
    const goLive = entry.getByRole('button', { name: 'Go live' });
    expect(await computed(goLive.locator('[data-part="dot"]'), 'animation-name')).not.toBe('none');
    expect(await computed(goLive, 'transform')).not.toBe('none');

    const nextDay = entry.getByRole('button', { name: 'Next day' });
    await nextDay.click();
    await expect(entry.getByText('Day 15')).toBeVisible();

    if (isPhone(testInfo)) {
      for (const button of await entry.getByRole('button').all()) {
        expect((await boxOf(button)).height).toBeGreaterThanOrEqual(TAP_TARGET_MIN_PX);
      }
    }
  });

  test('the segmented meter fills red-orange past its danger threshold', async ({ page }) => {
    const entry = await gotoEntry(page, 'segmented-meter', 'SegmentedMeter');
    const fatigue = entry.getByRole('meter', { name: 'Fatigue' });
    await expect(fatigue).toHaveAttribute('aria-valuetext', '50');

    const work = entry.getByRole('button', { name: 'Work a match' });
    await work.click();
    await work.click();
    await work.click();
    await expect(fatigue).toHaveAttribute('aria-valuetext', '80, Danger');
    await expect(fatigue).toHaveAttribute('data-danger', 'true');
    await expect(fatigue.locator('[data-zone="danger"][data-filled="true"]')).not.toHaveCount(0);
  });
});
