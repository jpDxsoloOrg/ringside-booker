import { fileURLToPath } from 'node:url';
import { expect } from '@playwright/test';
import type { Locator, Page, TestInfo } from '@playwright/test';
import { expectNoSeriousA11yViolations } from './a11y';
import { expectNoHorizontalScroll } from './layout';
import { isPhone } from './viewport';

/**
 * The e2e sample save: the engine's golden save (`v1-tiny.json`) encoded with `encodeSave` by
 * `fixtures/build-sample-save.ts`, which `npm run e2e` runs first.
 */
export const SAMPLE_SAVE_PATH = fileURLToPath(
  new URL('../fixtures/sample.rbsave', import.meta.url),
);

/** The slot label an imported sample gets. */
export const SAMPLE_SLOT_LABEL = 'Test save (imported)';

/** The sample world's date when it loads. */
export const SAMPLE_GAME_DATE = '2026-04-10';

/**
 * Enters a real game the way a player would: import the sample save from the title screen, load
 * it from the saved games list and wait for the office. The engine and the day pipeline then run
 * for real in the worker, with no dev-only loader and no test fixtures in the app bundle.
 */
export async function enterGameFromSampleSave(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
  await page.getByTestId('import-save-input').setInputFiles(SAMPLE_SAVE_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();
  await page
    .getByRole('article', { name: SAMPLE_SLOT_LABEL, exact: true })
    .getByRole('button', { name: `Load ${SAMPLE_SLOT_LABEL}` })
    .click();
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/**
 * The played e2e save: a default-world game three weeks in, with booked and run shows, built by
 * `fixtures/build-played-save.ts` (which `npm run e2e` runs first). Long tables, ledgers and a
 * filled calendar, for the phone layout checks.
 */
export const PLAYED_SAVE_PATH = fileURLToPath(
  new URL('../fixtures/sample-played.rbsave', import.meta.url),
);

/** The slot label the imported played save gets. */
export const PLAYED_SLOT_LABEL = 'Played save (imported)';

/** Imports the played save from the title screen, loads it and waits for the office. */
export async function enterGameFromPlayedSave(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
  await page.getByTestId('import-save-input').setInputFiles(PLAYED_SAVE_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();
  await page
    .getByRole('article', { name: PLAYED_SLOT_LABEL, exact: true })
    .getByRole('button', { name: `Load ${PLAYED_SLOT_LABEL}` })
    .click();
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/**
 * The injury e2e save: a default-world game as Altura whose Next day hurts one of the player's
 * own wrestlers, built by `fixtures/build-injury-save.ts` (which `npm run e2e` runs first).
 */
export const INJURY_SAVE_PATH = fileURLToPath(
  new URL('../fixtures/sample-injury.rbsave', import.meta.url),
);

/** The slot label the imported injury save gets. */
export const INJURY_SLOT_LABEL = 'Injury save (imported)';

/** Imports the injury save from the title screen, loads it and waits for the office. */
export async function enterGameFromInjurySave(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Ringside Booker' })).toBeVisible();
  await page.getByTestId('import-save-input').setInputFiles(INJURY_SAVE_PATH);
  await expect(page.getByRole('heading', { level: 1, name: 'Saved games' })).toBeVisible();
  await page
    .getByRole('article', { name: INJURY_SLOT_LABEL, exact: true })
    .getByRole('button', { name: `Load ${INJURY_SLOT_LABEL}` })
    .click();
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

/* ---------------------------------------------------------------- the new-game wizard */

/** A new-game wizard step's heading. */
export function stepHeading(page: Page, name: string): Locator {
  return page.getByRole('heading', { level: 2, name });
}

/**
 * Every step passes axe. On a phone, the page also fits and the Back/Next bar is on screen above
 * the bottom edge.
 */
export async function expectPhoneStepLayout(page: Page, phone: boolean): Promise<void> {
  await expectNoSeriousA11yViolations(page);
  if (!phone) return;
  await expectNoHorizontalScroll(page);
  const bar = page.getByTestId('wizard-actions');
  await expect(bar).toBeInViewport();
  const box = await bar.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (box !== null && viewport !== null) {
    expect(box.y + box.height, 'the action bar ends on screen').toBeLessThanOrEqual(
      viewport.height + 1,
    );
  }
  await expect(page.getByTestId('wizard-progress')).toBeVisible();
}

/** Opens the wizard from the title screen and waits for the world step with the world chosen. */
export async function openWizard(page: Page, phone: boolean): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: 'New game' }).click();
  await expect(page).toHaveURL(/\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'New game' })).toBeVisible();
  await expect(stepHeading(page, 'Choose a world')).toBeVisible();
  // The only bundled world is chosen by itself once its preview has loaded.
  await expect(page.getByRole('radio', { name: /Ringside Booker World/ })).toBeChecked();
  await expect(page.getByText('People', { exact: true })).toBeVisible();
  if (phone) await expect(page.getByText('Step 1 of 4 · World')).toBeVisible();
  await expectPhoneStepLayout(page, phone);
}

