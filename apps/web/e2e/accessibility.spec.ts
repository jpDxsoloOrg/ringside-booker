/**
 * The accessibility pass over the visual identity, on desktop and phone. Token tests check colour
 * pairs on paper; this spec checks them in place on the dark surfaces they really sit on:
 *
 * - Focus: every Tab stop in every gallery entry, in the shell and in the open overlays draws a
 *   ring at least 2px wide, with 3:1 contrast against the surface under it, that no clipping
 *   container cuts off.
 * - Reduced motion: from the device or from the in-game setting, the shell's ticker is a static
 *   list, the live bug's dot holds still, the nav links and top-bar buttons change colour without
 *   a transition, and nothing on the page runs an animation or a transition at all. The segmented
 *   meter (no longer in the shell since the live Office replaced the sample card's hype meter) is
 *   checked in its gallery entry instead.
 * - axe: the reduced-motion layouts (the static ticker, the still bug) have no serious or critical
 *   violations either. The default layouts are scanned by the gallery, shell and smoke specs.
 */
import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { inspectFocusRing, tabThroughAndCheckRings } from './helpers/focus';
import { GALLERY_ENTRY_IDS } from './helpers/gallery';
import { enterShell } from './helpers/shell';
import { isPhone, PROJECT_NAMES } from './helpers/viewport';

const GALLERY_PATH = '/dev/gallery';

const ENTRY_PANEL = '#gallery-entry';

/** Enough Tab stops for the busiest entry (the data table) without walking it all night. */
const MAX_STOPS_PER_ENTRY = 60;

/** The shell has the sidebar or tab bar, the top bar, the office and the ticker. */
const MAX_STOPS_IN_SHELL = 150;

/** Entries whose broadcast parts change under reduced motion, scanned again with motion off. */
const MOTION_ENTRIES: readonly { readonly id: string; readonly title: string }[] = [
  { id: 'ticker', title: 'Ticker' },
  { id: 'live-bug-button', title: 'LiveBugButton' },
  { id: 'segmented-meter', title: 'SegmentedMeter' },
  { id: 'day-control', title: 'Day control and status' },
];

interface GalleryEntrySummary {
  readonly id: string;
  readonly title: string;
}

/** The entries as the gallery lists them; the phone select carries all of them on both layouts. */
async function readEntries(page: Page): Promise<readonly GalleryEntrySummary[]> {
  await page.goto(GALLERY_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Component gallery' })).toBeVisible();
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('select option'), (option) => ({
      id: option.getAttribute('value') ?? '',
      title: option.textContent,
    })),
  );
}

/** Opens an entry by id alone, taking its title from the gallery's own list. */
async function gotoEntryById(page: Page, entryId: string): Promise<Locator> {
  await page.goto(`${GALLERY_PATH}#${entryId}`);
  const option = page.locator(`select option[value="${entryId}"]`);
  await expect(option, `a gallery entry with the id ${entryId}`).toHaveCount(1);
  return gotoEntry(page, { id: entryId, title: (await option.textContent()) ?? '' });
}

/** How many visible, enabled controls inside `selector` the Tab key should reach. */
async function countTabbable(page: Page, selector: string): Promise<number> {
  return page.evaluate((containerSelector) => {
    const container = document.querySelector(containerSelector);
    if (container === null) return 0;
    const candidates = container.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]',
    );
    return Array.from(candidates).filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        element.closest('[inert]') === null &&
        element.checkVisibility(),
    ).length;
  }, selector);
}

async function gotoEntry(page: Page, entry: GalleryEntrySummary): Promise<Locator> {
  await page.goto(`${GALLERY_PATH}#${entry.id}`);
  const heading = page.getByRole('heading', { level: 2, name: entry.title, exact: true });
  await expect(heading).toBeVisible();
  return heading;
}

/** Drops focus, so the next Tab starts again from the top of the page. */
async function blurActiveElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

interface MotionSnapshot {
  /** Animations the page is playing right now, by name. */
  readonly running: readonly string[];
  /** Elements whose transition would take longer than 0s, described briefly. */
  readonly transitions: readonly string[];
}

