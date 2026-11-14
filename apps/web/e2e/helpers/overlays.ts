import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/**
 * Closes `overlay` (a sheet or dialog) with Escape and waits for it to go.
 *
 * Escape only reaches the topmost Radix layer, and a layer starts listening for it a render
 * after the one above it unmounts: Radix re-renders the layers underneath and only then hands
 * the Escape listener down. Pressed in that short gap, right after a Why? panel or a confirm
 * dialog on top closed, the key reaches nobody. A person can't press a key that fast; a test can,
 * so Escape is pressed again while the overlay is still open.
 *
 * The overlay must be visible first. A modal hides the page under it from the accessibility tree
 * (`aria-hidden`), so a role locator for a sheet with a confirm dialog still open over it finds
 * nothing and would count as "hidden" without the sheet ever closing.
 */
export async function closeWithEscape(page: Page, overlay: Locator): Promise<void> {
  await expect(overlay).toBeVisible();
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(overlay).toBeHidden({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}
