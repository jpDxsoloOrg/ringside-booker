/**
 * The TanStack-backed features of DataTable: the sort cycle with its tie and null rules, the
 * filter box, checkbox selection and hidden columns, in both layouts.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { setMatchMedia } from '@/test/matchMedia';
import { DataTable } from './DataTable';
import type { DataTableProps } from './DataTable';
import type { ColumnDef } from './types';

interface Worker {
  readonly id: string;
  readonly name: string;
  readonly hometown: string;
  readonly popularity: number;
  /** `null` for workers with no contract. */
  readonly wage: number | null;
}

// Out of id order on purpose, with tied popularity (w3, w1) and missing wages (w4, w2).
const workers: readonly Worker[] = [
  { id: 'w3', name: 'Ana Ríos', hometown: 'Lima', popularity: 70, wage: 900 },
  { id: 'w1', name: 'Bo Kane', hometown: 'Leeds', popularity: 70, wage: 1200 },
  { id: 'w4', name: 'Cy Moss', hometown: 'Perth', popularity: 55, wage: null },
  { id: 'w2', name: 'José Vega', hometown: 'Madrid', popularity: 90, wage: null },
];

const columns: readonly ColumnDef<Worker>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    card: 'title',
  },
  {
    id: 'hometown',
    header: 'Hometown',
    cell: (row) => row.hometown,
    filterValue: (row) => row.hometown,
    card: 'subtitle',
  },
  {
    id: 'popularity',
    header: 'Popularity',
    cell: (row) => row.popularity,
    sortValue: (row) => row.popularity,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'wage',
    header: 'Wage',
    cell: (row) => (row.wage === null ? 'None' : String(row.wage)),
    sortValue: (row) => row.wage,
    numeric: true,
    card: 'stat',
  },
];

const getRowId = (row: Worker): string => row.id;

function renderTable(overrides: Partial<DataTableProps<Worker>> = {}) {
  return render(
    <DataTable
      rows={workers}
      columns={columns}
      getRowId={getRowId}
      caption="Roster"
      {...overrides}
    />,
  );
}

function useMobileLayout(): void {
  setMatchMedia((query) => query === BP_MOBILE_QUERY);
}

/** Row ids in the order the table body shows them. */
function bodyRowIds(): string[] {
  const [, body] = screen.getAllByRole('rowgroup');
  return within(body!)
    .getAllByRole('row')
    .map((row) => row.getAttribute('data-row-id') ?? '');
}

/** Row ids in the order the cards show them. */
function cardRowIds(): string[] {
  return screen.getAllByRole('listitem').map((item) => item.getAttribute('data-row-id') ?? '');
}

function headerButton(name: string): HTMLElement {
  return within(screen.getByRole('columnheader', { name })).getByRole('button');
}

