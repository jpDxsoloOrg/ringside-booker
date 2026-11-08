import type { TestInfo } from '@playwright/test';

/** Playwright project names. playwright.config.ts builds its projects from these. */
export const PROJECT_NAMES = {
  desktop: 'desktop',
  phone: 'phone',
  phoneWebkit: 'phone-webkit',
} as const;

const PHONE_PROJECT_NAMES: ReadonlySet<string> = new Set([
  PROJECT_NAMES.phone,
  PROJECT_NAMES.phoneWebkit,
]);

/**
 * True when the running test belongs to one of the phone projects, so a spec can branch its
 * assertions, for example "sidebar visible" on desktop against "bottom nav visible" on a phone.
 */
export function isPhone(testInfo: TestInfo): boolean {
  return PHONE_PROJECT_NAMES.has(testInfo.project.name);
}
