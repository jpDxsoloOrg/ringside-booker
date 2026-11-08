/**
 * The bridge between our column definitions and TanStack Table. TanStack does the row work
 * (sorting, the filter, checked rows and hidden columns); the markup and styling stay ours.
 *
 * Nothing in here renders. `useDataTableModel` wires these pieces into `useTable`.
 */
import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createSortedRowModel,
  globalFilteringFeature,
  rowSelectionFeature,
  rowSortingFeature,
  tableFeatures,
} from '@tanstack/react-table';
import type {
  ColumnDef as TanStackColumnDef,
  ColumnVisibilityState,
  FilterFn,
  Row as TanStackRow,
  RowData,
  RowSelectionState,
  SortFn,
  SortingState,
} from '@tanstack/react-table';
import { compareRowIds, compareSortValues } from './sortRows';
import type { ColumnDef, SortState } from './types';

/**
 * The TanStack features DataTable uses. Module level, so the table never rebuilds them. Each row
 * model slot comes after the feature it belongs to, as TanStack requires.
 */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  rowSelectionFeature,
  columnVisibilityFeature,
});

export type DataTableFeatures = typeof dataTableFeatures;

/** What a DataTable row can be: any object (TanStack's own constraint). */
export type DataTableRowData = RowData;

/** One row inside the TanStack model. */
export type ModelRow<Row extends RowData> = TanStackRow<DataTableFeatures, Row>;

/**
 * A hidden column holding each row's id. It is always the last sort key, so rows with equal
 * values (or no value) come out in id order in both directions, whatever order they arrived in.
 * It never renders and the filter never searches it.
 */
export const ROW_ID_COLUMN_ID = '__rowId';

/** What a cell sorts by inside TanStack: `null` becomes `undefined` so it can go last. */
type SortKey = number | string | undefined;

function asSortKey(value: unknown): SortKey {
  return typeof value === 'number' || typeof value === 'string' ? value : undefined;
}

/**
 * Ascending comparison of two present values. TanStack reverses it for descending sorts and
 * puts missing values last itself (`sortUndefined: 'last'`), in both directions.
 */
function cellValueComparator<Row extends RowData>(): SortFn<DataTableFeatures, Row> {
  return (rowA, rowB, columnId) => {
    const left = asSortKey(rowA.getValue(columnId));
    const right = asSortKey(rowB.getValue(columnId));
    if (left === undefined || right === undefined) return 0;
    return compareSortValues(left, right);
  };
}

/** Row ids in ascending order: the tie breaker. */
function rowIdComparator<Row extends RowData>(): SortFn<DataTableFeatures, Row> {
  return (rowA, rowB) => compareRowIds(rowA.id, rowB.id);
}

/** Whether a column can be hidden from the column picker. */
export function isHideable<Row>(column: ColumnDef<Row>): boolean {
  return column.hideable ?? column.card !== 'title';
}

/** The text the filter box matches for a cell, or `null` when the column is not searched. */
export function filterTextFor<Row>(column: ColumnDef<Row>, row: Row): string | null {
  if (column.filterValue !== undefined) {
    const value = column.filterValue(row);
    return value === null ? null : String(value);
  }
  const sortValue = column.sortValue?.(row);
  return typeof sortValue === 'string' ? sortValue : null;
}

/** Whether the filter box searches a column at all. */
export function isFilterable<Row>(column: ColumnDef<Row>): boolean {
  return column.filterValue !== undefined || column.sortValue !== undefined;
}

/** Lower case with accents removed, so "Jose" finds "José" and "WORKER" finds "Worker". */
export function normaliseFilterText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .trim();
}

/**
 * The TanStack column list for our columns: one accessor column each (its value is the sort
 * value) plus the hidden row-id column at the end.
 */
