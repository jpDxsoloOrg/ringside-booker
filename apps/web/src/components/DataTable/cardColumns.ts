import type { ColumnDef } from './types';

/** A phone card shows at most this many stats; further `stat` columns are desktop only. */
export const MAX_CARD_STATS = 6;

/** From this many stats the card grid uses three columns where the screen is wide enough. */
export const MANY_CARD_STATS = 4;

/** Thrown in development builds when columns break a DataTable rule, such as two titles. */
export class DataTableColumnError extends Error {
  override readonly name = 'DataTableColumnError';
}

/** The columns sorted into the parts of a phone card. */
export interface CardColumns<Row> {
  readonly media: ColumnDef<Row> | undefined;
  readonly title: ColumnDef<Row> | undefined;
  readonly subtitles: readonly ColumnDef<Row>[];
  readonly stats: readonly ColumnDef<Row>[];
  readonly meta: readonly ColumnDef<Row>[];
}

/**
 * Development checks on a column list: ids are unique, and there is at most one `media` and one
 * `title` column. Production builds skip the checks and use the first of each.
 */
export function assertValidColumns<Row>(columns: readonly ColumnDef<Row>[]): void {
  if (!import.meta.env.DEV) return;

  const seenIds = new Set<string>();
  for (const column of columns) {
    if (seenIds.has(column.id)) {
      throw new DataTableColumnError(`DataTable column id "${column.id}" is used twice.`);
    }
    seenIds.add(column.id);
  }

  for (const role of ['media', 'title'] as const) {
    const matching = columns.filter((column) => column.card === role);
    if (matching.length > 1) {
      const ids = matching.map((column) => column.id).join(', ');
      throw new DataTableColumnError(
        `DataTable allows one "${role}" card column, but ${String(matching.length)} have it: ${ids}.`,
      );
    }
  }
}

/** Splits columns by card role, keeping their order. `hidden` columns are left out. */
export function groupCardColumns<Row>(columns: readonly ColumnDef<Row>[]): CardColumns<Row> {
  return {
    media: columns.find((column) => column.card === 'media'),
    title: columns.find((column) => column.card === 'title'),
    subtitles: columns.filter((column) => column.card === 'subtitle'),
    stats: columns.filter((column) => column.card === 'stat').slice(0, MAX_CARD_STATS),
    meta: columns.filter((column) => column.card === 'meta'),
  };
}

/** The label a column gets on a card. */
export function cardLabelFor<Row>(column: ColumnDef<Row>): string {
  return column.cardLabel ?? column.header;
}
