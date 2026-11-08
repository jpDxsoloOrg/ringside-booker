import { memo, useMemo, useRef } from 'react';
import type { AriaAttributes, KeyboardEvent, MouseEvent } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import styles from './DataTable.module.css';
import { RowCheckbox } from './RowCheckbox';
import { useRowWindow } from './rowWindow';
import type { ColumnDef, SortState } from './types';
import { startedOnInnerControl } from './viewProps';
import type { DataTableViewProps, RowChecking } from './viewProps';
import { SKELETON_KEYS } from './skeleton';

/** The global helper class that lines numbers up (see styles/global.css). */
const TABULAR_CLASS = 'tabular';

/**
 * Class names for a column's width, alignment and number style, shared by header and cells.
 * Numeric columns sit on the right with tabular figures, like a stat sheet.
 */
function columnClassName<Row>(column: ColumnDef<Row>): string {
  const align = column.align ?? (column.numeric === true ? 'end' : 'start');
  return classNames(
    styles[`width-${column.width ?? 'auto'}`],
    styles[`align-${align}`],
    column.numeric === true && styles['numeric'],
    column.numeric === true && TABULAR_CLASS,
  );
}

function ariaSortFor(sort: SortState, columnId: string): AriaAttributes['aria-sort'] {
  if (sort?.columnId !== columnId) return 'none';
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}

interface HeaderCellProps<Row> {
  readonly column: ColumnDef<Row>;
  readonly sortable: boolean;
  readonly sort: SortState;
  readonly onToggleSort: (columnId: string) => void;
}

function HeaderCell<Row>({ column, sortable, sort, onToggleSort }: HeaderCellProps<Row>) {
  const className = columnClassName(column);
  if (!sortable || column.sortValue === undefined) {
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
          onToggleSort(column.id);
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
  /** Draws the row as a zebra stripe: every other row when the table is `striped`. */
  readonly isStriped: boolean;
  /** `undefined` when the table has no checkboxes. */
  readonly isChecked: boolean | undefined;
  readonly checking: RowChecking<Row> | null;
}

function TableRowView<Row>({
  row,
  rowId,
  domId,
  columns,
  isSelected,
  isStriped,
  isChecked,
  checking,
}: TableRowProps<Row>) {
  return (
    <tr
      id={domId}
      data-row-id={rowId}
      aria-selected={isSelected}
      className={classNames(
        styles['row'],
        isStriped && styles['rowStriped'],
        isSelected && styles['rowSelected'],
        isChecked === true && styles['rowChecked'],
      )}
    >
      {checking !== null && (
        <td className={styles['checkCell']}>
          <RowCheckbox
            label={`Select ${checking.getRowLabel(row)}`}
            checked={isChecked === true}
            onChange={(event) => {
              checking.toggleRowChecked(rowId, event);
            }}
          />
        </td>
      )}
      {columns.map((column) => (
        <td key={column.id} data-column-id={column.id} className={columnClassName(column)}>
          {column.cell(row)}
        </td>
      ))}
    </tr>
  );
}

/**
 * One row, re-rendered only when its row object, the columns, its selection or its checkbox
 * change. `memo` drops the generic parameter, so the result is given back the original signature.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- memo() keeps the props, only the generic is lost
const TableRow = memo(TableRowView) as typeof TableRowView;

/**
 * Stands in for rows outside the render window (see rowWindow.ts). A one-pixel-wide SVG gives the
 * row its height through plain attributes, so no style is written from script.
 */
interface WindowSpacerProps {
  readonly heightPx: number;
  readonly columnCount: number;
}

function WindowSpacer({ heightPx, columnCount }: WindowSpacerProps) {
  return (
    <tr aria-hidden="true" className={styles['windowSpacer']}>
      <td colSpan={columnCount}>
        <svg className={styles['windowSpacerSize']} width={1} height={heightPx} focusable="false" />
      </td>
    </tr>
  );
}

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

/**
 * Desktop layout: a captioned table with sortable sticky headers, optional row checkboxes, and
 * keyboard row selection.
 */
export function DataTableTable<Row>({
  rows,
  columns,
  getRowId,
  caption,
  sortable,
  sort,
  onToggleSort,
  checking,
  selectedRowId,
  onSelectRow,
  onActivateRow,
  rowDomId,
  emptyContent,
  loading,
  striped,
}: DataTableViewProps<Row>) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const rowIds = useMemo(() => rows.map(getRowId), [rows, getRowId]);
  const selectedIndex = selectedRowId === null ? -1 : rowIds.indexOf(selectedRowId);
  const activeDescendant =
    selectedIndex >= 0 && selectedRowId !== null ? rowDomId(selectedRowId) : undefined;
  const rowWindow = useRowWindow(rows, scrollerRef);
  const columnCount = columns.length + (checking === null ? 0 : 1);

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

    if (event.key === ' ') {
      if (checking !== null && selectedRowId !== null && selectedIndex >= 0) {
        event.preventDefault();
        checking.flipRowChecked(selectedRowId);
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
        {checking !== null && <td className={styles['checkCell']} />}
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
        <td colSpan={columnCount} className={styles['emptyCell']}>
          {emptyContent}
        </td>
      </tr>
    );
  } else {
    body = (
      <>
        {rowWindow.spaceBefore > 0 && (
          <WindowSpacer heightPx={rowWindow.spaceBefore} columnCount={columnCount} />
        )}
        {rowWindow.items.map((row, offset) => {
          const rowIndex = rowWindow.startIndex + offset;
          const rowId = rowIds[rowIndex] ?? getRowId(row);
          return (
            <TableRow
              key={rowId}
              row={row}
              rowId={rowId}
              domId={rowDomId(rowId)}
              columns={columns}
              isSelected={rowId === selectedRowId}
              isStriped={striped && rowIndex % 2 === 1}
              isChecked={checking === null ? undefined : checking.checkedRowIds.has(rowId)}
              checking={checking}
            />
          );
        })}
        {rowWindow.spaceAfter > 0 && (
          <WindowSpacer heightPx={rowWindow.spaceAfter} columnCount={columnCount} />
        )}
      </>
    );
  }

  return (
    <div ref={scrollerRef} className={styles['scroller']}>
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
            {checking !== null && (
              <th scope="col" className={styles['checkCell']}>
                <RowCheckbox
                  label="Select all rows"
                  checked={checking.checkAllState === 'all'}
                  indeterminate={checking.checkAllState === 'some'}
                  onChange={checking.toggleAllChecked}
                />
              </th>
            )}
            {columns.map((column) => (
              <HeaderCell
                key={column.id}
                column={column}
                sortable={sortable}
                sort={sort}
                onToggleSort={onToggleSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>{body}</tbody>
      </table>
    </div>
  );
}