beforeAll(() => {
  // jsdom does not lay anything out, so it has no scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

describe('DataTable sorting through TanStack', () => {
  it('sorts descending, then ascending, then back to the given order', async () => {
    const user = userEvent.setup();
    renderTable();
    expect(bodyRowIds()).toEqual(['w3', 'w1', 'w4', 'w2']);

    await user.click(headerButton('Popularity'));
    // Ties (w1 and w3 on 70) are broken by row id, ascending, in both directions.
    expect(bodyRowIds()).toEqual(['w2', 'w1', 'w3', 'w4']);

    await user.click(headerButton('Popularity'));
    expect(bodyRowIds()).toEqual(['w4', 'w1', 'w3', 'w2']);

    await user.click(headerButton('Popularity'));
    expect(bodyRowIds()).toEqual(['w3', 'w1', 'w4', 'w2']);
    expect(screen.getByRole('columnheader', { name: 'Popularity' })).toHaveAttribute(
      'aria-sort',
      'none',
    );
  });

  it('sorts text A to Z first, with a natural, accent-blind collator', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(headerButton('Name'));
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(bodyRowIds()).toEqual(['w3', 'w1', 'w4', 'w2']);

    await user.click(headerButton('Name'));
    expect(bodyRowIds()).toEqual(['w2', 'w4', 'w1', 'w3']);
  });

  it('keeps rows with no value last in both directions, in id order', async () => {
    const user = userEvent.setup();
    renderTable();

    await user.click(headerButton('Wage'));
    expect(bodyRowIds()).toEqual(['w1', 'w3', 'w2', 'w4']);

    await user.click(headerButton('Wage'));
    expect(bodyRowIds()).toEqual(['w3', 'w1', 'w2', 'w4']);
  });

  it('breaks ties with compareTies before row ids, ascending in both directions', async () => {
    const user = userEvent.setup();
    const byNameBackwards = (left: Worker, right: Worker): number =>
      right.name.localeCompare(left.name);
    renderTable({ compareTies: byNameBackwards });

    // w1 (Bo Kane) and w3 (Ana Ríos) tie on 70: Bo comes first here, whichever way the sort runs.
    await user.click(headerButton('Popularity'));
    expect(bodyRowIds()).toEqual(['w2', 'w1', 'w3', 'w4']);
    await user.click(headerButton('Popularity'));
    expect(bodyRowIds()).toEqual(['w4', 'w1', 'w3', 'w2']);
  });

  it('orders rows with no value by compareTies too, and falls back to row ids', async () => {
    const user = userEvent.setup();
    const byName = (left: Worker, right: Worker): number => left.name.localeCompare(right.name);
    renderTable({ compareTies: byName });

    // No wage: w4 (Cy Moss) before w2 (José Vega) by name, where row ids would say w2 first.
    await user.click(headerButton('Wage'));
    expect(bodyRowIds()).toEqual(['w1', 'w3', 'w4', 'w2']);

    // A comparison that calls everything equal leaves the order to the row ids.
    renderTable({
      compareTies: () => 0,
      initialSort: { columnId: 'popularity', direction: 'desc' },
    });
    const [, second] = screen.getAllByRole('grid');
    const ids = within(within(second!).getAllByRole('rowgroup')[1]!)
      .getAllByRole('row')
      .map((row) => row.getAttribute('data-row-id'));
    expect(ids).toEqual(['w2', 'w1', 'w3', 'w4']);
  });

  it('starts from initialSort', () => {
    renderTable({ initialSort: { columnId: 'popularity', direction: 'asc' } });
    expect(bodyRowIds()).toEqual(['w4', 'w1', 'w3', 'w2']);
    expect(screen.getByRole('columnheader', { name: 'Popularity' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
  });

  it('shows no sort controls when sortable is off', () => {
    const { unmount } = renderTable({
      sortable: false,
      initialSort: { columnId: 'popularity', direction: 'desc' },
    });
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByRole('columnheader', { name: 'Popularity' })).not.toHaveAttribute(
      'aria-sort',
    );
    expect(bodyRowIds()).toEqual(['w3', 'w1', 'w4', 'w2']);
    unmount();

    useMobileLayout();
    renderTable({ sortable: false });
    expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull();
  });
});

describe('DataTable filter', () => {
  it('filters on searchable text, ignoring case and accents', async () => {
    const user = userEvent.setup();
    renderTable({ filterable: true });

    const filter = screen.getByRole('searchbox', { name: 'Filter' });
    await user.type(filter, 'jose');
    expect(bodyRowIds()).toEqual(['w2']);
    expect(screen.getByText('1 match')).toBeInTheDocument();

    // Hometown is searched through its filterValue.
    await user.clear(filter);
    await user.type(filter, 'LE');
    expect(bodyRowIds()).toEqual(['w1']);
  });

  it('does not search number columns that do not ask for it', async () => {
    const user = userEvent.setup();
    renderTable({ filterable: true });

    await user.type(screen.getByRole('searchbox', { name: 'Filter' }), '70');
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('offers a way out when nothing matches, and Escape clears the box', async () => {
    const user = userEvent.setup();
    renderTable({ filterable: true });
    const filter = screen.getByRole('searchbox', { name: 'Filter' });

    await user.type(filter, 'nobody');
    expect(screen.getByText('No matches')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filter' }));
    expect(filter).toHaveValue('');
    expect(bodyRowIds()).toHaveLength(4);

    await user.type(filter, 'Cy');
    expect(bodyRowIds()).toEqual(['w4']);
    await user.keyboard('{Escape}');
    expect(filter).toHaveValue('');
    expect(bodyRowIds()).toHaveLength(4);
  });

  it('filters then sorts', async () => {
    const user = userEvent.setup();
    renderTable({ filterable: true, initialSort: { columnId: 'popularity', direction: 'desc' } });

    await user.type(screen.getByRole('searchbox', { name: 'Filter' }), 'l');
    // Lima and Leeds match "l"; both are on 70, so the row id breaks the tie.
    expect(bodyRowIds()).toEqual(['w1', 'w3']);
  });

  it('can be controlled by the screen', async () => {
    const user = userEvent.setup();
    const onFilterChange = vi.fn();
    renderTable({ filterable: true, filter: 'perth', onFilterChange });

    expect(bodyRowIds()).toEqual(['w4']);
    await user.type(screen.getByRole('searchbox', { name: 'Filter' }), 'x');
    expect(onFilterChange).toHaveBeenLastCalledWith('perthx');
    expect(bodyRowIds()).toEqual(['w4']);
  });

  it('filters the cards on a phone', async () => {
    useMobileLayout();
    const user = userEvent.setup();
    renderTable({ filterable: true });

    await user.type(screen.getByRole('searchbox', { name: 'Filter' }), 'madrid');
    expect(cardRowIds()).toEqual(['w2']);
  });
});

describe('DataTable checkbox selection', () => {
  it('checks rows and reports their ids in row order', async () => {
    const user = userEvent.setup();
    const onCheckedRowIdsChange = vi.fn();
    const onActivate = vi.fn();
    renderTable({ selectable: true, onCheckedRowIdsChange, onActivate });

    await user.click(screen.getByRole('checkbox', { name: 'Select José Vega' }));
    expect(onCheckedRowIdsChange).toHaveBeenLastCalledWith(['w2']);
    await user.click(screen.getByRole('checkbox', { name: 'Select Ana Ríos' }));
    expect(onCheckedRowIdsChange).toHaveBeenLastCalledWith(['w3', 'w2']);

    expect(screen.getByRole('checkbox', { name: 'Select José Vega' })).toBeChecked();
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    // A checkbox click never opens the row.
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('"Select all" checks the shown rows and shows a mixed state in between', async () => {
    const user = userEvent.setup();
    renderTable({ selectable: true, filterable: true });
    const selectAll = screen.getByRole('checkbox', { name: 'Select all rows' });

    await user.click(screen.getByRole('checkbox', { name: 'Select Bo Kane' }));
    expect(selectAll).toBePartiallyChecked();

    await user.type(screen.getByRole('searchbox', { name: 'Filter' }), 'a');
    // "a" matches Ana, Bo Kane and José Vega (through Madrid or the name), not Cy Moss.
    expect(bodyRowIds()).toEqual(['w3', 'w1', 'w2']);
    await user.click(selectAll);
    expect(selectAll).toBeChecked();
    expect(screen.getByText('3 selected')).toBeInTheDocument();

    await user.click(selectAll);
    expect(selectAll).not.toBeChecked();
    expect(screen.queryByText(/selected/)).toBeNull();
  });

  it('Shift-click checks the range since the last checked row', async () => {
    const user = userEvent.setup();
    renderTable({ selectable: true });

    await user.click(screen.getByRole('checkbox', { name: 'Select Ana Ríos' }));
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select Cy Moss' }));
    await user.keyboard('{/Shift}');

    expect(screen.getByRole('checkbox', { name: 'Select Bo Kane' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select José Vega' })).not.toBeChecked();
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('Space checks the current row from the keyboard, and Clear selection empties it', async () => {
    const user = userEvent.setup();
    renderTable({ selectable: true });

    screen.getByRole('grid').focus();
    await user.keyboard('{ArrowDown}{ArrowDown} ');
    expect(screen.getByRole('checkbox', { name: 'Select Bo Kane' })).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('checkbox', { name: 'Select Bo Kane' })).not.toBeChecked();
  });

  it('follows controlled checked ids', () => {
    renderTable({ selectable: true, checkedRowIds: ['w4'] });
    expect(screen.getByRole('checkbox', { name: 'Select Cy Moss' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Ana Ríos' })).not.toBeChecked();
  });

  it('counts only checked rows that are still in the list', () => {
    const { rerender } = renderTable({ selectable: true, defaultCheckedRowIds: ['w1', 'w4'] });
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    rerender(
      <DataTable
        rows={workers.filter((worker) => getRowId(worker) !== 'w4')}
        columns={columns}
        getRowId={getRowId}
        caption="Roster"
        selectable
        defaultCheckedRowIds={['w1', 'w4']}
      />,
    );
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });

  it('puts a checkbox on each card that does not open the card', async () => {
    useMobileLayout();
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderTable({ selectable: true, onActivate });

    const checkbox = screen.getByRole('checkbox', { name: 'Select Cy Moss' });
    await user.click(checkbox);
    expect(checkbox).toBeChecked();
    expect(onActivate).not.toHaveBeenCalled();

    // The card itself is still a button with nothing interactive nested inside it.
    const card = screen.getByRole('button', { name: /^Cy Moss\b/ });
    expect(within(card).queryByRole('checkbox')).toBeNull();
  });
});

describe('DataTable hidden columns', () => {
  it('hides columns from the header, the rows and the cards', () => {
    const { unmount } = renderTable({ defaultHiddenColumnIds: ['wage'] });
    expect(screen.queryByRole('columnheader', { name: 'Wage' })).toBeNull();
    expect(document.querySelector('[data-column-id="wage"]')).toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Popularity' })).toBeInTheDocument();
    unmount();

    useMobileLayout();
    renderTable({ defaultHiddenColumnIds: ['wage'] });
    const [firstCard] = screen.getAllByRole('listitem');
    const labels = within(firstCard!)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(labels).toEqual(['Popularity']);
  });

  it('the column picker hides and shows columns, but never the title column', async () => {
    const user = userEvent.setup();
    const onHiddenColumnIdsChange = vi.fn();
    renderTable({ columnPicker: true, onHiddenColumnIdsChange });

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    const picker = await screen.findByRole('dialog', { name: 'Columns' });
    expect(within(picker).queryByRole('checkbox', { name: 'Name' })).toBeNull();

    await user.click(within(picker).getByRole('checkbox', { name: 'Hometown' }));
    expect(onHiddenColumnIdsChange).toHaveBeenLastCalledWith(['hometown']);
    expect(screen.queryByRole('columnheader', { name: 'Hometown' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Columns (1 hidden)' })).toBeInTheDocument();

    await user.click(within(picker).getByRole('checkbox', { name: 'Hometown' }));
    expect(onHiddenColumnIdsChange).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole('columnheader', { name: 'Hometown' })).toBeInTheDocument();
  });

  it('follows controlled hidden columns', () => {
    function Controlled() {
      const [hidden, setHidden] = useState<readonly string[]>(['popularity', 'wage']);
      return (
        <DataTable
          rows={workers}
          columns={columns}
          getRowId={getRowId}
          caption="Roster"
          hiddenColumnIds={hidden}
          onHiddenColumnIdsChange={setHidden}
        />
      );
    }
    render(<Controlled />);
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Name',
      'Hometown',
    ]);
  });
});

describe('DataTable stat-table styling', () => {
  it('marks numeric cells with the tabular helper class', () => {
    renderTable();
    const wageCell = document.querySelector('td[data-column-id="wage"]');
    expect(wageCell).toHaveClass('tabular');
    const nameCell = document.querySelector('td[data-column-id="name"]');
    expect(nameCell).not.toHaveClass('tabular');
  });

  it('keeps the sort direction button working after a card sort', async () => {
    useMobileLayout();
    const user = userEvent.setup();
    renderTable();

    screen.getByRole('combobox', { name: 'Sort by' }).focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'Wage' }));
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
    expect(cardRowIds()).toEqual(['w1', 'w3', 'w2', 'w4']);

    await user.click(screen.getByRole('button', { name: 'Sort descending' }));
    expect(cardRowIds()).toEqual(['w3', 'w1', 'w2', 'w4']);
  });
});
