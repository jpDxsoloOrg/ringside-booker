/**
 * `@ringside/engine/testing/fixtures`: the shared fixtures without the Vitest assertion helpers.
 *
 * Everything `@ringside/engine/testing` exports except `assertions.ts`, which imports `expect`
 * from Vitest and so only loads inside a Vitest run. Headless tools that build fixture worlds from
 * a plain Node process (the sim runner) import this entry; tests can use either. Lint keeps both
 * entries out of app and engine source, so fixtures never ship.
 */

export * from './builders/build-row';
export * from './builders/people';
export * from './builders/promotions';
export * from './builders/creative';
export * from './builders/geography';
export * from './builders/media';
export * from './builders/inbox';
export * from './builders/ledger';
export * from './builders/popularity';
export * from './builders/aftermath';
export * from './catalogs';
export { resetTestIds, testId, TestIds, TestIdSequence } from './ids';
export { setTestWriteValidation, testWriteValidation } from './write-validation';
export * from './world-builder';
export * from './worlds';
export * from './serialise';
export * from './saves';
export * from './systems';
