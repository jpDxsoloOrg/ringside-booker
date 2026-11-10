import { functionalUpdate, useTable } from '@tanstack/react-table';
import type {
  ColumnVisibilityState,
  RowSelectionState,
  SortingState,
  Updater,
} from '@tanstack/react-table';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  buildModelColumns,
  createFilterMatcher,
  dataTableFeatures,
  fromRowSelectionState,
  fromSortingState,
  fromVisibilityState,
  isFilterable,
  isRangeSelectionEvent,
  ROW_ID_COLUMN_ID,
  toRowSelectionState,
  toSortingState,
  toVisibilityState,
} from './tableModel';
import type { DataTableRowData } from './tableModel';
import type { ColumnDef, SortState } from './types';

/** A layout effect in the browser; a plain effect when rendering to a string (the benchmark). */
const useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/** How many of the shown rows are checked, for the "check all" box. */
export type CheckAllState = 'all' | 'some' | 'none';

export interface DataTableModelInput<Row extends DataTableRowData> {
  readonly rows: readonly Row[];
  readonly columns: readonly ColumnDef<Row>[];
  readonly getRowId: (row: Row) => string;
  /** Orders rows whose sort values are equal, before row ids do. */
  readonly compareTies?: ((left: Row, right: Row) => number) | undefined;
  readonly sortable: boolean;
  readonly sort: SortState;
  readonly onSortChange: (sort: SortState) => void;
  /** The filter box's text; empty shows every row. */
  readonly filterText: string;
  readonly selectable: boolean;
  readonly checkedRowIds: readonly string[];
  readonly onCheckedRowIdsChange: (rowIds: readonly string[]) => void;
  readonly hiddenColumnIds: readonly string[];
  readonly onHiddenColumnIdsChange: (columnIds: readonly string[]) => void;
}

export interface DataTableModel<Row> {
  /** The rows to show: filtered, then sorted. */
  readonly displayRows: readonly Row[];
  /** The columns to show, in order. Stable while the columns and hidden ids are unchanged. */
  readonly visibleColumns: readonly ColumnDef<Row>[];
  /** Advances a column's sort: first direction, the other direction, then no sort. */
  readonly toggleSort: (columnId: string) => void;
  /** Ids of the checked rows, for quick lookups. */
  readonly checkedRowIdSet: ReadonlySet<string>;
  /** Checks or unchecks a row from its checkbox. Shift-click checks the range since the last one. */
  readonly toggleRowChecked: (rowId: string, event: unknown) => void;
  /** Flips one row's checkbox, for the keyboard. */
  readonly flipRowChecked: (rowId: string) => void;
  readonly checkAllState: CheckAllState;
  /** Checks every shown row, or unchecks them all when they already are. */
  readonly toggleAllChecked: (event: unknown) => void;
  readonly setColumnHidden: (columnId: string, hidden: boolean) => void;
}

/**
 * Runs the rows through TanStack Table: the filter, the sort (with ties broken by row id), the
 * checked rows and the hidden columns. Every piece of state is owned by DataTable (and through
 * it, optionally, by the screen); TanStack only reads it and reports changes.
 */
