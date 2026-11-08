/**
 * The typed name maps of the engine API.
 *
 * Every query and command the engine offers is one entry in {@link QueryMap} or {@link CommandMap},
 * keyed by its name, with the shape `{ args: A; result: R }`. The maps start empty; each system
 * adds its own entries through declaration merging next to the code that defines them, the same
 * way systems add their domain events and RNG stream names. That keeps `engine.query(name, args)`
 * fully typed: an unknown name or a wrong argument shape is a compile error.
 *
 * Names are `area.verb` for commands (`tunables.setOverride`) and `area.noun` for queries
 * (`clock.get` is the one exception that reads best as a verb). See docs/design/engine-api.md.
 *
 * @example
 * ```ts
 * // packages/engine/src/systems/roster/api.ts
 * declare module '../../core/api/maps' {
 *   interface QueryMap {
 *     'roster.rows': { args: { promotionId: PromotionId }; result: RosterRow[] };
 *   }
 *   interface CommandMap {
 *     'roster.release': { args: { employmentId: EmploymentId }; result: { severance: Cents } };
 *   }
 * }
 * ```
 */

/** Every query, by name: `{ args; result }`. Systems merge their entries in. */
// An empty interface is the point: it is the target systems merge their queries into.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface QueryMap {}

/** Every command, by name: `{ args; result }`. Systems merge their entries in. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface CommandMap {}

/** Any declared query name. */
export type QueryName = Extract<keyof QueryMap, string>;

/** Any declared command name. */
export type CommandName = Extract<keyof CommandMap, string>;

/** The arguments a query takes. */
export type QueryArgs<N extends QueryName> = QueryMap[N] extends { args: infer A } ? A : never;

/** What a query returns when it succeeds. */
export type QueryData<N extends QueryName> = QueryMap[N] extends { result: infer R } ? R : never;

/** The arguments a command takes. */
export type CommandArgs<N extends CommandName> = CommandMap[N] extends { args: infer A }
  ? A
  : never;

/** What a command returns when it is applied. */
export type CommandData<N extends CommandName> = CommandMap[N] extends { result: infer R }
  ? R
  : never;
