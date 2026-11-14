/**
 * The storylines system's random streams. None yet: CRTV3-01 only reads. CRTV3-02 declares the
 * stream that picks starter storylines here, the way `systems/health/streams.ts` declares its own:
 *
 * ```ts
 * declare module '../../core/rng/streams' {
 *   interface StreamNames {
 *     'storylines.starters': true;
 *   }
 * }
 * ```
 */

export {};
