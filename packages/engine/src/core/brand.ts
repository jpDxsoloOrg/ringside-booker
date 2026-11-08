/**
 * Nominal ("branded") types.
 *
 * `Brand<string, 'GameDate'>` is still a string at runtime, but TypeScript will not accept a plain
 * string or a differently branded string where it is expected. Values only get a brand through the
 * parse and guard functions of the module that owns the type.
 */
export type Brand<T, B extends string> = T & { readonly __brand: B };
