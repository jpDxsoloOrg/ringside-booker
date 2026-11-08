import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * WCAG 2.0, 2.1 and 2.2 levels A and AA, the bar every screen has to clear. The 2.1 and 2.2 tags
 * add rules such as label in name (2.5.3) and target size (2.5.8) that 2.0 alone does not run.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** Impacts that fail a test. Minor and moderate findings are left to manual review. */
const FAILING_IMPACTS: ReadonlySet<string> = new Set(['serious', 'critical']);

/**
 * One finding that is the pattern working as designed, not a fault. An open group in a tree view
 * (the Why? panel) is named by its own row with aria-labelledby, as the ARIA tree pattern asks,
 * while its visible text also takes in the child rows nested under it. Those rows are separate
 * tree items with their own names, so "label in name" is met row by row; axe reads the whole
 * subtree as the group's label and flags it.
 */
function isExpectedFinding(ruleId: string, html: string): boolean {
  return (
    ruleId === 'label-content-name-mismatch' &&
    html.includes('role="treeitem"') &&
    html.includes('aria-expanded="true"')
  );
}

export interface A11yScanOptions {
  /** CSS selectors to scan instead of the whole page, for example one dialog. */
  readonly include?: readonly string[];
}

/**
 * Runs axe over the page (or the `include` selectors) and fails on any serious or critical
 * WCAG 2.x A/AA violation. The failure lists each rule id, its help URL and the offending targets.
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
    .map((violation) => ({
      ...violation,
      nodes: violation.nodes.filter((node) => !isExpectedFinding(violation.id, node.html)),
    }))
    .filter((violation) => violation.nodes.length > 0)
    .map((violation) => {
      const targets = violation.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n');
      return `${violation.id} [${violation.impact ?? 'unknown'}] ${violation.help}\n  ${violation.helpUrl}\n${targets}`;
    });

  expect(failures, `Serious accessibility violations on ${page.url()}`).toEqual([]);
}
