/** Small list helpers shared by the entity schemas. */

/** True when `values` holds the same value more than once. */
export function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}
