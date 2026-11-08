import type { ReactNode } from 'react';
import type { CheckAllState } from './useDataTableModel';
import type { ColumnDef, SortState } from './types';

/** Checkbox selection, handed to the views when `selectable` is on. */
export interface RowChecking<Row> {
  readonly checkedRowIds: ReadonlySet<string>;
  /** From a row's checkbox: Shift-click checks the range since the last checked row. */
  readonly toggleRowChecked: (rowId: string, event: unknown) => void;
  /** Space on the table's current row. */
  readonly flipRowChecked: (rowId: string) => void;
  readonly checkAllState: CheckAllState;
  readonly toggleAllChecked: (event: unknown) => void;
  /** Names a row's checkbox: "Select <label>". */
  readonly getRowLabel: (row: Row) => string;
}

/** What DataTable hands to its table and card views. Not part of the public API. */
export interface DataTableViewProps<Row> {
  /** Rows in display order (already filtered and sorted). */
  readonly rows: readonly Row[];
  /** The visible columns, in order. */
  readonly columns: readonly ColumnDef<Row>[];
  /** Every column, hidden ones included: the phone "Sort by" lists all sortable ones. */
  readonly allColumns: readonly ColumnDef<Row>[];
  readonly getRowId: (row: Row) => string;
  readonly caption: string;
  /** False hides every sort control. */
  readonly sortable: boolean;
  readonly sort: SortState;
  readonly onSortChange: (sort: SortState) => void;
  /** A header click: the column's next sort in its cycle. */
  readonly onToggleSort: (columnId: string) => void;
  /** Checkbox selection, or `null` when the table is not `selectable`. */
  readonly checking: RowChecking<Row> | null;
  readonly selectedRowId: string | null;
  readonly onSelectRow: (rowId: string) => void;
  readonly onActivateRow: (rowId: string) => void;
  /** The DOM id of a row or card, for `aria-activedescendant` and scrolling. */
  readonly rowDomId: (rowId: string) => string;
  /** What to show instead of rows, or `null` when there are rows (or they are loading). */
  readonly emptyContent: ReactNode;
  readonly loading: boolean;
  /** Zebra rows on the table view. The cards ignore it. */
  readonly striped: boolean;
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