export function useDataTableModel<Row extends DataTableRowData>({
  rows,
  columns,
  getRowId,
  compareTies,
  sortable,
  sort,
  onSortChange,
  filterText,
  selectable,
  checkedRowIds,
  onCheckedRowIdsChange,
  hiddenColumnIds,
  onHiddenColumnIdsChange,
}: DataTableModelInput<Row>): DataTableModel<Row> {
  const modelColumns = useMemo(
    () => buildModelColumns(columns, getRowId, sortable, compareTies),
    [columns, getRowId, sortable, compareTies],
  );
  const columnsById = useMemo(
    () => new Map(columns.map((column) => [column.id, column] as const)),
    [columns],
  );
  const filterMatcher = useMemo(() => createFilterMatcher(columnsById), [columnsById]);

  const sorting = useMemo(() => toSortingState(sortable ? sort : null), [sortable, sort]);
  const rowSelection = useMemo(() => toRowSelectionState(checkedRowIds), [checkedRowIds]);
  const columnVisibility = useMemo(() => toVisibilityState(hiddenColumnIds), [hiddenColumnIds]);
  const hasFilter = filterText.trim() !== '';

  const handleSortingChange = useCallback(
    (updater: Updater<SortingState>) => {
      onSortChange(fromSortingState(functionalUpdate(updater, sorting)));
    },
    [onSortChange, sorting],
  );

  const handleRowSelectionChange = useCallback(
    (updater: Updater<RowSelectionState>) => {
      onCheckedRowIdsChange(
        fromRowSelectionState(functionalUpdate(updater, rowSelection), rows, getRowId),
      );
    },
    [onCheckedRowIdsChange, rowSelection, rows, getRowId],
  );

  const handleVisibilityChange = useCallback(
    (updater: Updater<ColumnVisibilityState>) => {
      onHiddenColumnIdsChange(
        fromVisibilityState(functionalUpdate(updater, columnVisibility), columns),
      );
    },
    [onHiddenColumnIdsChange, columnVisibility, columns],
  );

  const table = useTable({
    features: dataTableFeatures,
    columns: modelColumns,
    data: rows,
    getRowId,
    state: {
      sorting,
      globalFilter: hasFilter ? filterText : undefined,
      rowSelection,
      columnVisibility,
    },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: handleRowSelectionChange,
    onColumnVisibilityChange: handleVisibilityChange,
    enableSorting: sortable,
    enableMultiSort: false,
    enableSortingRemoval: true,
    globalFilterFn: filterMatcher,
    getColumnCanGlobalFilter: (column) => {
      const ourColumn = columnsById.get(column.id);
      return ourColumn !== undefined && isFilterable(ourColumn);
    },
    enableRowSelection: selectable,
    enableMultiRowSelection: true,
    isRowRangeSelectionEvent: isRangeSelectionEvent,
  });

  // useTable hands back a fresh wrapper on every render. The callbacks below only run on events,
  // after the render they came from has committed, so they read the latest one through a ref and
  // stay stable themselves, which keeps the memoised rows from re-rendering.
  const tableRef = useRef(table);
  useCommitEffect(() => {
    tableRef.current = table;
  });

  const modelRows = table.getRowModel().rows;
  const displayRows = useMemo(() => modelRows.map((modelRow) => modelRow.original), [modelRows]);

  const visibleColumns = useMemo(
    () => columns.filter((column) => columnVisibility[column.id] !== false),
    [columns, columnVisibility],
  );

  const toggleSort = useCallback((columnId: string) => {
    tableRef.current.getColumn(columnId)?.toggleSorting();
  }, []);

  const checkedRowIdSet = useMemo(() => new Set(checkedRowIds), [checkedRowIds]);

  const toggleRowChecked = useCallback((rowId: string, event: unknown) => {
    tableRef.current.getRow(rowId, true).getToggleSelectedHandler()(event);
  }, []);

  const flipRowChecked = useCallback((rowId: string) => {
    tableRef.current.getRow(rowId, true).toggleSelected();
  }, []);

  let checkAllState: CheckAllState = 'none';
  if (selectable && modelRows.length > 0) {
    if (table.getIsAllPageRowsSelected()) checkAllState = 'all';
    else if (modelRows.some((modelRow) => checkedRowIdSet.has(modelRow.id))) checkAllState = 'some';
  }

  const toggleAllChecked = useCallback((event: unknown) => {
    tableRef.current.getToggleAllPageRowsSelectedHandler()(event);
  }, []);

  const setColumnHidden = useCallback((columnId: string, hidden: boolean) => {
    if (columnId === ROW_ID_COLUMN_ID) return;
    tableRef.current.getColumn(columnId)?.toggleVisibility(!hidden);
  }, []);

  return {
    displayRows,
    visibleColumns,
    toggleSort,
    checkedRowIdSet,
    toggleRowChecked,
    flipRowChecked,
    checkAllState,
    toggleAllChecked,
    setColumnHidden,
  };
}
