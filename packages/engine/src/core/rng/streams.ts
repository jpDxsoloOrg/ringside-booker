/**
 * Typed RNG stream names.
 *
 * Every system that needs randomness declares its own stream names by merging them into
 * {@link StreamNames}. The registry then only accepts declared names (plus the `ids.*` family
 * used for ID minting), so a typo is a compile error instead of a silent new stream.
 */

/**
 * The map of declared stream names. Empty here; systems add keys through declaration merging.
 * The value type is unused, so `true` is the convention.
 *
 * @example
 * ```ts
 * // packages/engine/src/systems/condition/streams.ts
 * declare module '../../core/rng/streams' {
 *   interface StreamNames {
 *     'condition.recovery': true;
 *   }
 * }
 *
 * // Elsewhere in the condition system:
 * const recoveryRng = rng.stream('condition.recovery');
 * ```
 */
// An empty interface is the point: it is the target that systems merge their names into.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface StreamNames {}

/**
 * A stream name the registry accepts: any declared name, or `ids.<prefix>` for ID minting
 * (one stream per entity ID prefix, such as `ids.per` or `ids.pro`).
 */
export type StreamName = keyof StreamNames | `ids.${string}`;

/**
 * The runtime shape of a stream name: a lowercase system segment, then one or more dot-separated
 * lowercase segments (`condition.recovery`, `ids.per`, `match.finish-roll`).
 */
export const STREAM_NAME_PATTERN = /^[a-z][a-z0-9]*(\.[a-z0-9-]+)+$/;

/** Returns true when the string has the shape of a stream name. Does not check declarations. */
export function isStreamName(name: string): boolean {
  return STREAM_NAME_PATTERN.test(name);
}

/**
 * Throws when a name does not have the shape of a stream name. The registry calls this on every
 * new stream, so a bad dynamically built name (such as `ids.${prefix}` with an empty prefix)
 * fails loudly in tests instead of creating a stream nobody meant to have.
 */
export function assertStreamName(name: string): asserts name is StreamName {
  if (!isStreamName(name)) {
    throw new Error(
      `Invalid RNG stream name ${JSON.stringify(name)}: expected lowercase dot-separated ` +
        `segments such as "condition.recovery" (pattern ${STREAM_NAME_PATTERN.source}).`,
    );
  }
}