/** Every animation still playing and every element with a transition that takes any time. */
async function readMotion(page: Page): Promise<MotionSnapshot> {
  return page.evaluate(() => {
    const running = document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .map((animation) =>
        animation instanceof CSSAnimation ? animation.animationName : animation.constructor.name,
      );
    const transitions: string[] = [];
    for (const element of Array.from(document.querySelectorAll('*'))) {
      const style = window.getComputedStyle(element);
      const durations = style.transitionDuration.split(',').map((value) => parseFloat(value));
      if (durations.some((seconds) => seconds > 0)) {
        transitions.push(`${element.tagName.toLowerCase()}.${element.getAttribute('class') ?? ''}`);
      }
    }
    return { running, transitions };
  });
}

/** The longest transition of every element the locator matches, in seconds. */
async function longestTransitions(locator: Locator): Promise<readonly number[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) =>
      Math.max(
        ...getComputedStyle(element)
          .transitionDuration.split(',')
          .map((value) => parseFloat(value)),
      ),
    ),
  );
}

/**
 * The shell's parts that carry a transition: the nav links (the sidebar on desktop, the tab bar on
 * a phone) and the Next day bug. The checks name them, so a check that finds nothing moving
 * cannot pass just because they are gone. The ticker's Pause button transitions too, but a static
 * ticker has no Pause button, which the ticker check already covers.
 */
function shellTransitionParts(
  page: Page,
): readonly { readonly name: string; readonly locator: Locator }[] {
  return [
    {
      name: 'nav links',
      locator: page.getByRole('navigation', { name: /^(Main|Primary)$/ }).getByRole('link'),
    },
    {
      name: 'the Next day bug',
      locator: page.getByRole('banner').getByRole('button', { name: /^Next day/ }),
    },
  ];
}

