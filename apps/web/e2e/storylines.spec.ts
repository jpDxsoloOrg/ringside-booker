import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { enterGameFromSampleSave, startDefaultWorldGame } from './helpers/game';
import { expectNoHorizontalScroll } from './helpers/layout';
import { navigateInApp } from './helpers/shell';
import { isPhone } from './helpers/viewport';

/** The sample save's storyline: Test Promotion A's, a face and a heel, two linked segments. */
const STORYLINE = 'Test Storyline A';

async function boxOf(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('The element has no box');
  return box;
}

/**
 * Creative > Storylines and a storyline's page in a real game (CRTV3-04): one h1, no sideways
 * scroll and no serious axe findings on desktop and phone. Faces sit left of the heels on desktop
 * and above them on a phone; the New storyline sheet fits too.
 */
test('the Storylines desk, a storyline page and the create sheet fit the screen', async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const phone = isPhone(testInfo);
  await enterGameFromSampleSave(page);
  await navigateInApp(page, '/game/storylines');
  await expect(page.locator('h1')).toHaveText('Storylines');
  const card = page.getByRole('article', { name: STORYLINE });
  await expect(card).toBeVisible();
  await expect(card.getByRole('meter', { name: 'Heat' })).toBeVisible();

  const faces = await boxOf(card.getByRole('list', { name: 'Faces' }));
  const heels = await boxOf(card.getByRole('list', { name: 'Heels' }));
  if (phone) {
    expect(heels.y).toBeGreaterThan(faces.y);
  } else {
    expect(heels.x).toBeGreaterThan(faces.x);
  }
  await expect(page.locator('h1')).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);

  await page.getByRole('button', { name: 'New storyline' }).first().click();
  const sheet = page.getByRole('dialog', { name: 'New storyline' });
  await expect(sheet.getByRole('button', { name: /^Add / }).first()).toBeVisible();
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();

  await card.getByRole('link', { name: STORYLINE }).click();
  await expect(page.locator('h1')).toHaveText(STORYLINE);
  await expect(page.getByRole('region', { name: 'Timeline' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'End storyline' })).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  await expectNoSeriousA11yViolations(page);
});

const ALTURA = 'Altura Wrestling Entertainment';

/** Building the default world and starting the game takes a while on a loaded machine. */
const GAME_TIMEOUT_MS = 240_000;

/**
 * With WRK1 (CRTV3-05): in a new default-world game as Altura, a starter storyline's member names
 * on the desk card and on the storyline page link to the worker's profile, and the heat Why? on
 * the page links each member's popularity line to them too.
 */
test('storyline members link to their worker profiles', async ({ page }) => {
  test.setTimeout(GAME_TIMEOUT_MS);
  await startDefaultWorldGame(page, ALTURA);
  await navigateInApp(page, '/game/storylines');
  await expect(page.locator('h1')).toHaveText('Storylines');
  const card = page.getByRole('main').getByRole('article').first();
  const storyline = ((await card.getByRole('heading').textContent()) ?? '').trim();
  const faceLink = card.getByRole('list', { name: 'Faces' }).getByRole('link').first();
  const face = ((await faceLink.textContent()) ?? '').trim();
  await expectNoHorizontalScroll(page);

  // The card's name goes to the worker's profile.
  await faceLink.click();
  await expect(page).toHaveURL(/\/game\/workers\/[^/?]+/);
  await expect(page.locator('h1')).toContainText(face);
  await expectNoHorizontalScroll(page);
  await page.goBack();
  await expect(page.locator('h1')).toHaveText('Storylines');

  // The storyline page: the member rows link too.
  await page
    .getByRole('main')
    .getByRole('article')
    .first()
    .getByRole('heading')
    .getByRole('link')
    .click();
  await expect(page.locator('h1')).toHaveText(storyline);
  const memberLink = page.getByRole('region', { name: 'Faces' }).getByRole('link', { name: face });
  await expect(memberLink).toHaveAttribute('href', /\/game\/workers\//);
  await expectNoHorizontalScroll(page);

  // The heat Why? names each member as a link to their profile.
  await page
    .getByRole('button', { name: /^Why is Heat / })
    .first()
    .click();
  const why = page.getByRole('dialog', { name: 'Heat' });
  await why.getByRole('button', { name: 'Expand all' }).click();
  const popularity = why.getByRole('link', { name: `${face}'s home popularity` });
  await expect(popularity).toBeVisible();
  await expect(popularity).toHaveAttribute('href', /\/game\/workers\//);
  await expectNoHorizontalScroll(page);
  await popularity.click();
  await expect(page).toHaveURL(/\/game\/workers\/[^/?]+/);
  await expect(page.locator('h1')).toContainText(face);
});
