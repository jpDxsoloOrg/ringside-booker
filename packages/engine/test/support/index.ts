/**
 * `@ringside/engine/testing`: the shared test fixtures.
 *
 * Builders for every entity, `WorldBuilder`, the canned worlds and the assertion helpers, for the
 * engine's own tests and for tests in `tools/*` and `apps/web`. Lint keeps this entry out of app
 * and engine source, so fixtures never ship. See `README.md` next to this file.
 *
 * Outside the engine there is no shared setup file: call `resetTestIds()` in a `beforeEach` when a
 * test file builds standalone rows and needs IDs to restart per test.
 */

export * from './builders/build-row';
export * from './builders/people';
export * from './builders/promotions';
export * from './builders/creative';
export * from './builders/geography';
export * from './builders/media';
export * from './builders/inbox';
export * from './builders/ledger';
export { resetTestIds, testId, TestIds, TestIdSequence } from './ids';
export { setTestWriteValidation, testWriteValidation } from './write-validation';
export * from './world-builder';
export * from './worlds';
export * from './assertions';
export * from './serialise';
