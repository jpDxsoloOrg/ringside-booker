import { describe, expect, it } from 'vitest';
import { UnsortableColumnError, compareSortValues, nextSortState, sortRows } from './sortRows';
import type { ColumnDef, SortState } from './types';

interface SampleRow {
  readonly id: string;
  readonly name: string;
  readonly score: number | null;
}

const columns: readonly ColumnDef<SampleRow>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    card: 'title',
  },
  {
    id: 'score',
    header: 'Score',
    cell: (row) => row.score,
    sortValue: (row) => row.score,
    numeric: true,
    card: 'stat',
  },
  { id: 'notes', header: 'Notes', cell: () => 'none', card: 'meta' },
];

const getRowId = (row: SampleRow): string => row.id;

function idsSortedBy(rows: readonly SampleRow[], sort: SortState): string[] {
  return sortRows(rows, columns, sort, getRowId).map(getRowId);
}

describe('sortRows', () => {
  const rows: readonly SampleRow[] = [
    { id: 'r1', name: 'Worker 10', score: 40 },
    { id: 'r2', name: 'Worker 2', score: null },
    { id: 'r3', name: 'worker 1', score: 75 },
    { id: 'r4', name: 'Worker 3', score: null },
    { id: 'r5', name: 'Worker 20', score: 12 },
  ];

  it('returns the rows unchanged with no sort', () => {
    expect(sortRows(rows, columns, null, getRowId)).toBe(rows);
  });

  it('sorts numbers numerically and puts nulls last', () => {
    expect(idsSortedBy(rows, { columnId: 'score', direction: 'asc' })).toEqual([
      'r5',
      'r1',
      'r3',
      'r2',
      'r4',
    ]);
  });

  it('keeps nulls last when sorting descending', () => {
    expect(idsSortedBy(rows, { columnId: 'score', direction: 'desc' })).toEqual([
      'r3',
      'r1',
      'r5',
      'r2',
      'r4',
    ]);
  });

  it('sorts names naturally: "Worker 2" before "Worker 10", ignoring case', () => {
    expect(idsSortedBy(rows, { columnId: 'name', direction: 'asc' })).toEqual([
      'r3',
      'r2',
      'r4',
      'r1',
      'r5',
    ]);
    expect(compareSortValues('Worker 2', 'Worker 10')).toBeLessThan(0);
  });

  it('orders equal values by row id in both directions, whatever the input order', () => {
    const tied: readonly SampleRow[] = [
      { id: 'b', name: 'Same', score: 50 },
      { id: 'c', name: 'Same', score: 50 },
      { id: 'a', name: 'Same', score: 50 },
    ];
    const reversed = [...tied].reverse();

    expect(idsSortedBy(tied, { columnId: 'score', direction: 'asc' })).toEqual(['a', 'b', 'c']);
    expect(idsSortedBy(tied, { columnId: 'score', direction: 'desc' })).toEqual(['a', 'b', 'c']);
    expect(idsSortedBy(reversed, { columnId: 'name', direction: 'desc' })).toEqual(['a', 'b', 'c']);
  });

  it('does not change the input array', () => {
    const before = rows.map(getRowId);
    sortRows(rows, columns, { columnId: 'score', direction: 'desc' }, getRowId);
    expect(rows.map(getRowId)).toEqual(before);
  });

  it('throws a typed error for a column with no sortValue', () => {
    const sortByNotes = (): unknown =>
      sortRows(rows, columns, { columnId: 'notes', direction: 'asc' }, getRowId);
    expect(sortByNotes).toThrow(UnsortableColumnError);

    try {
      sortRows(rows, columns, { columnId: 'missing', direction: 'asc' }, getRowId);
      expect.unreachable('sorting by a missing column should throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(UnsortableColumnError);
      expect(error instanceof UnsortableColumnError && error.columnId).toBe('missing');
    }
  });
});

describe('compareSortValues', () => {
  it('puts numbers before strings when a column mixes them', () => {
    expect(compareSortValues(5, 'five')).toBeLessThan(0);
    expect(compareSortValues('five', 5)).toBeGreaterThan(0);
  });
});

describe('nextSortState', () => {
  const [nameColumn, scoreColumn] = columns;

  it('cycles a text column ascending, descending, then off', () => {
    const first = nextSortState(null, nameColumn!);
    expect(first).toEqual({ columnId: 'name', direction: 'asc' });
    const second = nextSortState(first, nameColumn!);
    expect(second).toEqual({ columnId: 'name', direction: 'desc' });
    expect(nextSortState(second, nameColumn!)).toBeNull();
  });

  it('cycles a numeric column high to low first, then low to high, then off', () => {
    const first = nextSortState(null, scoreColumn!);
    expect(first).toEqual({ columnId: 'score', direction: 'desc' });
    const second = nextSortState(first, scoreColumn!);
    expect(second).toEqual({ columnId: 'score', direction: 'asc' });
    expect(nextSortState(second, scoreColumn!)).toBeNull();
  });

  it('starts over when a different column is clicked', () => {
    expect(nextSortState({ columnId: 'score', direction: 'asc' }, nameColumn!)).toEqual({
      columnId: 'name',
      direction: 'asc',
    });
  });
});
