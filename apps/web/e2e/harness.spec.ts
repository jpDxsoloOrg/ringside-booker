/**
 * Checks the e2e helpers themselves against small pages built in the test, so a Playwright or
 * axe upgrade that quietly stops a check from firing shows up here instead of in a screen spec.
 */
import { allowConsoleError, expect, test } from './fixtures';
import { expectNoSeriousA11yViolations } from './helpers/a11y';
import { expectNoHorizontalScroll } from './helpers/layout';

const PAGE_HEAD = [
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<title>Harness check</title>',
  '<style>',
  '  .too-wide { width: calc(100vw + 200px); height: 10px; }',
  '  .clips { overflow-x: hidden; }',
  '  td, button { min-width: 44px; min-height: 44px; padding: 12px; }',
  '</style>',
].join('\n');

function buildPage(bodyHtml: string): string {
  return `<!doctype html><html lang="en"><head>${PAGE_HEAD}</head><body>${bodyHtml}</body></html>`;
}

/** A one-day calendar grid: a named cell with a day number, a marker and one show button. */
function gridWithCell(name: string, day: string, marker: string, show: string): string {
  return [
    '<main><h1>Grid</h1><table role="grid" aria-label="January 2027"><tbody><tr>',
    `<td role="gridcell" tabindex="0" aria-label="${name}">`,
    `<span>${day}</span> <span>${marker}</span> <button type="button">${show}</button>`,
    '</td></tr></tbody></table></main>',
  ].join('');
}

test.describe('harness: horizontal scroll check', () => {
  test('names the element that pushes past the right edge', async ({ page }) => {
    await page.setContent(buildPage('<main><h1>Wide</h1><div class="too-wide"></div></main>'));

    await expect(expectNoHorizontalScroll(page)).rejects.toThrow(
      /Page scrolls sideways.*widest offender: main > div\.too-wide/s,
    );
  });

  test('ignores overflow that a parent box clips', async ({ page }) => {
    await page.setContent(
      buildPage('<main class="clips"><h1>Clipped</h1><div class="too-wide"></div></main>'),
    );

    await expectNoHorizontalScroll(page);
  });
});

test.describe('harness: accessibility scan', () => {
  test('fails on a serious violation and names the rule', async ({ page }) => {
    await page.setContent(buildPage('<main><h1>Images</h1><img src="data:,"></main>'));

    await expect(expectNoSeriousA11yViolations(page)).rejects.toThrow(/image-alt/);
  });

  test('lets a grid cell hold named buttons when its own text is in its name', async ({ page }) => {
    await page.setContent(
      buildPage(
        gridWithCell('Monday, January 18, 2027, Draft day, 1 show', '18', 'Draft day', 'Raw'),
      ),
    );

    await expectNoSeriousA11yViolations(page);
  });

  test('fails a grid cell whose own text is missing from its name', async ({ page }) => {
    await page.setContent(
      buildPage(gridWithCell('Monday, January 18, 2027, 1 show', '18', 'Draft day', 'Raw')),
    );

    await expect(expectNoSeriousA11yViolations(page)).rejects.toThrow(
      /label-content-name-mismatch/,
    );
  });

  test('passes a page with no violations', async ({ page }) => {
    await page.setContent(buildPage('<main><h1>Clean</h1><p>Nothing to see.</p></main>'));

    await expectNoSeriousA11yViolations(page);
  });
});

test.describe('harness: console error trap', () => {
  test('fails a test whose page logs an error', async ({ page }) => {
    // The trap fails the test after the body ends, which is the expected outcome here.
    test.fail();
    await page.setContent(buildPage('<script>console.error("unexpected probe");</script>'));
  });

  test('fails a test whose page throws', async ({ page }) => {
    test.fail();
    await page.setContent(buildPage('<script>throw new Error("thrown probe");</script>'));
  });

  test('lets through an error the test allows', async ({ page }) => {
    allowConsoleError('expected probe');
    await page.setContent(buildPage('<script>console.error("expected probe");</script>'));
  });
});
