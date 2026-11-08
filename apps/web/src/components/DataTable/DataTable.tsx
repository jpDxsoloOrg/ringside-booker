import { useCallback, useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import { EmptyState } from '../EmptyState';
import { useIsMobile } from '@/styles/useMediaQuery';
import { assertValidColumns } from './cardColumns';
import styles from './DataTable.module.css';
import { DataTableCards } from './DataTableCards';
import { DataTableTable } from './DataTableTable';
import { sortRows } from './sortRows';
import type { ColumnDef, DataTableDensity, DataTableLayout, SortState } from './types';

export interface DataTableProps<Row> {
  /** The rows to show, already filtered by the screen. The table sorts them for display. */
  readonly rows: readonly Row[];
  /**
   * Column definitions. Keep the array stable (module level or `useMemo`): rows only re-render
   * when their row, the columns or their selection change.
   */
  readonly columns: readonly ColumnDef<Row>[];
  /** A unique, stable id per row. Used for keys, selection and to break sort ties. */
  readonly getRowId: (row: Row) => string;
  /** What the list is, for screen readers: the table caption, or the card list's label. */
  readonly caption: string;
  /** Controlled sort. Pass with `onSortChange`; `null` means the order the rows came in. */
  readonly sort?: SortState;
  /** Starting sort when `sort` is not controlled. */
  readonly defaultSort?: SortState;
  /** Called with the new sort when a header, the "Sort by" select or the direction changes. */
  readonly onSortChange?: (sort: SortState) => void;
  /** Controlled selection: the selected row's id, or `null` for none. */
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
  /** `auto` (the default) shows cards below `--bp-mobile` and the table above it. */
  readonly layout?: DataTableLayout;
  readonly className?: string | undefined;
}

/**
 * Every dense list in the game: a sortable, keyboard-navigable table on desktop and a list of
 * stacked cards on phones, both built from the same column definitions.
 *
 * Tested ceiling: 500 rows by 10 columns, with the React work for a sorted render inside 50 ms
 * (DataTable.bench.ts). Larger lists should be paged or windowed behind these same props.
 */
export function DataTable<Row>({
  rows,
  columns,
  getRowId,
  caption,
  sort,
  defaultSort,
  onSortChange,
  selectedRowId,
  onSelect,
  onActivate,
  emptyState,
  loading = false,
  density = 'comfortable',
  layout = 'auto',
  className,
}: DataTableProps<Row>) {
  const isMobile = useIsMobile();
  const showCards = layout === 'cards' || (layout === 'auto' && isMobile);
  const idPrefix = useId();

  // Development only, and cheap: a handful of columns.
  assertValidColumns(columns);

  const [uncontrolledSort, setUncontrolledSort] = useState<SortState>(defaultSort ?? null);
  const activeSort = sort === undefined ? uncontrolledSort : sort;
  const isSortControlled = sort !== undefined;

  const changeSort = useCallback(
    (nextSort: SortState) => {
      if (!isSortControlled) setUncontrolledSort(nextSort);
      onSortChange?.(nextSort);
    },
    [isSortControlled, onSortChange],
  );

  const [uncontrolledSelectedId, setUncontrolledSelectedId] = useState<string | null>(null);
  const activeSelectedId = selectedRowId === undefined ? uncontrolledSelectedId : selectedRowId;
  const isSelectionControlled = selectedRowId !== undefined;

  const sortedRows = useMemo(
    () => sortRows(rows, columns, activeSort, getRowId),
    [rows, columns, activeSort, getRowId],
  );

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

  const isEmpty = rows.length === 0 && !loading;
  const emptyContent = isEmpty ? (emptyState ?? <EmptyState title="Nothing to show" />) : null;

  const viewProps = {
    rows: sortedRows,
    columns,
    getRowId,
    caption,
    sort: activeSort,
    onSortChange: changeSort,
    selectedRowId: activeSelectedId,
    onSelectRow: selectRow,
    onActivateRow: activateRow,
    rowDomId,
    emptyContent,
    loading,
    idPrefix,
  };

  return (
    <div
      className={classNames(styles['dataTable'], styles[`density-${density}`], className)}
      data-layout={showCards ? 'cards' : 'table'}
    >
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
