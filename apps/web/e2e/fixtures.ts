import { test as base, expect } from '@playwright/test';
import type { TestInfo } from '@playwright/test';

/** Annotation type that lets one test accept console errors matching its description. */
export const ALLOWED_CONSOLE_ERROR = 'allowed-console-error';

/** One error the page reported while a test ran. */
export interface ConsoleErrorRecord {
  /** `console` for console.error output, `pageerror` for an uncaught exception. */
  readonly source: 'console' | 'pageerror';
  readonly text: string;
  /** Script URL and line for console messages, when the browser reports one. */
  readonly location?: string;
}

interface ConsoleErrorFixtures {
  /**
   * Every console error and uncaught page error seen during the test. The fixture runs for
   * every test, and once the test body finishes it fails the test if any error is left that
   * no `allowed-console-error` annotation covers.
   */
  consoleErrors: ConsoleErrorRecord[];
}

/**
 * Lets the current test pass even when the page logs an error containing `messagePart`.
 * Call it at the top of a test that triggers an expected error on purpose.
 */
export function allowConsoleError(messagePart: string, testInfo: TestInfo = base.info()): void {
  testInfo.annotations.push({ type: ALLOWED_CONSOLE_ERROR, description: messagePart });
}

function allowedMessageParts(testInfo: TestInfo): string[] {
  return testInfo.annotations
    .filter((annotation) => annotation.type === ALLOWED_CONSOLE_ERROR)
    .map((annotation) => annotation.description ?? '')
    .filter((messagePart) => messagePart !== '');
}

function describeError(record: ConsoleErrorRecord): string {
  const where = record.location === undefined ? '' : ` (${record.location})`;
  return `[${record.source}] ${record.text}${where}`;
}

/** The project's `test`: Playwright's test plus the console error trap. Specs import this one. */
export const test = base.extend<ConsoleErrorFixtures>({
  consoleErrors: [
    async ({ page }, use, testInfo) => {
      const records: ConsoleErrorRecord[] = [];

      page.on('console', (message) => {
        if (message.type() !== 'error') {
          return;
        }
        const { url, lineNumber } = message.location();
        records.push({
          source: 'console',
          text: message.text(),
          ...(url === '' ? {} : { location: `${url}:${String(lineNumber)}` }),
        });
      });
      page.on('pageerror', (error) => {
        records.push({ source: 'pageerror', text: error.stack ?? error.message });
      });

      await use(records);

      const allowed = allowedMessageParts(testInfo);
      const unexpected = records
        .filter((record) => !allowed.some((messagePart) => record.text.includes(messagePart)))
        .map(describeError);
      expect(unexpected, 'The page reported errors while the test ran').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
