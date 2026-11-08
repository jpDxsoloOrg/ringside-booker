import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { setMatchMedia } from '@/test/matchMedia';
import { DataTableColumnError } from './cardColumns';
import { DataTable } from './DataTable';
import type { DataTableProps } from './DataTable';
import type { ColumnDef } from './types';

interface Wrestler {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly popularity: number;
  readonly age: number;
}

const wrestlers: readonly Wrestler[] = [
  { id: 'w1', name: 'Worker 1', role: 'Wrestler', popularity: 40, age: 31 },
  { id: 'w2', name: 'Worker 2', role: 'Manager', popularity: 85, age: 44 },
  { id: 'w3', name: 'Worker 3', role: 'Wrestler', popularity: 62, age: 26 },
];

const columns: readonly ColumnDef<Wrestler>[] = [
  {
    id: 'name',
    header: 'Name',
    cell: (row) => row.name,
    sortValue: (row) => row.name,
    card: 'title',
  },
  { id: 'role', header: 'Role', cell: (row) => row.role, card: 'subtitle' },
  {
    id: 'popularity',
    header: 'Popularity',
    cardLabel: 'Pop',
    cell: (row) => row.popularity,
    sortValue: (row) => row.popularity,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'age',
    header: 'Age',
    cell: (row) => row.age,
    sortValue: (row) => row.age,
    numeric: true,
    card: 'stat',
  },
  {
    id: 'actions',
    header: 'Actions',
    cell: (row) => <button type="button">Edit {row.name}</button>,
    card: 'hidden',
  },
];

const getRowId = (row: Wrestler): string => row.id;

function renderTable(overrides: Partial<DataTableProps<Wrestler>> = {}) {
  return render(
    <DataTable
      rows={wrestlers}
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

/** Names in the order the table body shows them. */
function bodyNames(): string[] {
  const [, body] = screen.getAllByRole('rowgroup');
  return within(body!)
    .getAllByRole('row')
    .map((row) => row.querySelector('[data-column-id="name"]')?.textContent ?? '');
}

type User = ReturnType<typeof userEvent.setup>;

/** Picks an option in the phone "Sort by" select (a Radix Select) from the keyboard. */
async function chooseSortBy(user: User, optionLabel: string): Promise<void> {
  screen.getByRole('combobox', { name: 'Sort by' }).focus();
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('option', { name: optionLabel }));
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).toBeNull();
  });
}

// jsdom does not lay anything out, so it has no scrollIntoView.
const scrollIntoView = vi.fn();

beforeAll(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});

