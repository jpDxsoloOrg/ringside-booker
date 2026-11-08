/**
 * The one database method the publisher uses. A `pg` Client satisfies it, and tests pass a fake
 * that records statements and returns scripted rows. Rows come back as `unknown` and are checked
 * with zod before use.
 */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ readonly rows: readonly unknown[] }>;
}
