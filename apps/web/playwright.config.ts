import { defineConfig, devices } from '@playwright/test';
import type { PlaywrightTestConfig, PlaywrightTestOptions } from '@playwright/test';
import { PROJECT_NAMES } from './e2e/helpers/viewport';

type ProjectList = NonNullable<PlaywrightTestConfig['projects']>;

/** The preview server's port. E2E_PORT moves it, so two checkouts can run their suites at once. */
const PREVIEW_PORT = Number(process.env['E2E_PORT'] ?? '4173');
const isCi = (process.env['CI'] ?? '') !== '';

/**
 * WebKit is the engine behind every iPhone browser, so it gets its own phone project. It is
 * slower to run and needs extra system libraries, so it only joins the run when E2E_WEBKIT=1:
 * CI sets that on pushes to main, and pull requests run Chromium only.
 */
const includeWebkit = process.env['E2E_WEBKIT'] === '1';

/** A 390px-wide phone, the narrowest layout every screen has to work at. */
const phoneSettings: Partial<PlaywrightTestOptions> = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
};

const chromiumProjects: ProjectList = [
  {
    name: PROJECT_NAMES.desktop,
    use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
  },
  {
    name: PROJECT_NAMES.phone,
    use: { browserName: 'chromium', ...phoneSettings },
  },
];

const webkitProjects: ProjectList = [
  {
    name: PROJECT_NAMES.phoneWebkit,
    // Playwright tags belong to tests, not projects, so the WebKit tag is recorded as metadata
    // where reports and CI can still read it.
    metadata: { tag: '@webkit' },
    use: { browserName: 'webkit', ...phoneSettings },
  },
];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${String(PREVIEW_PORT)}`,
    trace: 'retain-on-failure',
  },
  projects: includeWebkit ? [...chromiumProjects, ...webkitProjects] : chromiumProjects,
  webServer: {
    // The suite runs against a production build, the same bundle that ships, plus the dev-only
    // routes (the enter-shell helper) that VITE_E2E=1 registers. Shipped builds never set it.
    command: `npm run build && npx vite preview --port ${String(PREVIEW_PORT)} --strictPort`,
    port: PREVIEW_PORT,
    env: { VITE_E2E: '1' },
    reuseExistingServer: !isCi,
    // The build runs first, so give it longer than Playwright's 60 second default.
    timeout: 180_000,
  },
});
