import { availableParallelism, loadavg } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

/**
 * Test workers: vitest's default (one per core but one) on a quiet machine, fewer when the cores are
 * already busy. Several full runs at once (load average 15 to 45 on 20 cores) each started 19
 * workers, and the oversubscribed machine starved them: a worker whose call to the main process
 * (such as `onTaskUpdate`) went unanswered for vitest's fixed 60 s failed the run with "Timeout
 * calling". Leaving out the cores the 1-minute load average says are taken keeps the run's own
 * workers fed; a quarter of the cores is the floor, so a run always makes progress. A quiet run is
 * as fast as before; under load the run takes about as long, since the busy cores were not free
 * anyway. `--maxWorkers` on the command line still wins.
 */
function workerCount(): number {
  const cores = availableParallelism();
  // A CI runner runs one job at a time, so its load average is this job's own previous step (lint
  // and typecheck keep 2 to 4 cores busy). Counting that as other work left a single test worker
  // on the runner and made the test step four times slower (POL4-07).
  if (process.env['CI'] !== undefined) {
    return Math.max(2, cores - 1);
  }
  const busyCores = Math.round(loadavg()[0] ?? 0);
  return Math.max(Math.ceil(cores / 4), Math.min(cores - 1, cores - 1 - busyCores));
}

export default defineConfig({
  test: {
    maxWorkers: workerCount(),
    // The engine runs in worker threads that are reused between its test files, keeping their
    // module cache: collecting the engine's files fell from about 140 s to 10 s of a run
    // (POL4-07). Engine state lives in the world each test builds and setup.ts resets the
    // test-wide counters, so a file cannot see another's world; a test that reads a registry
    // systems add to when they load (new-game settings, tunables) must not assume which systems
    // another file in the same worker has loaded. The web app and the tools stay on the default
    // isolated forks: their tests mock modules and keep state in the DOM and module globals, and a
    // reused worker stalled the web run.
    poolOptions: { threads: { isolate: false } },
    projects: [
      {
        test: {
          name: 'engine',
          root: `${repoRoot}packages/engine`,
          environment: 'node',
          include: ['test/**/*.test.ts'],
          // Restarts the TestIds counters and turns test-world write validation on before each test.
          setupFiles: ['test/support/setup.ts'],
          // Reused threads that keep the engine's modules loaded (see `poolOptions` above).
          pool: 'threads',
          isolate: false,
        },
      },
      // Paths are absolute so the config works from a workspace too (`npm run test -w
      // @ringside/engine` runs vitest with the engine package as its working directory).
      // The web app keeps its test setup (jsdom, React plugin, aliases) in its own Vite config, so
      // `npm test` at the root and `npm test -w @ringside/web` run the same configuration.
      `${repoRoot}apps/web/vite.config.ts`,
      // Every tool workspace under tools/<name> brings its own vitest.config.ts. The glob names the
      // config file rather than 'tools/*' so files such as tools/README.md are not read as configs.
      `${repoRoot}tools/*/vitest.config.ts`,
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/engine/src/**'],
    },
  },
});
