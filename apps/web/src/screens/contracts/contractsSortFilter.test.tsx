// ECO5-09: sorting and filtering every Contracts tab, with the state in the URL.
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { LOAD_MS, renderContracts } from '@/test/contractsScreen';
import { resetSettingsForTest } from '@/test/settings';
import { aContractRow, aFreeAgentRow } from './contractFixtures';

const CONTRACTS = routes.game.contracts();

/** Three free agents: a cheap man, a dear woman and a mid-priced woman. */
const FREE_AGENTS = [
  aFreeAgentRow({
    personId: parseId('person', 'per_0000000911'),
    ringName: 'Ace Cheap',
    gender: 'male',
    askMonthly: 1_000_000,
    marketValue: 900_000,
    pushExpectation: 'lowerCard',
    popularityHere: 10,
  }),
  aFreeAgentRow({
    personId: parseId('person', 'per_0000000912'),
    ringName: 'Bea Dear',
    askMonthly: 9_000_000,
    marketValue: 8_000_000,
    pushExpectation: 'mainEvent',
    popularityHere: 80,
  }),
  aFreeAgentRow({
    personId: parseId('person', 'per_0000000913'),
    ringName: 'Cara Middle',
    askMonthly: 5_000_000,
    marketValue: 4_000_000,
    pushExpectation: 'midCard',
    popularityHere: 40,
  }),
];

function renderFreeAgents(search: string) {
  return renderContracts(`${CONTRACTS}?tab=free-agents${search}`, {
    canned: { 'contracts.freeAgents': () => FREE_AGENTS },
  });
}

/** The names on the table's rows, top down, once `count` rows are in. */
async function rowNames(caption: string, count: number): Promise<string[]> {
  const table = await screen.findByRole('grid', { name: caption }, { timeout: LOAD_MS });
  await waitFor(
    () => {
      expect(table.querySelectorAll('tbody tr[data-row-id]')).toHaveLength(count);
    },
    { timeout: LOAD_MS },
  );
  return [...table.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')].map(
    (row) => row.getAttribute('aria-label') ?? row.textContent,
  );
}

function names(rows: readonly string[]): string[] {
  return rows.map(
    (row) => FREE_AGENTS.find((agent) => row.includes(agent.ringName))?.ringName ?? row,
  );
}

/** Opens the select named `label` from the keyboard and picks `option`. */
async function choose(user: UserEvent, label: string, option: string): Promise<void> {
  const field = screen.getByRole('combobox', { name: label });
  field.focus();
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('option', { name: option }));
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).toBeNull();
  });
}

beforeEach(() => {
  useSessionStore.getState().clear();
  resetSettingsForTest();
});

describe('Contracts › Free agents sorting (ECO5-09)', () => {
  it('sorts by Ask from the URL, and a header click writes the new sort back', async () => {
    const { router, user } = renderFreeAgents('&sort=ask:asc');
    expect(names(await rowNames('Free agents', 3))).toEqual([
      'Ace Cheap',
      'Cara Middle',
      'Bea Dear',
    ]);

    const table = screen.getByRole('grid', { name: 'Free agents' });
    await user.click(within(table).getByRole('button', { name: /Market value/u }));
    await waitFor(() => {
      expect(router.state.location.search).toMatch(/sort=marketValue%3A(asc|desc)/u);
    });
    expect(within(table).getByRole('columnheader', { name: /Market value/u })).toHaveAttribute(
      'aria-sort',
    );
  }, 30_000);

  it('sorts by push expectation, highest first when descending', async () => {
    renderFreeAgents('&sort=pushExpectation:desc');
    expect(names(await rowNames('Free agents', 3))).toEqual([
      'Bea Dear',
      'Cara Middle',
      'Ace Cheap',
    ]);
  }, 30_000);
});

describe('Contracts › Free agents filters (ECO5-09)', () => {
  it('filters by the URL, says how many are left, and clears the filters', async () => {
    const { router, user } = renderFreeAgents('&gender=female&popMin=50');
    expect(names(await rowNames('Free agents', 1))).toEqual(['Bea Dear']);
    expect(screen.getByText('1 of 3 free agents')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=free-agents');
    });
    expect(await rowNames('Free agents', 3)).toHaveLength(3);
  }, 30_000);

  it('writes a picked push expectation into the URL and combines it with the search', async () => {
    const { router, user } = renderFreeAgents('');
    await rowNames('Free agents', 3);
    await choose(user, 'Push expectation', 'Mid card');
    await waitFor(() => {
      expect(router.state.location.search).toContain('push=midCard');
    });
    expect(names(await rowNames('Free agents', 1))).toEqual(['Cara Middle']);

    await user.type(screen.getByRole('searchbox', { name: 'Find a worker' }), 'zzz');
    await waitFor(() => {
      expect(router.state.location.search).toContain('q=zzz');
    });
    expect(await screen.findByText('0 of 3 free agents')).toBeInTheDocument();
  }, 30_000);

  it('says nobody matches when the filters leave nobody, with Clear filters', async () => {
    renderFreeAgents('&push=midCard&gender=male');
    expect(
      await screen.findByText('Nobody matches these filters', {}, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Clear filters' }).length).toBeGreaterThan(0);
  }, 30_000);
});

describe('Contracts › Offers and the contract lists (ECO5-09)', () => {
  it('sorts the offers by what is on the table, kept in the URL', async () => {
    const { router, user } = renderContracts(`${CONTRACTS}?tab=offers`);
    const table = await screen.findByRole('grid', { name: 'Open offers' }, { timeout: LOAD_MS });
    await user.click(within(table).getByRole('button', { name: /On the table/u }));
    await waitFor(() => {
      expect(router.state.location.search).toMatch(/sort=terms%3A(asc|desc)/u);
    });
    for (const name of [/Status/u, /Next/u]) {
      expect(within(table).getByRole('button', { name })).toBeInTheDocument();
    }
  }, 30_000);

  it('filters Active by gender and push from the URL, sorts by morale, and drops both on a tab change', async () => {
    const promotionId = (): ReturnType<typeof aContractRow>['promotionId'] | undefined =>
      useSessionStore.getState().seat?.promotionId ?? undefined;
    const rows = (): ReturnType<typeof aContractRow>[] | undefined => {
      const own = promotionId();
      return own === undefined
        ? undefined
        : [
            aContractRow({ promotionId: own, morale: 5 }),
            aContractRow({
              promotionId: own,
              employmentId: parseId('employment', 'emp_0000000902'),
              ringName: 'Tor Grimm',
              gender: 'male',
              push: 'mainEvent',
              morale: 60,
            }),
          ];
    };
    const { router, user } = renderContracts(
      `${CONTRACTS}?tab=active&gender=male&push=mainEvent&sort=morale:desc`,
      { canned: { 'contracts.list': rows } },
    );
    const table = await screen.findByRole(
      'grid',
      { name: 'Active contracts' },
      { timeout: LOAD_MS },
    );
    expect(await within(table).findByRole('row', { name: /Tor Grimm/u })).toBeInTheDocument();
    expect(within(table).queryByRole('row', { name: /Mara Quill/u })).toBeNull();
    expect(within(table).getByRole('columnheader', { name: /Morale/u })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    expect(screen.getByText('1 of 2 contracts')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Expiring' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?tab=expiring');
    });
  }, 30_000);
});
