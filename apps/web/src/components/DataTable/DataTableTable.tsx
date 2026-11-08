import { memo, useMemo } from 'react';
import type { AriaAttributes, KeyboardEvent, MouseEvent } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import styles from './DataTable.module.css';
import { nextSortState } from './sortRows';
import type { ColumnDef, SortState } from './types';
import { startedOnInnerControl } from './viewProps';
import type { DataTableViewProps } from './viewProps';
import { SKELETON_KEYS } from './skeleton';

/** Class names for a column's width, alignment and number style, shared by header and cells. */
function columnClassName<Row>(column: ColumnDef<Row>): string {
  const align = column.align ?? (column.numeric === true ? 'end' : 'start');
  return classNames(
    styles[`width-${column.width ?? 'auto'}`],
    styles[`align-${align}`],
    column.numeric === true && styles['numeric'],
  );
}

function ariaSortFor(sort: SortState, columnId: string): AriaAttributes['aria-sort'] {
  if (sort?.columnId !== columnId) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

interface HeaderCellProps<Row> {
  readonly column: ColumnDef<Row>;
  readonly sort: SortState;
  readonly onSortChange: (sort: SortState) => void;
}

function HeaderCell<Row>({ column, sort, onSortChange }: HeaderCellProps<Row>) {
  const className = columnClassName(column);
  if (column.sortValue === undefined) {
    return (
      <th scope="col" className={className}>
        {column.header}
      </th>
    );
  }

  const isActive = sort?.columnId === column.id;
  return (
    <th scope="col" className={className} aria-sort={ariaSortFor(sort, column.id)}>
      <button
        type="button"
        className={classNames(styles['sortButton'], isActive && styles['sortButtonActive'])}
        onClick={() => {
          onSortChange(nextSortState(sort, column));
        }}
      >
        <span>{column.header}</span>
        <Icon
          name={isActive && sort.direction === 'asc' ? 'sort-asc' : 'sort-desc'}
          size="sm"
          className={styles['sortIcon']}
          decorative
        />
      </button>
    </th>
  );
}

interface TableRowProps<Row> {
  readonly row: Row;
  readonly rowId: string;
  readonly domId: string;
  readonly columns: readonly ColumnDef<Row>[];
  readonly isSelected: boolean;
}

function TableRowView<Row>({ row, rowId, domId, columns, isSelected }: TableRowProps<Row>) {
  return (
    <tr
      id={domId}
      data-row-id={rowId}
      aria-selected={isSelected}
      className={classNames(styles['row'], isSelected && styles['rowSelected'])}
    >
      {columns.map((column) => (
        <td key={column.id} data-column-id={column.id} className={columnClassName(column)}>
          {column.cell(row)}
        </td>
      ))}
    </tr>
  );
}

/**
 * One row, re-rendered only when its row object, the columns or its selection change. `memo`
 * drops the generic parameter, so the result is given back the original signature.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- memo() keeps the props, only the generic is lost
const TableRow = memo(TableRowView) as typeof TableRowView;

/** The row a key press should select, or undefined when the key is not a navigation key. */
function targetIndexForKey(
  key: string,
  currentIndex: number,
  rowCount: number,
): number | undefined {
  const lastIndex = rowCount - 1;
  switch (key) {
    case 'ArrowDown':
      return currentIndex < 0 ? 0 : Math.min(currentIndex + 1, lastIndex);
    case 'ArrowUp':
      return currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return lastIndex;
    default:
      return undefined;
  }
}

/** Desktop layout: a captioned table with sortable sticky headers and keyboard row selection. */
export function DataTableTable<Row>({
  rows,
  columns,
  getRowId,
  caption,
  sort,
  onSortChange,
  selectedRowId,
  onSelectRow,
  onActivateRow,
  rowDomId,
  emptyContent,
  loading,
}: DataTableViewProps<Row>) {
  const rowIds = useMemo(() => rows.map(getRowId), [rows, getRowId]);
  const selectedIndex = selectedRowId === null ? -1 : rowIds.indexOf(selectedRowId);
  const activeDescendant =
    selectedIndex >= 0 && selectedRowId !== null ? rowDomId(selectedRowId) : undefined;

  const handleKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    // Keys pressed on a header button or a control inside a cell belong to that control.
    if (event.target !== event.currentTarget || loading || rowIds.length === 0) return;

    if (event.key === 'Enter') {
      if (selectedRowId !== null && selectedIndex >= 0) {
        event.preventDefault();
        onActivateRow(selectedRowId);
      }
      return;
    }

    const targetIndex = targetIndexForKey(event.key, selectedIndex, rowIds.length);
    const targetId = targetIndex === undefined ? undefined : rowIds[targetIndex];
    if (targetId === undefined) return;
    event.preventDefault();
    if (targetId !== selectedRowId) onSelectRow(targetId);
    document.getElementById(rowDomId(targetId))?.scrollIntoView({ block: 'nearest' });
  };

  const handleClick = (event: MouseEvent<HTMLTableElement>) => {
    if (!(event.target instanceof Element)) return;
    const rowElement = event.target.closest('tr[data-row-id]');
    if (
      !(rowElement instanceof HTMLTableRowElement) ||
      startedOnInnerControl(event.target, rowElement)
    ) {
      return;
    }
    const rowId = rowElement.dataset['rowId'];
    if (rowId === undefined) return;
    onSelectRow(rowId);
    onActivateRow(rowId);
  };

  let body;
  if (loading) {
    body = SKELETON_KEYS.map((skeletonKey) => (
      <tr key={skeletonKey} className={styles['row']}>
        {columns.map((column) => (
          <td key={column.id} className={columnClassName(column)}>
            <span className={styles['skeleton']} aria-hidden="true" />
          </td>
        ))}
      </tr>
    ));
  } else if (emptyContent !== null) {
    body = (
      <tr>
        <td colSpan={columns.length} className={styles['emptyCell']}>
          {emptyContent}
        </td>
      </tr>
    );
  } else {
    body = rows.map((row, index) => {
      const rowId = rowIds[index] ?? getRowId(row);
      return (
        <TableRow
          key={rowId}
          row={row}
          rowId={rowId}
          domId={rowDomId(rowId)}
          columns={columns}
          isSelected={rowId === selectedRowId}
        />
      );
    });
  }

  return (
    <div className={styles['scroller']}>
      <table
        role="grid"
        tabIndex={0}
        aria-activedescendant={activeDescendant}
        aria-busy={loading || undefined}
        className={styles['table']}
        onKeyDown={handleKeyDown}
        onClick={handleClick}
      >
        <caption className={styles['caption']}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <HeaderCell key={column.id} column={column} sort={sort} onSortChange={onSortChange} />
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
