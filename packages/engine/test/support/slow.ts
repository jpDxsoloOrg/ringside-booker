/**
 * The slow suites: statistical sweeps over thousands of generated people or names, default-world
 * balance runs and the CPU-budget speed guards. They run only when `RB_SLOW_TESTS=1`, which
 * `npm run verify:full` (the end-of-sprint run) sets, so a pull request's `npm test` stays fast.
 *
 * Mark a test with `it.runIf(SLOW_TESTS)` or a block with `describe.runIf(SLOW_TESTS)`. Keep save
 * compatibility, determinism and the core formulas in the default run: only the expensive
 * measurements of a distribution or a speed belong here.
 */
export const SLOW_TESTS = process.env['RB_SLOW_TESTS'] === '1';
