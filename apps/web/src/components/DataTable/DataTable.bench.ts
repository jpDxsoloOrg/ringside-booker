/**
 * Informational benchmark, not part of `npm test`. Run it with:
 *
 *   npx vitest bench --project web --run src/components/DataTable
 *
 * The ceiling DataTable is built for is 500 rows by 10 columns. Measured on a development laptop
 * (2026-11): the React work (sort plus render, no DOM) takes about 23 ms, inside the 50 ms budget.
 * Moving the row work onto TanStack Table left it where it was (about 29 ms on both sides of the
 * change, measured back to back on a busy machine).
 * A full jsdom render takes about 120 ms, nearly all of it jsdom building 5,000 cells, which a
 * real browser does several times faster. Past that size a screen should page or window its rows
 * behind the same props (see rowWindow.ts and the DataTable notes in components/README.md).
 */
import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, bench, describe } from 'vitest';
import { DataTable } from './DataTable';
import type { ColumnDef, SortState } from './types';

const ROW_COUNT = 500;
const COLUMN_COUNT = 10;

interface BenchRow {
  readonly id: string;
  readonly name: string;
  readonly values: readonly number[];
}

const rows: readonly BenchRow[] = Array.from({ length: ROW_COUNT }, (_, rowIndex) => ({
  id: `row-${String(rowIndex)}`,
  name: `Worker ${String(rowIndex + 1)}`,
  // Deterministic spread of values so sorting does real work.
  values: Array.from(
    { length: COLUMN_COUNT - 1 },
    (_, columnIndex) => ((rowIndex + 1) * (columnIndex + 7) * 37) % 101,
  ),
}));

const columns: readonly ColumnDef<BenchRow>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    card: 'title',
  },
  ...Array.from({ length: COLUMN_COUNT - 1 }, (_, columnIndex): ColumnDef<BenchRow> => ({
    id: `value-${String(columnIndex)}`,
    header: `Value ${String(columnIndex + 1)}`,
    cell: (row) => row.values[columnIndex],
    sortValue: (row) => row.values[columnIndex] ?? null,
    numeric: true,
    card: 'stat',
  })),
];

const getRowId = (row: BenchRow): string => row.id;

function renderTable(sort: SortState) {
  return render(
    createElement(DataTable<BenchRow>, {
      rows,
      columns,
      getRowId,
      caption: 'Benchmark',
      layout: 'table',
      sort,
    }),
  );
}

afterEach(() => {
  cleanup();
});

describe(`DataTable, ${String(ROW_COUNT)} rows by ${String(COLUMN_COUNT)} columns`, () => {
  bench('first render, table layout', () => {
    renderTable(null);
    cleanup();
  });

  bench('React work only (render to a string, no DOM)', () => {
    renderToString(
      createElement(DataTable<BenchRow>, {
        rows,
        columns,
        getRowId,
        caption: 'Benchmark',
        layout: 'table',
        sort: { columnId: 'value-3', direction: 'desc' },
      }),
    );
  });

  bench('render sorted, then reverse the sort', () => {
    const { rerender } = renderTable({ columnId: 'value-3', direction: 'desc' });
    rerender(
      createElement(DataTable<BenchRow>, {
        rows,
        columns,
        getRowId,
        caption: 'Benchmark',
        layout: 'table',
        sort: { columnId: 'value-3', direction: 'asc' },
      }),
    );
    cleanup();
  });
});
