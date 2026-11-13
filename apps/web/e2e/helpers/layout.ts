import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

interface WidestElement {
  readonly selector: string;
  readonly right: number;
}

interface HorizontalScrollReport {
  readonly scrollWidth: number;
  readonly viewportWidth: number;
  /** The element reaching furthest past the right edge, or null when the page fits. */
  readonly widest: WidestElement | null;
}

/**
 * Runs inside the page. Measures the document against the viewport and, when it is too wide,
 * walks every element under <body> to find the one that sticks out furthest to the right.
 * Elements inside a box that clips or scrolls its own overflow are skipped: they cannot widen
 * the page, so naming them would point at the wrong culprit.
 */
function measureHorizontalScroll(): HorizontalScrollReport {
  const scrollingElement = document.scrollingElement ?? document.documentElement;
  const scrollWidth = scrollingElement.scrollWidth;
  // Mobile browsers widen window.innerWidth to fit content that overflows (a 600px box makes it
  // 600 on a 390px phone), which would hide the very overflow this check looks for. The root
  // element's clientWidth stays at the layout viewport width, minus any vertical scrollbar.
  const viewportWidth = Math.min(window.innerWidth, document.documentElement.clientWidth);
  if (scrollWidth <= viewportWidth) {
    return { scrollWidth, viewportWidth, widest: null };
  }

  const describe = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current !== null && current !== document.body && parts.length < 4) {
      let part = current.tagName.toLowerCase();
      if (current.id !== '') {
        part += `#${current.id}`;
      }
      for (const className of Array.from(current.classList)) {
        part += `.${className}`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  };

  const isInsideClippingBox = (element: Element): boolean => {
    let ancestor = element.parentElement;
    while (ancestor !== null && ancestor !== document.body) {
      if (window.getComputedStyle(ancestor).overflowX !== 'visible') {
        return true;
      }
      ancestor = ancestor.parentElement;
    }
    return false;
  };

  let widest: WidestElement | null = null;
  for (const element of Array.from(document.querySelectorAll('body *'))) {
    const right = element.getBoundingClientRect().right;
    if (right <= viewportWidth || (widest !== null && right <= widest.right)) {
      continue;
    }
    if (isInsideClippingBox(element)) {
      continue;
    }
    widest = { selector: describe(element), right: Math.round(right) };
  }
  return { scrollWidth, viewportWidth, widest };
}

/**
 * Fails when the page scrolls sideways, naming the element that pushes past the right edge.
 * Every screen has to fit a 390px phone without horizontal scrolling.
 */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const report = await page.evaluate(measureHorizontalScroll);
  const culprit =
    report.widest === null
      ? 'no single element reaches past the right edge'
      : `widest offender: ${report.widest.selector} (right edge at ${String(report.widest.right)}px)`;
  expect(
    report.scrollWidth,
    `Page scrolls sideways: content is ${String(report.scrollWidth)}px wide in a ` +
      `${String(report.viewportWidth)}px viewport; ${culprit}`,
  ).toBeLessThanOrEqual(report.viewportWidth);
}

/** iOS Safari zooms the page in when a text field under this size takes focus. */
export const IOS_NO_ZOOM_FONT_PX = 16;

/**
 * Fails when any visible text field (input, select, textarea or editable region) is under 16px.
 * On a phone iOS Safari zooms in when such a field takes focus and keeps the zoom across screens,
 * so the player has to pinch back out.
 */
export async function expectFormFieldsAtLeast16px(page: Page): Promise<void> {
  const small = await page.evaluate((minimum) => {
    const skipped = new Set(['checkbox', 'radio', 'range', 'file', 'color', 'hidden', 'button']);
    const fields = Array.from(
      document.querySelectorAll<HTMLElement>(
        'input, select, textarea, [contenteditable=""], [contenteditable="true"]',
      ),
    );
    return fields
      .filter((field) => !(field instanceof HTMLInputElement && skipped.has(field.type)))
      .filter((field) => field.getBoundingClientRect().width > 0)
      .map((field) => ({
        field: `${field.tagName.toLowerCase()}.${Array.from(field.classList).join('.')}`,
        size: Number.parseFloat(window.getComputedStyle(field).fontSize),
      }))
      .filter((entry) => entry.size < minimum)
      .map((entry) => `${entry.field} (${String(entry.size)}px)`);
  }, IOS_NO_ZOOM_FONT_PX);
  expect(small, 'Text fields under 16px make iOS Safari zoom in on focus').toEqual([]);
}

/**
 * Fails when a stylesheet still holds a media query in range syntax (`width < 48rem`): iOS Safari
 * before 16.4 ignores those rules, so the phone layout would never apply there. The build lowers
 * them to min-width / max-width (postcss.config.js).
 */
export async function expectNoRangeMediaQueries(page: Page): Promise<void> {
  const ranged = await page.evaluate(() => {
    const found: string[] = [];
    const visit = (rules: CSSRuleList): void => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) {
          if (/(width|height)\s*[<>]/.test(rule.conditionText)) found.push(rule.conditionText);
          visit(rule.cssRules);
        } else if (rule instanceof CSSSupportsRule) {
          visit(rule.cssRules);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        visit(sheet.cssRules);
      } catch {
        // A cross-origin sheet (none ship today) cannot be read; it is not ours to check.
      }
    }
    return [...new Set(found)];
  });
  expect(ranged, 'Range media queries are ignored by iOS Safari before 16.4').toEqual([]);
}
