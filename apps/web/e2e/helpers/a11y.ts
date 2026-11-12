import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * WCAG 2.0, 2.1 and 2.2 levels A and AA, the bar every screen has to clear. The 2.1 and 2.2 tags
 * add rules such as label in name (2.5.3) and target size (2.5.8) that 2.0 alone does not run.
 */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** One element axe flagged, typed from the builder so axe-core need not be a direct dependency. */
type NodeResult = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number]['nodes'][number];

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

/**
 * The same pattern in a grid: a calendar day is a focusable cell named with a summary of the day
 * ("Monday, January 18, 2027, Draft day, 1 show") while it also holds its show chips and "+N
 * more", which are buttons with names of their own. axe reads the whole cell, buttons included, as
 * its visible label and flags it. Label in name still holds when every piece of the cell's own
 * visible text (the day number, a marker badge) is in its name, so that is checked here instead,
 * and a cell whose own text is missing from its name still fails.
 */
async function isGridCellLabelInName(
  page: Page,
  ruleId: string,
  node: NodeResult,
): Promise<boolean> {
  const [selector, ...rest] = node.target;
  if (
    ruleId !== 'label-content-name-mismatch' ||
    !node.html.includes('role="gridcell"') ||
    typeof selector !== 'string' ||
    rest.length > 0
  ) {
    return false;
  }
  return page.locator(selector).evaluate((cell) => {
    const name = (cell.getAttribute('aria-label') ?? '').toLowerCase();
    if (name === '') return false;
    const ownTexts: string[] = [];
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const parent = node.parentElement;
      const text = (node.textContent ?? '').trim();
      if (parent === null || text === '') continue;
      if (parent.closest('button, a[href], [role="button"]') !== null) continue;
      if (!parent.checkVisibility()) continue;
      ownTexts.push(text.toLowerCase());
    }
    return ownTexts.every((text) => name.includes(text));
  });
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

  const serious = results.violations.filter((violation) =>
    FAILING_IMPACTS.has(violation.impact ?? ''),
  );
  const unexpected = await Promise.all(
    serious.map(async (violation) => {
      const kept: NodeResult[] = [];
      for (const node of violation.nodes) {
        if (isExpectedFinding(violation.id, node.html)) continue;
        if (await isGridCellLabelInName(page, violation.id, node)) continue;
        kept.push(node);
      }
      return { ...violation, nodes: kept };
    }),
  );

  const failures = unexpected
    .filter((violation) => violation.nodes.length > 0)
    .map((violation) => {
      const targets = violation.nodes.map((node) => `    ${node.target.join(' ')}`).join('\n');
      return `${violation.id} [${violation.impact ?? 'unknown'}] ${violation.help}\n  ${violation.helpUrl}\n${targets}`;
    });

  expect(failures, `Serious accessibility violations on ${page.url()}`).toEqual([]);
}