/** The wizard's Next button. */
export async function next(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Next' }).click();
}

/** Picks an option from one of the wizard's selects. */
export async function choose(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** The promotion name in the top bar: in the bar on desktop, in its status sheet on a phone. */
export async function expectPromotionInTopBar(
  page: Page,
  name: string,
  phone: boolean,
): Promise<void> {
  await expect(page).toHaveURL(/\/game\/office$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  const topBar = page.getByRole('banner');
  if (phone) {
    await topBar.getByTestId('status-date').click();
    await expect(page.getByRole('dialog').getByTestId('promotion-chip')).toHaveText(
      new RegExp(name),
    );
    await page.keyboard.press('Escape');
  } else {
    await expect(topBar.getByTestId('promotion-chip')).toHaveText(new RegExp(name));
    // The sidebar crest follows the save, not the sample promotion (UI-18).
    const crest = page.getByTestId('promotion-block');
    await expect(crest).toContainText(name);
    await expect(crest).not.toContainText('Sample');
    // Popularity explains itself even before a system moves it (UI-19). Since DAY2-02 the chip
    // shows the headline figure, whose Why? is titled "<Promotion> popularity".
    await topBar
      .getByTestId('popularity-chip')
      .getByRole('button', { name: /^Why is / })
      .click();
    await expect(page.getByRole('dialog')).toContainText(`${name} popularity`);
    await page.keyboard.press('Escape');
  }
}

/**
 * Picks an existing promotion on the wizard's promotion step: its grid row on desktop (the detail
 * pane then shows "About <name>"), its card and the detail sheet's "Choose this promotion" on a
 * phone.
 */
export async function chooseExistingPromotion(
  page: Page,
  name: string,
  phone: boolean,
): Promise<void> {
  if (phone) {
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    const sheet = page.getByRole('dialog', { name });
    await expect(sheet.getByText('Best-known wrestlers')).toBeVisible();
    await sheet.getByRole('button', { name: 'Choose this promotion' }).click();
    await expect(sheet).toBeHidden();
  } else {
    await page
      .getByRole('grid')
      .getByRole('row', { name: new RegExp(name) })
      .click();
    await expect(page.getByRole('heading', { name: `About ${name}` })).toBeVisible();
  }
}

export interface StartDefaultWorldGameOptions {
  /** The name typed on the Review step. "Alex Booker" by default. */
  readonly playerName?: string;
  /** Use the phone layout's controls. Worked out from the viewport's width when left out. */
  readonly phone?: boolean;
  /** Game options to change from their defaults on the options step. */
  readonly settings?: StartDefaultWorldGameSettings;
  /** The world seed, typed into the options step's Advanced Seed field. A random one otherwise. */
  readonly seed?: string;
}

/**
 * The seed the health e2e (`health-flow.spec.ts`) plays as Altura: its first 30-day skip stops
 * for one of Altura's own injuries after two show nights, with three people hurt world-wide, and
 * the worker is back within a few days. Found by `packages/engine/test/support/findHealthSeed.ts`;
 * run it again for a new one if the world or the injury rules change.
 */
export const HEALTH_E2E_SEED = 'health-e2e-136';

/** Opens the options step's Advanced section and types `seed` into its Seed field. */
async function typeSeed(page: Page, seed: string): Promise<void> {
  const field = page.getByRole('textbox', { name: 'Seed' });
  if (!(await field.isVisible())) {
    await page.getByRole('button', { name: 'Advanced' }).click();
  }
  await field.fill(seed);
  await expect(field).toHaveValue(seed);
}

/** The new-game options `startDefaultWorldGame` can switch on, by their setting key. */
export interface StartDefaultWorldGameSettings {
  /** Switches "Level playing field" on (AIP1-08): every Rival rules shortcut is off. */
  readonly levelPlayingField?: boolean;
}

/** The wizard switch for each setting `startDefaultWorldGame` can change. */
const SETTING_SWITCHES: readonly {
  readonly key: keyof StartDefaultWorldGameSettings;
  readonly label: string;
}[] = [{ key: 'levelPlayingField', label: 'Level playing field' }];

/** The width under which the app uses its phone layout (`--bp-mobile`, 48rem). */
const PHONE_MAX_WIDTH = 768;

/** Sets each given switch on the Game options step to the value asked for. */
async function applyWizardSettings(
  page: Page,
  settings: StartDefaultWorldGameSettings,
): Promise<void> {
  for (const { key, label } of SETTING_SWITCHES) {
    const wanted = settings[key];
    if (wanted === undefined) continue;
    const toggle = page.getByRole('switch', { name: label, exact: true });
    await toggle.setChecked(wanted);
    await expect(toggle).toBeChecked({ checked: wanted });
  }
}

/**
 * Starts a new game the way a player does, from a fresh profile: title → New game → the default
 * world → `promotion` (an existing one, by its full name) → the default options, apart from any
 * `options.settings` changes and the seed in `options.seed` → Start game, then waits for the Dashboard with the promotion in the
 * top bar. The world is built in the engine worker and saved into a slot, so Main menu and
 * Continue work afterwards.
 */
export async function startDefaultWorldGame(
  page: Page,
  promotion: string,
  options: StartDefaultWorldGameOptions = {},
): Promise<void> {
  const phone = options.phone ?? (page.viewportSize()?.width ?? PHONE_MAX_WIDTH) < PHONE_MAX_WIDTH;
  await openWizard(page, phone);
  await next(page);
  await expect(stepHeading(page, 'Choose your promotion')).toBeVisible();
  await chooseExistingPromotion(page, promotion, phone);
  await next(page);
  await expect(stepHeading(page, 'Game options')).toBeVisible();
  if (options.settings !== undefined) await applyWizardSettings(page, options.settings);
  if (options.seed !== undefined) await typeSeed(page, options.seed);
  await next(page);
  await expect(stepHeading(page, 'Review and start')).toBeVisible();
  await page.getByRole('textbox', { name: 'Your name' }).fill(options.playerName ?? 'Alex Booker');
  await page.getByRole('button', { name: 'Start game' }).click();
  await expectPromotionInTopBar(page, promotion, phone);
}

/**
 * Opens Your promotion > Roster from the shell: the sidebar link on desktop, the bottom bar's
 * second slot on a phone. Waits for the Roster heading.
 */
export async function openRoster(page: Page, testInfo: TestInfo): Promise<void> {
  if (isPhone(testInfo)) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Roster' })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Roster', exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/game\/roster(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Roster' })).toBeVisible();
}

/**
 * Opens World > Promotions from the shell: the sidebar link on desktop, the More sheet on a phone.
 * Waits for the Promotions heading.
 */
export async function openPromotions(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('link', { name: 'Promotions', exact: true })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Promotions', exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/game\/promotions(\?.*)?$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Promotions' })).toBeVisible();
}
