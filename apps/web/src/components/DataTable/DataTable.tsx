import { useCallback, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../Button';
import { classNames } from '../classNames';
import { EmptyState } from '../EmptyState';
import { useIsMobile } from '@/styles/useMediaQuery';
import { assertValidColumns } from './cardColumns';
import styles from './DataTable.module.css';
import { DataTableCards } from './DataTableCards';
import { DataTableTable } from './DataTableTable';
import { DataTableToolbar } from './DataTableToolbar';
import { UnsortableColumnError, findSortableColumn } from './sortRows';
import { filterTextFor } from './tableModel';
import type { DataTableRowData } from './tableModel';
import type { ColumnDef, DataTableDensity, DataTableLayout, SortState } from './types';
import { useControllableState } from './useControllableState';
import { useDataTableModel } from './useDataTableModel';
import type { RowChecking } from './viewProps';

const NO_IDS: readonly string[] = [];

export interface DataTableProps<Row extends DataTableRowData> {
  /** The rows to show. The table filters (when `filterable`) and sorts them for display. */
  readonly rows: readonly Row[];
  /**
   * Column definitions. Keep the array stable (module level or `useMemo`): rows only re-render
   * when their row, the columns or their selection change.
   */
  readonly columns: readonly ColumnDef<Row>[];
  /** A unique, stable id per row. Used for keys, selection and to break sort ties. */
  readonly getRowId: (row: Row) => string;
  /**
   * A row's name in words, for its checkbox ("Select Worker 3"). Defaults to the `title`
   * column's text, then the row id.
   */
  readonly getRowLabel?: (row: Row) => string;
  /** What the list is, for screen readers: the table caption, or the card list's label. */
  readonly caption: string;

  /** Header clicks and the phone "Sort by" sort the rows. `true` by default. */
  readonly sortable?: boolean;
  /** Controlled sort. Pass with `onSortChange`; `null` means the order the rows came in. */
  readonly sort?: SortState;
  /** Starting sort when `sort` is not controlled. */
  readonly initialSort?: SortState;
  /** The older name for `initialSort`, still accepted. `initialSort` wins when both are set. */
  readonly defaultSort?: SortState;
  /** Called with the new sort when a header, the "Sort by" select or the direction changes. */
  readonly onSortChange?: (sort: SortState) => void;

  /** Shows a filter box that searches the columns' text (see `ColumnDef.filterValue`). */
  readonly filterable?: boolean;
  /** The filter box's label. "Filter" by default. */
  readonly filterLabel?: string;
  /** Controlled filter text. Pass with `onFilterChange`. */
  readonly filter?: string;
  /** Called with the filter box's new text. */
  readonly onFilterChange?: (filter: string) => void;

  /**
   * Adds a checkbox to every row (and "select all" to the header) for picking several rows, for
   * bulk actions. This is separate from the current row (`selectedRowId`), which the arrow keys
   * move and Enter opens.
   */
  readonly selectable?: boolean;
  /** Controlled checked rows. Pass with `onCheckedRowIdsChange`. */
  readonly checkedRowIds?: readonly string[];
  /** Rows checked at first when `checkedRowIds` is not controlled. */
  readonly defaultCheckedRowIds?: readonly string[];
  /** Called with the checked row ids, in the order of `rows`. */
  readonly onCheckedRowIdsChange?: (rowIds: readonly string[]) => void;

  /** Shows a "Columns" button for hiding and showing columns (see `ColumnDef.hideable`). */
  readonly columnPicker?: boolean;
  /** Controlled hidden columns. Pass with `onHiddenColumnIdsChange`. */
  readonly hiddenColumnIds?: readonly string[];
  /** Columns hidden at first when `hiddenColumnIds` is not controlled. */
  readonly defaultHiddenColumnIds?: readonly string[];
  /** Called with the hidden column ids, in column order. */
  readonly onHiddenColumnIdsChange?: (columnIds: readonly string[]) => void;

  /** Controlled current row: the selected row's id, or `null` for none. */
  readonly selectedRowId?: string | null;
  /** Called when a row is selected by click, tap or the arrow keys. */
  readonly onSelect?: (row: Row) => void;
  /** Called when a row is opened: a click or tap, or Enter on the selected row. */
  readonly onActivate?: (row: Row) => void;
  /** Shown when there are no rows. A plain "Nothing to show" by default. */
  readonly emptyState?: ReactNode;
  /** Shows placeholder rows while the data loads. */
  readonly loading?: boolean;
  /** `comfortable` by default. */
  readonly density?: DataTableDensity;
  /**
   * Zebra rows on the desktop table: every other row one surface step up, for wide stat tables
   * that are read across. Off by default; phone cards are separate already.
   */
  readonly striped?: boolean;
  /** `auto` (the default) shows cards below `--bp-mobile` and the table above it. */
  readonly layout?: DataTableLayout;
  readonly className?: string | undefined;
}

/** The default row label: the title column's text, or the row id. */
function defaultRowLabel<Row>(
  columns: readonly ColumnDef<Row>[],
  getRowId: (row: Row) => string,
): (row: Row) => string {
  const titleColumn = columns.find((column) => column.card === 'title');
  return (row) => {
    const titleText = titleColumn === undefined ? null : filterTextFor(titleColumn, row);
    return titleText ?? getRowId(row);
  };
}

/**
 * Every dense list in the game: a sortable, filterable, keyboard-navigable table on desktop and a
 * list of stacked cards on phones, both built from the same column definitions. TanStack Table
 * does the row work (sort, filter, checked rows, hidden columns); the markup and look are ours.
 *
 * Tested ceiling: 500 rows by 10 columns, with the React work for a sorted render inside 50 ms
 * (DataTable.bench.ts). Rosters past 300 rows should switch on windowing in rowWindow.ts.
 */
export function DataTable<Row extends DataTableRowData>({
  rows,
  columns,
  getRowId,
  getRowLabel,
  caption,
  sortable = true,
  sort,
  initialSort,
  defaultSort,
  onSortChange,
  filterable = false,
  filterLabel = 'Filter',
  filter,
  onFilterChange,
  selectable = false,
  checkedRowIds,
  defaultCheckedRowIds,
  onCheckedRowIdsChange,
  columnPicker = false,
  hiddenColumnIds,
  defaultHiddenColumnIds,
  onHiddenColumnIdsChange,
  selectedRowId,
  onSelect,
  onActivate,
  emptyState,
  loading = false,
  density = 'comfortable',
  striped = false,
  layout = 'auto',
  className,
}: DataTableProps<Row>) {
  const isMobile = useIsMobile();
  const showCards = layout === 'cards' || (layout === 'auto' && isMobile);
  const idPrefix = useId();

  // Development only, and cheap: a handful of columns.
  assertValidColumns(columns);

  const [activeSort, changeSort] = useControllableState<SortState>(
    sort,
    initialSort ?? defaultSort ?? null,
    onSortChange,
  );
  if (
    activeSort !== null &&
    sortable &&
    findSortableColumn(columns, activeSort.columnId) === undefined
  ) {
    // A production build ignores the bad sort (TanStack skips unknown columns) and keeps the order.
    if (import.meta.env.DEV) throw new UnsortableColumnError(activeSort.columnId);
  }

  const [filterText, changeFilterText] = useControllableState(filter, '', onFilterChange);
  const activeFilter = filterable ? filterText : '';

  const [activeCheckedIds, changeCheckedIds] = useControllableState(
    checkedRowIds,
    defaultCheckedRowIds ?? NO_IDS,
    onCheckedRowIdsChange,
  );
  const [activeHiddenIds, changeHiddenIds] = useControllableState(
    hiddenColumnIds,
    defaultHiddenColumnIds ?? NO_IDS,
    onHiddenColumnIdsChange,
  );

  const model = useDataTableModel({
    rows,
    columns,
    getRowId,
    sortable,
    sort: activeSort,
    onSortChange: changeSort,
    filterText: activeFilter,
    selectable,
    checkedRowIds: selectable ? activeCheckedIds : NO_IDS,
    onCheckedRowIdsChange: changeCheckedIds,
    hiddenColumnIds: activeHiddenIds,
    onHiddenColumnIdsChange: changeHiddenIds,
  });
  const { displayRows } = model;

  const [uncontrolledSelectedId, setUncontrolledSelectedId] = useState<string | null>(null);
  const activeSelectedId = selectedRowId === undefined ? uncontrolledSelectedId : selectedRowId;
  const isSelectionControlled = selectedRowId !== undefined;

  const rowsById = useMemo(() => {
    const byId = new Map<string, Row>();
    for (const row of rows) byId.set(getRowId(row), row);
    return byId;
  }, [rows, getRowId]);

  const selectRow = useCallback(
    (rowId: string) => {
      const row = rowsById.get(rowId);
      if (row === undefined) return;
      if (!isSelectionControlled) setUncontrolledSelectedId(rowId);
      onSelect?.(row);
    },
    [rowsById, isSelectionControlled, onSelect],
  );

  const activateRow = useCallback(
    (rowId: string) => {
      const row = rowsById.get(rowId);
      if (row !== undefined) onActivate?.(row);
    },
    [rowsById, onActivate],
  );

  const rowDomId = useCallback(
    (rowId: string) => `${idPrefix}-row-${encodeURIComponent(rowId)}`,
    [idPrefix],
  );

  const rowLabel = useMemo(
    () => getRowLabel ?? defaultRowLabel(columns, getRowId),
    [getRowLabel, columns, getRowId],
  );

  const { checkedRowIdSet, toggleRowChecked, flipRowChecked, checkAllState, toggleAllChecked } =
    model;
  const checking = useMemo<RowChecking<Row> | null>(
    () =>
      selectable
        ? {
            checkedRowIds: checkedRowIdSet,
            toggleRowChecked,
            flipRowChecked,
            checkAllState,
            toggleAllChecked,
            getRowLabel: rowLabel,
          }
        : null,
    [
      selectable,
      checkedRowIdSet,
      toggleRowChecked,
      flipRowChecked,
      checkAllState,
      toggleAllChecked,
      rowLabel,
    ],
  );

  const hasFilter = activeFilter.trim() !== '';
  let emptyContent: ReactNode = null;
  if (!loading && rows.length === 0) {
    emptyContent = emptyState ?? <EmptyState title="Nothing to show" />;
  } else if (!loading && displayRows.length === 0 && hasFilter) {
    emptyContent = (
      <EmptyState
        icon="search"
        title="No matches"
        body={`Nothing here matches “${activeFilter.trim()}”.`}
        action={
          <Button
            size="sm"
            onClick={() => {
              changeFilterText('');
            }}
          >
            Clear filter
          </Button>
        }
      />
    );
  }

  const showToolbar = filterable || columnPicker || selectable;
  // Checked ids can outlive their rows (a worker leaves while ticked); only count rows still here.
  const checkedCount = selectable
    ? activeCheckedIds.filter((rowId) => rowsById.has(rowId)).length
    : null;

  const viewProps = {
    rows: displayRows,
    columns: model.visibleColumns,
    allColumns: columns,
    getRowId,
    caption,
    sortable,
    sort: sortable ? activeSort : null,
    onSortChange: changeSort,
    onToggleSort: model.toggleSort,
    checking,
    selectedRowId: activeSelectedId,
    onSelectRow: selectRow,
    onActivateRow: activateRow,
    rowDomId,
    emptyContent,
    loading,
    striped,
    idPrefix,
  };

  return (
    <div
      className={classNames(styles['dataTable'], styles[`density-${density}`], className)}
      data-layout={showCards ? 'cards' : 'table'}
    >
      {showToolbar && (
        <DataTableToolbar
          filter={filterable ? { label: filterLabel, value: filterText } : null}
          onFilterChange={changeFilterText}
          columnPicker={columnPicker ? { columns, hiddenColumnIds: activeHiddenIds } : null}
          onColumnHiddenChange={model.setColumnHidden}
          checkedCount={checkedCount}
          onClearChecked={() => {
            changeCheckedIds(NO_IDS);
          }}
          matchCount={displayRows.length}
        />
      )}
      {showCards ? (
        <DataTableCards
          {...viewProps}
          isInteractive={onActivate !== undefined || onSelect !== undefined}
        />
      ) : (
        <DataTableTable {...viewProps} />
      )}
    </div>
  );
}
