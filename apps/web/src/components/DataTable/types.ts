import type { ReactNode } from 'react';

/**
 * Where a column's cell goes in the phone card layout.
 *
 * - `media`: the picture on the left (at most one column).
 * - `title`: the bold first line (at most one column).
 * - `subtitle`: muted text under the title.
 * - `stat`: a labelled value in the card's stat grid (the first six are shown).
 * - `meta`: small print on one wrapped line at the bottom.
 * - `hidden`: desktop only; not shown on a card.
 */
export type CardRole = 'media' | 'title' | 'subtitle' | 'stat' | 'meta' | 'hidden';

/** Horizontal alignment of a column's header and cells. */
export type ColumnAlign = 'start' | 'end' | 'center';

/** Column width on the desktop table, from the fixed scale in DataTable.module.css. */
export type ColumnWidth = 'xs' | 'sm' | 'md' | 'lg' | 'auto';

/** What a column sorts by. `null` means "no value" and always sorts last. */
export type SortValue = number | string | null;

export type SortDirection = 'asc' | 'desc';

/** One column, declared once by a screen and used by both the table and the card layout. */
export interface ColumnDef<Row> {
  /** Stable id: the sort key, and `data-column-id` on every cell. */
  readonly id: string;
  /** Header text on the desktop table and the default card label. */
  readonly header: string;
  /** What the cell shows. */
  readonly cell: (row: Row) => ReactNode;
  /** Makes the column sortable. Numbers sort numerically, strings by a natural collator. */
  readonly sortValue?: (row: Row) => SortValue;
  /** `start` by default, or `end` when `numeric` is set. */
  readonly align?: ColumnAlign;
  /** `auto` by default. */
  readonly width?: ColumnWidth;
  /** Right-aligned tabular figures, and the first header click sorts high to low. */
  readonly numeric?: boolean;
  /** Where the cell goes on a phone card. */
  readonly card: CardRole;
  /** Shorter label for the card stat grid, when the header is too long for a phone. */
  readonly cardLabel?: string;
  /**
   * The text the filter box searches for this column. Left out, a column whose `sortValue` gives
   * text is searched by that text; numbers are only searched when a column asks for it here.
   */
  readonly filterValue?: (row: Row) => string | number | null;
  /**
   * Whether the column picker can hide the column. `true` by default, except for the `title`
   * column: the row's name always stays.
   */
  readonly hideable?: boolean;
  /**
   * Keeps the header for screen readers only, for a column whose cells say what they are, such as
   * a row's actions menu. Off by default.
   */
  readonly headerHidden?: boolean;
}

/** The active sort, or `null` for the rows in the order they were given. */
export type SortState = { readonly columnId: string; readonly direction: SortDirection } | null;

/** Row padding: `comfortable` for most screens, `compact` for long ledgers. */
export type DataTableDensity = 'comfortable' | 'compact';

/** `auto` switches to cards below `--bp-mobile`; the others force one layout. */
export type DataTableLayout = 'auto' | 'table' | 'cards';
