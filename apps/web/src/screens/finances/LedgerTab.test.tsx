import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { choose, LOAD_MS, renderFinances } from '@/test/financesScreen';
import { LEDGER_PAGE_SIZE } from './LedgerTab';

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

const LEDGER_URL = routes.game.finances({ tab: 'ledger' });

async function findLedger(): Promise<HTMLElement> {
  return screen.findByRole('grid', { name: 'Ledger, newest first' }, { timeout: LOAD_MS });
}

async function findRows(): Promise<HTMLElement[]> {
  const table = await findLedger();
  await waitFor(
    () => {
      expect(table.querySelectorAll('tbody tr[data-row-id]').length).toBeGreaterThan(0);
    },
    { timeout: LOAD_MS },
  );
  return [...table.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')];
}

function lastLedgerArgs(argsOf: (name: 'finance.ledger') => unknown[]): unknown {
  const last = argsOf('finance.ledger').at(-1);
  if (last === undefined) throw new Error('The ledger was never asked for');
  return last;
}

describe('LedgerTab', () => {
  it('lists the rows newest first, each with a Why? that names it', async () => {
    const { user } = await renderFinances(LEDGER_URL, { daysPlayed: 3 });
    const rows = await findRows();
    const firstRow = rows[0];
    if (firstRow === undefined) throw new Error('No rows');
    const why = within(firstRow).getByRole('button', {
      name: /^Why is Wages, \w{3} \d+ \w{3} \d{4} /u,
    });
    expect(within(firstRow).getByText(/^minus \$/u)).toBeInTheDocument();

    await user.click(why);
    expect(await screen.findByRole('dialog', { name: /^Wages, / })).toBeInTheDocument();
  });

  it('sends the month and category filters to the engine and keeps them in the URL', async () => {
    const { user, argsOf, router } = await renderFinances(LEDGER_URL, { daysPlayed: 2 });
    await findRows();
    expect(lastLedgerArgs(argsOf)).not.toHaveProperty('category');

    await choose(user, 'Category', 'Wages');
    await waitFor(() => {
      expect(lastLedgerArgs(argsOf)).toMatchObject({ category: 'wages' });
    });
    expect(router.state.location.search).toContain('category=wages');

    const monthOption = screen.getByRole('combobox', { name: 'Month' });
    expect(monthOption).toHaveTextContent('All months');
  });

  it('opens on the filters a link carries', async () => {
    const { argsOf } = await renderFinances(
      routes.game.finances({ tab: 'ledger', month: '2026-04', category: 'wages' }),
      { daysPlayed: 1 },
    );
    await findLedger();
    await waitFor(() => {
      expect(lastLedgerArgs(argsOf)).toMatchObject({ month: '2026-04', category: 'wages' });
    });
    expect(screen.getByRole('combobox', { name: 'Month' })).toHaveTextContent('April 2026');
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Wages');
  });

  it('says so when the filters match nothing, and clears them', async () => {
    const { user, router } = await renderFinances(
      routes.game.finances({ tab: 'ledger', category: 'buyout' }),
    );
    expect(
      await screen.findByText('No rows match these filters', {}, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(router.state.location.search).toBe('?tab=ledger');
  });

  it('loads older rows a page at a time with the cursor', async () => {
    const { user, argsOf } = await renderFinances(LEDGER_URL, {
      daysPlayed: LEDGER_PAGE_SIZE + 5,
      // Keep every row in detail, so there is more than one page.
      keepDetailDays: 3650,
    });
    const rows = await findRows();
    expect(rows).toHaveLength(LEDGER_PAGE_SIZE);
    expect(lastLedgerArgs(argsOf)).toMatchObject({ limit: LEDGER_PAGE_SIZE });

    await user.click(screen.getByRole('button', { name: 'Load older' }));
    const table = await findLedger();
    await waitFor(
      () => {
        expect(table.querySelectorAll('tbody tr[data-row-id]').length).toBeGreaterThan(
          LEDGER_PAGE_SIZE,
        );
      },
      { timeout: LOAD_MS },
    );
    expect(lastLedgerArgs(argsOf)).toMatchObject({
      before: rows.at(-1)?.getAttribute('data-row-id'),
    });
  });

  it('says older money is kept as monthly totals once rows are rolled up', async () => {
    await renderFinances(LEDGER_URL, { daysPlayed: 70 });
    expect(
      await screen.findByText(
        'Details are kept for the last 4 weeks. Older money is shown as monthly totals.',
        {},
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load older' })).toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|NaN/);
  });
});