describe('DataTable layout', () => {
  it('renders a captioned table when not on a phone', () => {
    renderTable();

    const table = screen.getByRole('grid', { name: 'Roster' });
    expect(table.tagName).toBe('TABLE');
    expect(table.querySelector('caption')).toHaveTextContent('Roster');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders a labelled list of cards on a phone', () => {
    useMobileLayout();
    renderTable();

    const list = screen.getByRole('list', { name: 'Roster' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('switches layout when the window crosses the breakpoint', () => {
    renderTable();
    expect(screen.getByRole('grid')).toBeInTheDocument();

    act(() => {
      useMobileLayout();
    });
    expect(screen.getByRole('list', { name: 'Roster' })).toBeInTheDocument();
  });

  it('can force either layout', () => {
    const { unmount } = renderTable({ layout: 'cards' });
    expect(screen.getByRole('list', { name: 'Roster' })).toBeInTheDocument();
    unmount();

    useMobileLayout();
    renderTable({ layout: 'table' });
    expect(screen.getByRole('grid', { name: 'Roster' })).toBeInTheDocument();
  });
});

describe('DataTable sorting', () => {
  it('marks sortable headers with aria-sort and cycles high to low, low to high, off', async () => {
    const user = userEvent.setup();
    renderTable();

    const popularityHeader = screen.getByRole('columnheader', { name: 'Popularity' });
    expect(popularityHeader).toHaveAttribute('aria-sort', 'none');
    expect(screen.getByRole('columnheader', { name: 'Role' })).not.toHaveAttribute('aria-sort');

    await user.click(within(popularityHeader).getByRole('button', { name: 'Popularity' }));
    expect(popularityHeader).toHaveAttribute('aria-sort', 'descending');
    expect(bodyNames()).toEqual(['Worker 2', 'Worker 3', 'Worker 1']);

    await user.click(within(popularityHeader).getByRole('button'));
    expect(popularityHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(bodyNames()).toEqual(['Worker 1', 'Worker 3', 'Worker 2']);

    await user.click(within(popularityHeader).getByRole('button'));
    expect(popularityHeader).toHaveAttribute('aria-sort', 'none');
    expect(bodyNames()).toEqual(['Worker 1', 'Worker 2', 'Worker 3']);
  });

  it('starts from defaultSort and reports changes', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({ defaultSort: { columnId: 'age', direction: 'asc' }, onSortChange });

    expect(screen.getByRole('columnheader', { name: 'Age' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    expect(bodyNames()).toEqual(['Worker 3', 'Worker 1', 'Worker 2']);

    await user.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'name', direction: 'asc' });
  });

  it('follows a controlled sort and leaves changing it to the parent', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({ sort: { columnId: 'popularity', direction: 'desc' }, onSortChange });

    await user.click(screen.getByRole('button', { name: 'Popularity' }));
    expect(onSortChange).toHaveBeenCalledWith({ columnId: 'popularity', direction: 'asc' });
    expect(screen.getByRole('columnheader', { name: 'Popularity' })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('sorts cards with the "Sort by" select and the direction toggle', async () => {
    useMobileLayout();
    const user = userEvent.setup();
    renderTable();

    const cardNames = () =>
      screen
        .getAllByRole('listitem')
        .map((card) => card.querySelector('[data-column-id="name"]')?.textContent ?? '');

    const direction = screen.getByRole('button', { name: 'Sort descending' });
    expect(direction).toBeDisabled();

    await chooseSortBy(user, 'Popularity');
    expect(cardNames()).toEqual(['Worker 2', 'Worker 3', 'Worker 1']);
    expect(direction).toHaveAttribute('aria-pressed', 'true');

    await user.click(direction);
    expect(cardNames()).toEqual(['Worker 1', 'Worker 3', 'Worker 2']);
    expect(direction).toHaveAttribute('aria-pressed', 'false');

    await chooseSortBy(user, 'Default order');
    expect(cardNames()).toEqual(['Worker 1', 'Worker 2', 'Worker 3']);
  });
});

describe('DataTable selection and keyboard', () => {
  it('is one tab stop; arrow keys move the selection and Enter activates it', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    renderTable({ onSelect, onActivate });

    await user.tab();
    const table = screen.getByRole('grid');
    expect(table).toHaveFocus();
    expect(table).not.toHaveAttribute('aria-activedescendant');

    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenLastCalledWith(wrestlers[0]);
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenLastCalledWith(wrestlers[1]);

    const selectedRow = screen.getByRole('row', { selected: true });
    expect(selectedRow).toHaveTextContent('Worker 2');
    expect(table).toHaveAttribute('aria-activedescendant', selectedRow.id);
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(selectedRow);

    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(wrestlers[1]);

    await user.keyboard('{End}');
    expect(onSelect).toHaveBeenLastCalledWith(wrestlers[2]);
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenCalledTimes(3);
    await user.keyboard('{Home}');
    expect(onSelect).toHaveBeenLastCalledWith(wrestlers[0]);
    await user.keyboard('{ArrowUp}');
    expect(onSelect).toHaveBeenCalledTimes(4);
  });

  it('selects and activates a row on click', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    renderTable({ onSelect, onActivate });

    await user.click(screen.getByText('Worker 3'));
    expect(onSelect).toHaveBeenCalledWith(wrestlers[2]);
    expect(onActivate).toHaveBeenCalledWith(wrestlers[2]);
    expect(screen.getByRole('row', { selected: true })).toHaveTextContent('Worker 3');
  });

  it('does not activate the row when a button inside a cell is clicked', async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderTable({ onActivate });

    await user.click(screen.getByRole('button', { name: 'Edit Worker 2' }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('follows a controlled selection', () => {
    renderTable({ selectedRowId: 'w3' });
    expect(screen.getByRole('row', { selected: true })).toHaveTextContent('Worker 3');
  });

  it('activates a card with a tap, Enter or Space', async () => {
    useMobileLayout();
    const user = userEvent.setup();
    const onActivate = vi.fn();
    renderTable({ onActivate });

    const card = screen.getByRole('button', { name: 'Worker 2' });
    await user.click(card);
    expect(onActivate).toHaveBeenLastCalledWith(wrestlers[1]);
    expect(card).toHaveAttribute('aria-current', 'true');

    const firstCard = screen.getByRole('button', { name: 'Worker 1' });
    firstCard.focus();
    await user.keyboard('{Enter}');
    expect(onActivate).toHaveBeenLastCalledWith(wrestlers[0]);
    screen.getByRole('button', { name: 'Worker 3' }).focus();
    await user.keyboard(' ');
    expect(onActivate).toHaveBeenLastCalledWith(wrestlers[2]);
  });

  it('leaves cards as plain list items when nothing handles a tap', () => {
    useMobileLayout();
    renderTable();
    expect(screen.queryByRole('button', { name: 'Worker 1' })).toBeNull();
  });
});

describe('DataTable cards', () => {
  it('labels stats with cardLabel, falling back to the header', () => {
    useMobileLayout();
    renderTable();

    const [firstCard] = screen.getAllByRole('listitem');
    const terms = within(firstCard!)
      .getAllByRole('term')
      .map((term) => term.textContent);
    expect(terms).toEqual(['Pop', 'Age']);
    expect(within(firstCard!).getByText('Wrestler')).toBeInTheDocument();
  });

  it('does not render hidden columns', () => {
    useMobileLayout();
    renderTable();
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull();
  });

  it('rejects two title columns in development', () => {
    const twoTitles: readonly ColumnDef<Wrestler>[] = [
      ...columns,
      { id: 'nickname', header: 'Nickname', cell: (row) => row.name, card: 'title' },
    ];
    // React logs the error it is about to rethrow; keep the test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderTable({ columns: twoTitles })).toThrow(DataTableColumnError);
    consoleError.mockRestore();
  });
});

describe('DataTable empty and loading states', () => {
  it('shows the default empty state with the caption still present', () => {
    renderTable({ rows: [] });

    expect(screen.getByText('Nothing to show')).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'Roster' })).toBeInTheDocument();
  });

  it('shows a custom empty state on cards', () => {
    useMobileLayout();
    renderTable({ rows: [], emptyState: <p>No workers match</p> });
    expect(screen.getByText('No workers match')).toBeInTheDocument();
  });

  it('shows five placeholder rows while loading', () => {
    renderTable({ rows: [], loading: true });

    const table = screen.getByRole('grid');
    expect(table).toHaveAttribute('aria-busy', 'true');
    expect(table.querySelectorAll('tbody tr')).toHaveLength(5);
    expect(screen.queryByText('Nothing to show')).toBeNull();
  });

  it('shows five placeholder cards while loading', () => {
    useMobileLayout();
    renderTable({ loading: true });

    const list = screen.getByRole('list', { name: 'Roster' });
    expect(list).toHaveAttribute('aria-busy', 'true');
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  });
});

describe('DataTable stat-table look', () => {
  function bodyRows(): HTMLElement[] {
    const [, body] = screen.getAllByRole('rowgroup');
    return within(body!).getAllByRole('row');
  }

  it('has no zebra rows by default', () => {
    renderTable();
    expect(bodyRows().some((row) => row.classList.contains('rowStriped'))).toBe(false);
  });

  it('stripes every other row when striped, by its place in the sorted order', async () => {
    const user = userEvent.setup();
    renderTable({ striped: true });
    expect(bodyRows().map((row) => row.classList.contains('rowStriped'))).toEqual([
      false,
      true,
      false,
    ]);

    // Sorting moves rows, but the stripe stays with the position, not the row.
    await user.click(screen.getByRole('button', { name: 'Popularity' }));
    expect(bodyNames()).toEqual(['Worker 2', 'Worker 3', 'Worker 1']);
    expect(bodyRows().map((row) => row.classList.contains('rowStriped'))).toEqual([
      false,
      true,
      false,
    ]);
  });

  it('leaves the phone cards unstriped', () => {
    useMobileLayout();
    const { container } = renderTable({ striped: true });
    expect(container.querySelector('.rowStriped')).toBeNull();
  });
});
