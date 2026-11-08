import type { ReactNode } from 'react';
import type { ColumnDef, SortState } from './types';

/** What DataTable hands to its table and card views. Not part of the public API. */
export interface DataTableViewProps<Row> {
  /** Rows in display order (already sorted). */
  readonly rows: readonly Row[];
  readonly columns: readonly ColumnDef<Row>[];
  readonly getRowId: (row: Row) => string;
  readonly caption: string;
  readonly sort: SortState;
  readonly onSortChange: (sort: SortState) => void;
  readonly selectedRowId: string | null;
  readonly onSelectRow: (rowId: string) => void;
  readonly onActivateRow: (rowId: string) => void;
  /** The DOM id of a row or card, for `aria-activedescendant` and scrolling. */
  readonly rowDomId: (rowId: string) => string;
  /** What to show instead of rows, or `null` when there are rows (or they are loading). */
  readonly emptyContent: ReactNode;
  readonly loading: boolean;
  /** Unique per table, for element ids. */
  readonly idPrefix: string;
}

/**
 * Elements inside a row or card that handle their own clicks and keys. A click on one of these
 * never selects or opens the row around it.
 */
export const OWN_INTERACTION_SELECTOR = 'a, button, input, select, textarea, label, summary';

/** True when an event started on a control inside the row rather than on the row itself. */
export function startedOnInnerControl(target: EventTarget | null, row: Element): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(OWN_INTERACTION_SELECTOR);
  return control !== null && control !== row && row.contains(control);
}
