import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/** WCAG 2.0 levels A and AA, the bar every screen has to clear. */
const AXE_TAGS = ['wcag2a', 'wcag2aa'];

/** Impacts that fail a test. Minor and moderate findings are left to manual review. */
const FAILING_IMPACTS: ReadonlySet<string> = new Set(['serious', 'critical']);

export interface A11yScanOptions {
  /** CSS selectors to scan instead of the whole page, for example one dialog. */
  readonly include?: readonly string[];
}

/**
 * Runs axe over the page (or the `include` selectors) and fails on any serious or critical
 * WCAG A/AA violation. The failure lists each rule id, its help URL and the offending targets.
 */
export async function expectNoSeriousA11yViolations(
  page: Page,
  options: A11yScanOptions = {},
): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS);
  for (const selector of options.include ?? []) {
    builder = builder.include(selector);
  }
  const results = await builder.analyze();

  const failures = results.violations
    .filter((violation) => FAILING_IMPACTS.has(violation.impact ?? ''))
    .map((violation) => {
      const targets = violation.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n');
      return `${violation.id} [${violation.impact ?? 'unknown'}] ${violation.help}\n  ${violation.helpUrl}\n${targets}`;
    });

  expect(failures, `Serious accessibility violations on ${page.url()}`).toEqual([]);
}
