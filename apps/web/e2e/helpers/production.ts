import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Business > Production from the e2e side (ECO7): opening the screen, asking for a level through
 * an area's − / + and the change dialog's own stepper, and confirming. Roles and labels only.
 */

/**
 * Opens Business > Production from the shell: the sidebar link on desktop, the More sheet on a
 * phone. Waits for the heading and the "Every month" group.
 */
export async function openProduction(page: Page, phone: boolean): Promise<void> {
  if (phone) {
    await page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('button', { name: 'More' })
      .click();
    await page
      .getByRole('dialog', { name: 'Menu' })
      .getByRole('link', { name: 'Production', exact: true })
      .click();
  } else {
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Production', exact: true })
      .click();
  }
  await expect(page).toHaveURL(/\/game\/production$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Production' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Every month' })).toBeVisible();
}

/** An area's row on the screen: "Camera", "Back office". */
export function areaRow(page: Page, area: string): Locator {
  return page.getByRole('listitem', { name: area });
}

/** The level an area's row shows, from its meter. */
export async function levelOf(page: Page, area: string): Promise<number> {
  const meter = areaRow(page, area).getByRole('meter', { name: `${area} level` });
  return Number(await meter.getAttribute('aria-valuenow'));
}

/** The open change dialog (an alert dialog named "Camera: level 2 → 4"). */
export function changeDialog(page: Page): Locator {
  return page.getByRole('alertdialog');
}

/**
 * Asks for `level` on `area`: the row's − or + opens the change dialog one step away, then the
 * dialog's own stepper walks it the rest of the way. Leaves the dialog open on "<Area>: level
 * <from> → <level>" and returns it. Stops early when the stepper holds a button back (a TV deal's
 * camera minimum), leaving the dialog on the last level it reached.
 */
export async function requestLevel(page: Page, area: string, level: number): Promise<Locator> {
  const from = await levelOf(page, area);
  expect(level, `${area} is already at level ${String(level)}`).not.toBe(from);
  const verb = level > from ? 'Raise' : 'Lower';
  await areaRow(page, area)
    .getByRole('button', { name: `${verb} ${area}` })
    .click();
  const dialog = changeDialog(page);
  await expect(dialog).toBeVisible();
  const step = dialog.getByRole('button', { name: `${verb} ${area}` });
  let at = level > from ? from + 1 : from - 1;
  while (at !== level) {
    if ((await step.getAttribute('aria-disabled')) === 'true') break;
    await step.click();
    at += level > from ? 1 : -1;
    await expect(dialog).toHaveAccessibleName(`${area}: level ${String(from)} → ${String(at)}`);
  }
  await expect(dialog).toHaveAccessibleName(`${area}: level ${String(from)} → ${String(at)}`);
  return dialog;
}

/** Presses the dialog's confirm button once the preview allows it, and waits for it to close. */
export async function confirmChange(page: Page): Promise<void> {
  const dialog = changeDialog(page);
  const confirm = dialog.getByRole('button', {
    name: /^(Pay \$[\d,]+ and raise|Raise to|Lower to)/,
  });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(dialog).toBeHidden();
}
