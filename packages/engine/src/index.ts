/**
 * Public API of the Ringside Booker engine.
 *
 * Everything the web app, the tools and the tests are allowed to use is exported from here.
 */

/** Engine version, recorded in every save. Kept equal to `version` in this package's package.json. */
export const ENGINE_VERSION: string = '0.1.0';

export { hashString128, hashString32, type HashWords } from './core/hash';
export * from './core/rng';