/** The shell's motion parts are all still: static ticker, still dot, instant transitions, no motion. */
async function expectShellStill(page: Page): Promise<void> {
  const ticker = page.getByRole('region', { name: 'News ticker' });
  await expect(ticker).toHaveAttribute('data-motion', 'static');
  await expect(ticker.locator('[data-part="loop-copy"]')).toHaveCount(0);

  const dot = page
    .getByRole('banner')
    .getByRole('button', { name: /^Next day/ })
    .locator('[data-part="dot"]');
  await expect(dot).toHaveAttribute('data-motion', 'static');
  expect(await dot.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');

  for (const part of shellTransitionParts(page)) {
    const durations = await longestTransitions(part.locator);
    expect(durations.length, `the shell shows ${part.name}`).toBeGreaterThan(0);
    expect(new Set(durations), `${part.name} change without a transition`).toEqual(new Set([0]));
  }

  const motion = await readMotion(page);
  expect(motion.running, 'animations still playing').toEqual([]);
  expect(motion.transitions, 'elements that still transition').toEqual([]);
}

test.describe('focus rings', () => {
  test('the gallery lists exactly the entries the focus ring tests walk', async ({ page }) => {
    const entries = await readEntries(page);
    expect(entries.map((entry) => entry.id).sort()).toEqual([...GALLERY_ENTRY_IDS]);
  });

  // One test per entry, so a slow engine walks them in parallel and a failure names the entry.
  for (const entryId of GALLERY_ENTRY_IDS) {
    test(`every Tab stop in the ${entryId} gallery entry shows a clear, unclipped ring`, async ({
      page,
    }, testInfo) => {
      // WebKit answers each Tab stop slowly, and the busiest entries (the show results, with its
      // report and box office) walk dozens of them, so it gets the slow budget. The checks are
      // the same.
      test.slow(
        testInfo.project.name === PROJECT_NAMES.phoneWebkit,
        'WebKit walks Tab stops slowly',
      );
      const heading = await gotoEntryById(page, entryId);
      // A click on the heading starts the Tab order inside the entry, without focusing anything.
      await heading.click();
      const tabbable = await countTabbable(page, ENTRY_PANEL);
      const result = await tabThroughAndCheckRings(page, ENTRY_PANEL, MAX_STOPS_PER_ENTRY);
      if (tabbable > 0) {
        expect(result.stops, 'the walk reached the entry controls').toBeGreaterThan(0);
      }
      expect(result.failures, 'Tab stops whose focus ring falls short').toEqual([]);
    });
  }

  test('every Tab stop in the shell shows a clear, unclipped ring', async ({ page }) => {
    await enterShell(page);
    await blurActiveElement(page);
    const result = await tabThroughAndCheckRings(page, 'body', MAX_STOPS_IN_SHELL);
    expect(result.stops, 'the walk reached the shell controls').toBeGreaterThan(5);
    expect(result.failures, 'Tab stops whose focus ring falls short').toEqual([]);
  });

  test('the phone More sheet shows a ring on every Tab stop', async ({ page }, testInfo) => {
    test.skip(!isPhone(testInfo), 'The More sheet is the phone layout');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterShell(page);
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await expect(page.getByRole('dialog')).toBeVisible();
    // The sheet traps focus, so the walk wraps round inside it and stops there.
    const result = await tabThroughAndCheckRings(page, '[role="dialog"]', MAX_STOPS_IN_SHELL);
    expect(result.stops).toBeGreaterThan(10);
    expect(result.failures, 'Tab stops whose focus ring falls short').toEqual([]);
  });

  test('open menus, option lists and sheets show a ring on the focused item', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Menus and option lists move focus with the arrows, and Tab closes them, so the item the
    // arrows land on is checked where it is.
    await gotoEntry(page, { id: 'dropdown-menu', title: 'DropdownMenu' });
    await page.locator(ENTRY_PANEL).getByRole('button', { name: 'Actions', exact: true }).focus();
    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Book on next show' })).toBeFocused();
    expect((await inspectFocusRing(page)).problems, 'menu item ring').toEqual([]);
    await page.keyboard.press('Escape');

    await gotoEntry(page, { id: 'select', title: 'Select' });
    await page.locator(ENTRY_PANEL).getByRole('combobox', { name: 'Match type' }).focus();
    await page.keyboard.press('Enter');
    const listbox = page.getByRole('listbox');
    await expect(listbox).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(listbox.getByRole('option', { name: 'Tag team' })).toBeFocused();
    expect((await inspectFocusRing(page)).problems, 'option ring').toEqual([]);
    await page.keyboard.press('Escape');

    // A sheet traps focus, so the walk wraps round inside it and stops there.
    await gotoEntry(page, { id: 'sheet', title: 'Sheet' });
    await page.locator(ENTRY_PANEL).getByRole('button', { name: 'Open right md' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    const sheetWalk = await tabThroughAndCheckRings(page, '[role="dialog"]', 20);
    expect(sheetWalk.stops).toBeGreaterThan(1);
    expect(sheetWalk.failures, 'Tab stops whose focus ring falls short').toEqual([]);
  });
});

test.describe('reduced motion', () => {
  test('the device setting stills the ticker, the live bug and the transitions in the shell', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await enterShell(page);
    await expectShellStill(page);
  });

  test('the in-game setting stills the shell even when the device allows motion', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await enterShell(page);
    // With motion allowed, the crawl and the pulse really run, so the checks below can see them.
    const before = await readMotion(page);
    expect(before.running).toEqual(expect.arrayContaining([expect.stringContaining('crawl')]));
    // Something on the page transitions too (the ticker's Pause button on every layout, and the
    // nav links and the Next day bug on desktop), so the check that nothing does means something.
    expect(before.transitions, 'elements that transition with motion allowed').not.toEqual([]);

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-reduced-motion', 'on');
    });
    await expectShellStill(page);
  });

  test('the device setting and the in-game setting fill the segmented meter without a transition', async ({
    page,
  }) => {
    const meterTicks = page
      .locator(ENTRY_PANEL)
      .getByRole('meter', { name: 'Fatigue' })
      .locator('[data-part="tick"]');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await gotoEntry(page, { id: 'segmented-meter', title: 'SegmentedMeter' });
    const moving = await longestTransitions(meterTicks);
    expect(moving.length, 'the meter has ticks').toBeGreaterThan(0);
    expect(
      moving.every((seconds) => seconds > 0),
      'the ticks transition while motion is allowed',
    ).toBe(true);

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-reduced-motion', 'on');
    });
    expect(new Set(await longestTransitions(meterTicks)), 'in-game setting').toEqual(new Set([0]));

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await gotoEntry(page, { id: 'segmented-meter', title: 'SegmentedMeter' });
    const still = await longestTransitions(meterTicks);
    expect(still.length, 'the meter has ticks').toBeGreaterThan(0);
    expect(new Set(still), 'device setting').toEqual(new Set([0]));
  });

  test('the reduced-motion layouts have no serious accessibility issues', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const entry of MOTION_ENTRIES) {
      await test.step(entry.title, async () => {
        await gotoEntry(page, entry);
        await expectNoSeriousA11yViolations(page);
      });
    }
    await enterShell(page);
    await expectNoSeriousA11yViolations(page);
  });
});