export function buildModelColumns<Row extends RowData>(
  columns: readonly ColumnDef<Row>[],
  getRowId: (row: Row) => string,
  sortable: boolean,
): TanStackColumnDef<DataTableFeatures, Row>[] {
  const compareCellValues = cellValueComparator<Row>();
  const modelColumns: TanStackColumnDef<DataTableFeatures, Row>[] = columns.map((column) => {
    const { sortValue } = column;
    return {
      id: column.id,
      accessorFn: (row: Row): SortKey =>
        sortValue === undefined ? undefined : (sortValue(row) ?? undefined),
      sortFn: compareCellValues,
      sortUndefined: 'last',
      sortDescFirst: column.numeric === true,
      enableSorting: sortable && sortValue !== undefined,
      enableGlobalFilter: isFilterable(column),
      enableHiding: isHideable(column),
    };
  });
  modelColumns.push({
    id: ROW_ID_COLUMN_ID,
    accessorFn: getRowId,
    sortFn: rowIdComparator<Row>(),
    enableGlobalFilter: false,
    enableHiding: false,
  });
  return modelColumns;
}

/** Our one-column sort as TanStack sorting state, with the row-id tie breaker behind it. */
export function toSortingState(sort: SortState): SortingState {
  if (sort === null) return [];
  return [
    { id: sort.columnId, desc: sort.direction === 'desc' },
    { id: ROW_ID_COLUMN_ID, desc: false },
  ];
}

/** TanStack sorting state back to our one-column sort, ignoring the tie breaker. */
export function fromSortingState(sorting: SortingState): SortState {
  const primary = sorting.find((entry) => entry.id !== ROW_ID_COLUMN_ID);
  if (primary === undefined) return null;
  return { columnId: primary.id, direction: primary.desc ? 'desc' : 'asc' };
}

/** Checked row ids as TanStack selection state. */
export function toRowSelectionState(rowIds: readonly string[]): RowSelectionState {
  const selection: RowSelectionState = {};
  for (const rowId of rowIds) selection[rowId] = true;
  return selection;
}

/** TanStack selection state back to checked ids, in the order the rows were given. */
export function fromRowSelectionState<Row>(
  selection: RowSelectionState,
  rows: readonly Row[],
  getRowId: (row: Row) => string,
): readonly string[] {
  return rows.map(getRowId).filter((rowId) => selection[rowId] === true);
}

/** Hidden column ids as TanStack visibility state. The row-id column is always hidden. */
export function toVisibilityState(hiddenColumnIds: readonly string[]): ColumnVisibilityState {
  const visibility: ColumnVisibilityState = { [ROW_ID_COLUMN_ID]: false };
  for (const columnId of hiddenColumnIds) visibility[columnId] = false;
  return visibility;
}

/** TanStack visibility state back to hidden column ids, in column order. */
export function fromVisibilityState<Row>(
  visibility: ColumnVisibilityState,
  columns: readonly ColumnDef<Row>[],
): readonly string[] {
  return columns.filter((column) => visibility[column.id] === false).map((column) => column.id);
}

/**
 * The filter box's match function: a row stays when any searched column contains the query,
 * ignoring case and accents. TanStack calls it once per searchable column and keeps the row on
 * the first match.
 */
export function createFilterMatcher<Row extends RowData>(
  columnsById: ReadonlyMap<string, ColumnDef<Row>>,
): FilterFn<DataTableFeatures, Row> {
  return (row, columnId, filterValue: unknown) => {
    if (typeof filterValue !== 'string') return true;
    const query = normaliseFilterText(filterValue);
    if (query === '') return true;
    const column = columnsById.get(columnId);
    if (column === undefined) return false;
    const text = filterTextFor(column, row.original);
    return text !== null && normaliseFilterText(text).includes(query);
  };
}

/**
 * True when a checkbox click should check a range: Shift held. React passes the change event,
 * whose native event is the click that carries the modifier keys.
 */
export function isRangeSelectionEvent(event: unknown): boolean {
  if (typeof event !== 'object' || event === null || !('nativeEvent' in event)) return false;
  const { nativeEvent } = event;
  return nativeEvent instanceof MouseEvent && nativeEvent.shiftKey;
}
