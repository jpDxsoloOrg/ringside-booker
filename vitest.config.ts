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
  const busyCores = Math.round(loadavg()[0] ?? 0);
  return Math.max(Math.ceil(cores / 4), Math.min(cores - 1, cores - 1 - busyCores));
}

export default defineConfig({
  test: {
    maxWorkers: workerCount(),
    projects: [
      {
        test: {
          name: 'engine',
          root: `${repoRoot}packages/engine`,
          environment: 'node',
          include: ['test/**/*.test.ts'],
          // Restarts the TestIds counters and turns test-world write validation on before each test.
          setupFiles: ['test/support/setup.ts'],
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
