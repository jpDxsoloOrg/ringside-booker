/**
 * The serialisability guard for everything that crosses the engine boundary.
 *
 * Query and command results travel to the UI through a Web Worker (structured clone) and are
 * compared by the UI's query cache, so they must be plain JSON: no `Map`, `Set`, `Date`, class
 * instance, function, `undefined` value or non-finite number. With `debugChecks` on (the default in
 * tests and dev builds), the engine runs this on every result. It is a thin wrapper over
 * `assertJsonValue` in `core/json.ts`, so there is one definition of "plain JSON" in the engine.
 */

import { assertJsonValue, type JsonValue } from '../json';

/**
 * Throws `NotSerialisableError` naming the first bad path (for example
 * `queries.roster.rows[3].contract`) unless `value` is plain JSON.
 */
export function assertSerialisable(value: unknown, path: string): asserts value is JsonValue {
  assertJsonValue(value, path);
}
