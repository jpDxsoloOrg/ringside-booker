import type { ColumnDef, SortDirection, SortState, SortValue } from './types';

/**
 * Thrown in development builds when a sort names a column that is missing or has no `sortValue`.
 * A production build ignores such a sort and keeps the given order instead of breaking a screen.
 */
export class UnsortableColumnError extends Error {
  override readonly name = 'UnsortableColumnError';
  readonly columnId: string;

  constructor(columnId: string) {
    super(`DataTable cannot sort by column "${columnId}": it is missing or has no sortValue.`);
    this.columnId = columnId;
  }
}

/**
 * One collator for every table: "Worker 2" sorts before "Worker 10", and case and accents do
 * not split otherwise equal names.
 */
const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Compares two present sort values in ascending order. Numbers compare numerically and strings
 * with the shared collator. A column should return one type, but if it mixes them, numbers come
 * before strings so the order is still total.
 */
export function compareSortValues(left: number | string, right: number | string): number {
  if (typeof left === 'number' && typeof right === 'number') {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return naturalCollator.compare(left, right);
  }
  return typeof left === 'number' ? -1 : 1;
}

/** Row ids break ties: naturally first, then by exact code units so two ids never compare equal. */
export function compareRowIds(left: string, right: string): number {
  const natural = naturalCollator.compare(left, right);
  if (natural !== 0) return natural;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** The column a sort applies to, if it exists and can sort. */
export function findSortableColumn<Row>(
  columns: readonly ColumnDef<Row>[],
  columnId: string,
): (ColumnDef<Row> & { readonly sortValue: (row: Row) => SortValue }) | undefined {
  const column = columns.find((candidate) => candidate.id === columnId);
  if (column?.sortValue === undefined) return undefined;
  const { sortValue } = column;
  return { ...column, sortValue };
}

/** The direction a column sorts in on its first click: high to low for numbers, A to Z otherwise. */
export function firstSortDirection<Row>(column: ColumnDef<Row>): SortDirection {
  return column.numeric === true ? 'desc' : 'asc';
}

/**
 * The sort after a header click: a new column starts in its first direction, then the other
 * direction, then back to no sort.
 */
export function nextSortState<Row>(current: SortState, column: ColumnDef<Row>): SortState {
  const firstDirection = firstSortDirection(column);
  if (current?.columnId !== column.id) {
    return { columnId: column.id, direction: firstDirection };
  }
  if (current.direction === firstDirection) {
    return { columnId: column.id, direction: firstDirection === 'asc' ? 'desc' : 'asc' };
  }
  return null;
}

interface KeyedRow<Row> {
  readonly row: Row;
  readonly key: SortValue;
  readonly id: string;
}

/**
 * Sorts rows by a column without changing the input.
 *
 * - Numbers sort numerically and strings with a natural, case-insensitive collator.
 * - `null` sort values always go last, in both directions.
 * - Equal values are ordered by row id (ascending in both directions), so the order is the same
 *   on every render whatever order the rows arrived in.
 *
 * With no sort the rows come back as given. In development a sort on a missing or unsortable
 * column throws an `UnsortableColumnError`; in production it is ignored.
 */
export function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly ColumnDef<Row>[],
  sort: SortState,
  getRowId: (row: Row) => string,
): readonly Row[] {
  if (sort === null) return rows;

  const column = findSortableColumn(columns, sort.columnId);
  if (column === undefined) {
    if (import.meta.env.DEV) throw new UnsortableColumnError(sort.columnId);
    return rows;
  }

  // Each key is read once, not once per comparison.
  const keyedRows: KeyedRow<Row>[] = rows.map((row) => ({
    row,
    key: column.sortValue(row),
    id: getRowId(row),
  }));
  const directionSign = sort.direction === 'asc' ? 1 : -1;

  keyedRows.sort((left, right) => {
    if (left.key === null || right.key === null) {
      if (left.key === null && right.key !== null) return 1;
      if (left.key !== null && right.key === null) return -1;
    } else {
      const byValue = compareSortValues(left.key, right.key);
      if (byValue !== 0) return byValue * directionSign;
    }
    return compareRowIds(left.id, right.id);
  });

  return keyedRows.map((keyedRow) => keyedRow.row);
}
