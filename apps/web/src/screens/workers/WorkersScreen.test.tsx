import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { EngineState, PersonId, QueryName, WorkerListArgs } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { workersListUrlFrom } from '@/app/entityLinks';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { fakeEngineFactory, fakeEngineState, healthFakeState } from '@/test/fakeEngine';
import { setMatchMedia } from '@/test/matchMedia';
import { filtersButtonText, workersCountText } from './WorkersScreen';

/** The engine's first answer and a lazily loaded profile can take a moment under load. */
const LOAD_MS = 10_000;
const TINY_WORLD_PEOPLE = 17;
/** The tiny world's one free agent (ECO5-01): the worker in its countered negotiation. */
const TINY_WORLD_FREE_AGENTS = 1;
const REFUSAL_MESSAGE = 'No world is loaded.';

interface Asked {
  readonly name: QueryName;
  readonly args: unknown;
}

interface RenderOptions {
  /** Refuse every `workers.list`, as an engine with no world would. */
  readonly refuseList?: boolean;
  /** The world to load: the fake engine's tiny world by default. */
  readonly state?: EngineState;
  /** Holds back every `workers.list` answer for the injured list until this settles. */
  readonly holdInjuredList?: Promise<void>;
}

function asksInjured(args: unknown): boolean {
  return JSON.stringify(args).includes('"injured"');
}

function renderWorkers(path: string = routes.game.workers(), options: RenderOptions = {}) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(options.state ?? fakeEngineState());
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });

  const asked: Asked[] = [];
  const { host } = transport;
  const runQuery = host.query.bind(host);
  host.query = async (name, args) => {
    asked.push({ name, args });
    if (options.holdInjuredList !== undefined && name === 'workers.list' && asksInjured(args)) {
      await options.holdInjuredList;
    }
    const answer = await runQuery(name, args);
    if (options.refuseList === true && name === 'workers.list') {
      return {
        revision: answer.revision,
        result: { ok: false, reasons: [{ code: 'noWorld', message: REFUSAL_MESSAGE }] },
      };
    }
    return answer;
  };

  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  const listArgs = (): unknown[] =>
    asked.filter((query) => query.name === 'workers.list').map((query) => query.args);
  /** The person ids of `workers.list` for `args`, in the engine's own order. */
  const engineOrder = async (args: WorkerListArgs): Promise<string[]> => {
    const answer = await runQuery('workers.list', args);
    if (!answer.result.ok) throw new Error('The engine refused the list.');
    return answer.result.data.rows.map((row) => row.personId);
  };
  return { router, user: userEvent.setup(), asked, listArgs, engineOrder };
}

/** The people of the tiny world, in ID order. */
function tinyPeople(): readonly PersonId[] {
  return tinyWorld().ids.people;
}

async function findTable(): Promise<HTMLElement> {
  return screen.findByRole('grid', { name: 'Workers' }, { timeout: LOAD_MS });
}

/** The table's body rows, once the list has loaded. */
async function findRows(): Promise<HTMLElement[]> {
  const table = await findTable();
  await waitFor(
    () => {
      expect(table.querySelectorAll('tbody tr[data-row-id]').length).toBeGreaterThan(0);
    },
    { timeout: LOAD_MS },
  );
  return [...table.querySelectorAll<HTMLElement>('tbody tr[data-row-id]')];
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
  useTracePanelStore.setState({ openPanelId: null });
});

describe('the count line and the filter button', () => {
  it('counts people and free agents, one or many', () => {
    expect(workersCountText(286, 44)).toBe('286 people · 44 free agents');
    expect(workersCountText(1, 1)).toBe('1 person · 1 free agent');
    expect(workersCountText(1200, 0)).toBe('1,200 people · 0 free agents');
  });

  it('counts the filters that are set', () => {
    expect(filtersButtonText(0)).toBe('Filters');
    expect(filtersButtonText(3)).toBe('Filters (3)');
  });
});

describe('WorkersScreen', () => {
  it('lists everyone in the world, with Workers live in the sidebar', async () => {
    renderWorkers();

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Workers' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    const rows = await findRows();
    expect(rows).toHaveLength(TINY_WORLD_PEOPLE);
    expect(
      screen.getByText(workersCountText(TINY_WORLD_PEOPLE, TINY_WORLD_FREE_AGENTS)),
    ).toBeInTheDocument();
    expect(screen.queryByText("This screen isn't built yet")).toBeNull();

    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(sidebar).getByRole('link', { name: 'Workers' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await waitFor(() => {
      expect(document.title).toBe('Workers · Ringside Booker');
    });
  });

  it('shows each person with a link to their profile, their employer and their numbers', async () => {
    renderWorkers(`${routes.game.workers()}?sort=ringName:asc`);
    const rows = await findRows();
    const people = tinyPeople();

    const linked = rows.map((row) => within(row).getAllByRole('link')[0]?.getAttribute('href'));
    expect([...linked].sort()).toEqual(people.map((personId) => routes.game.worker(personId)));

    const [first] = rows;
    if (first === undefined) throw new Error('The list has no rows.');
    const cells = within(first);
    expect(cells.getByText(/^Test Promotion [AB]$/)).toBeInTheDocument();
    expect(cells.getByText('Wrestler')).toBeInTheDocument();
    expect(cells.getByRole('button', { name: /Available/ })).toHaveAttribute(
      'data-status',
      'available',
    );
    expect(cells.getByRole('button', { name: /^Why is .+ overall \d+\?$/ })).toBeInTheDocument();
  });

  it('keeps the whole ring name on a name that may be cut short on screen', async () => {
    renderWorkers(`${routes.game.workers()}?sort=ringName:asc`);
    const [first] = await findRows();
    if (first === undefined) throw new Error('The list has no rows.');

    const [nameLink] = within(first).getAllByRole('link');
    expect(nameLink).toHaveAccessibleName(/^Test /);
    expect(nameLink).toHaveAttribute('title', nameLink?.textContent);
  });

  it('sorts by the column the URL names and writes a new sort back', async () => {
    const { router, user, listArgs } = renderWorkers(`${routes.game.workers()}?sort=age:asc`);
    await findRows();
    const table = await findTable();

    expect(within(table).getByRole('columnheader', { name: /Age/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    const askedBefore = listArgs().length;

    await user.click(within(table).getByRole('button', { name: /Name/ }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('?sort=ringName%3Aasc');
    });
    expect(within(table).getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    // Sorting is done on the rows already here: the engine is not asked again.
    expect(listArgs()).toHaveLength(askedBefore);
  });

  it.each([
    { url: 'employer:asc', key: 'employer', direction: 'asc' },
    { url: 'employer:desc', key: 'employer', direction: 'desc' },
    { url: 'age:asc', key: 'age', direction: 'asc' },
    { url: 'age:desc', key: 'age', direction: 'desc' },
  ] as const)(
    'orders people the sort leaves equal as the engine does ($url)',
    async ({ url, key, direction }) => {
      const { engineOrder } = renderWorkers(`${routes.game.workers()}?sort=${url}`);
      const rows = await findRows();

      // Eight people share each employer, so most of this order is decided inside ties.
      const expected = await engineOrder({ sort: { key, direction } });
      expect(expected).toHaveLength(TINY_WORLD_PEOPLE);
      expect(rows.map((row) => row.getAttribute('data-row-id'))).toEqual(expected);
    },
  );

  it('sends Employer = Free agent to the engine and keeps it in the URL', async () => {
    const { router, user, listArgs } = renderWorkers();
    await findRows();
    expect(listArgs().at(-1)).toEqual({});

    await choose(user, 'Employer', 'Free agent');

    await waitFor(() => {
      expect(router.state.location.search).toBe('?employer=free');
    });
    await waitFor(() => {
      expect(listArgs().at(-1)).toEqual({ filters: { employer: { kind: 'freeAgent' } } });
    });
    // The tiny world has one free agent.
    await waitFor(async () => {
      expect(await findRows()).toHaveLength(TINY_WORLD_FREE_AGENTS);
    });
    expect(screen.getByText('1 shown')).toHaveAttribute('role', 'status');
    expect(
      screen.getByText(workersCountText(TINY_WORLD_PEOPLE, TINY_WORLD_FREE_AGENTS)),
    ).toBeInTheDocument();
  });

  it('offers each promotion as an employer and narrows the list to it', async () => {
    const { user } = renderWorkers();
    await findRows();

    await choose(user, 'Employer', 'Test Promotion A');

    await waitFor(async () => {
      expect(await findRows()).toHaveLength(8);
    });
    expect(screen.getByText('8 shown')).toBeInTheDocument();
  });

  it('clears every filter with Clear filters', async () => {
    const { router, user, listArgs } = renderWorkers(
      `${routes.game.workers()}?employer=free&gender=female&ageMin=30&sort=age:desc`,
    );
    expect(await screen.findByText('Nobody matches these filters')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Employer' })).toHaveTextContent('Free agent');
    expect(screen.getByRole('spinbutton', { name: 'Age from' })).toHaveValue(30);

    const filterPanel = screen.getByRole('region', { name: 'Filters' });
    await user.click(within(filterPanel).getByRole('button', { name: 'Clear filters' }));

    await waitFor(() => {
      expect(router.state.location.search).toBe('?sort=age%3Adesc');
    });
    expect(await findRows()).toHaveLength(TINY_WORLD_PEOPLE);
    expect(listArgs().at(-1)).toEqual({});
    expect(screen.getByRole('combobox', { name: 'Employer' })).toHaveTextContent('Any employer');
    expect(screen.getByRole('spinbutton', { name: 'Age from' })).toHaveValue(null);
    expect(screen.queryByText(/ shown$/)).toBeNull();
  });

  it('filters by an age typed into the range', async () => {
    const { router, user, listArgs } = renderWorkers();
    await findRows();

    await user.type(screen.getByRole('spinbutton', { name: 'Age to' }), '99');
    await waitFor(() => {
      expect(router.state.location.search).toBe('?ageMax=99');
    });
    await waitFor(() => {
      expect(listArgs().at(-1)).toEqual({ filters: { ageMax: 99 } });
    });
    expect(screen.getByRole('spinbutton', { name: 'At least' })).toBeDisabled();
  });

  it('opens a profile from a row and comes back to the same filters', async () => {
    const listUrl = `${routes.game.workers()}?gender=male&sort=ringName:asc`;
    const { router, user } = renderWorkers(listUrl);
    const [first] = await findRows();
    if (first === undefined) throw new Error('The list has no rows.');
    const link = within(first).getAllByRole('link')[0];
    if (link === undefined) throw new Error('The row has no link.');
    const profilePath = link.getAttribute('href');

    await user.click(link);
    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe(profilePath);
      },
      { timeout: LOAD_MS },
    );
    expect(workersListUrlFrom(router.state.location.state)).toBe(listUrl);

    // The profile swaps its tree while it loads (the skeleton has its own Back link), so a click can
    // land on a link that has just left the page. Click the Back link on the page now until the
    // list is back, which is what a person does.
    const listLocation = (): string =>
      `${router.state.location.pathname}${router.state.location.search}`;
    await waitFor(
      async () => {
        if (listLocation() !== listUrl) {
          await user.click(screen.getByRole('link', { name: 'Back to Workers' }));
        }
        expect(listLocation()).toBe(listUrl);
      },
      { timeout: LOAD_MS, interval: 200 },
    );
    // Two lazy screen loads in one test: give it room when the whole suite runs at once.
  }, 15_000);

  it('opens the profile when a row is clicked away from its controls', async () => {
    const { router, user } = renderWorkers();
    const [first] = await findRows();
    if (first === undefined) throw new Error('The list has no rows.');
    const rowPersonId = first.getAttribute('data-row-id');

    const ageCell = first.querySelector('[data-column-id="age"]');
    if (ageCell === null) throw new Error('The row has no age cell.');
    await user.click(ageCell);

    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe(
          `${routes.game.workers()}/${rowPersonId ?? ''}`,
        );
      },
      { timeout: LOAD_MS },
    );
    expect(workersListUrlFrom(router.state.location.state)).toBe(routes.game.workers());
  });

  it('builds the Why? for an overall only when it is opened', async () => {
    const { user, asked } = renderWorkers();
    const [first] = await findRows();
    if (first === undefined) throw new Error('The list has no rows.');
    expect(asked.some((query) => query.name === 'workers.explain')).toBe(false);

    await user.click(within(first).getByRole('button', { name: /^Why is .+ overall \d+\?$/ }));
    const panel = await screen.findByRole('dialog', { name: /overall$/ });
    expect(await within(panel).findByRole('tree')).toBeInTheDocument();
    expect(within(panel).getByText('Wrestler rating')).toBeInTheDocument();
    expect(asked.filter((query) => query.name === 'workers.explain')).toHaveLength(1);
  });

  it('says why when the engine refuses the list', async () => {
    renderWorkers(routes.game.workers(), { refuseList: true });

    expect(
      await screen.findByText('The workers list could not be loaded', {}, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getByText(REFUSAL_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Workers' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('keeps the focused heading when the list fails to load', async () => {
    renderWorkers(routes.game.workers(), { refuseList: true });
    const heading = screen.getByRole('heading', { level: 1, name: 'Workers' });
    heading.focus();

    await screen.findByText('The workers list could not be loaded', {}, { timeout: LOAD_MS });
    expect(screen.getByRole('heading', { level: 1, name: 'Workers' })).toBe(heading);
    expect(heading).toHaveFocus();
  });
});

describe('WorkersScreen on a phone', () => {
  beforeEach(() => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
  });

  it('shows cards, with the filters in a bottom sheet behind a counted button', async () => {
    const { router, user } = renderWorkers(`${routes.game.workers()}?gender=male`);

    const list = await screen.findByRole('list', { name: 'Workers' }, { timeout: LOAD_MS });
    await waitFor(
      () => {
        expect(list.querySelectorAll('li[data-row-id]').length).toBeGreaterThan(0);
      },
      { timeout: LOAD_MS },
    );
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Filters' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Filters (1)' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filters' });
    expect(sheet).toHaveAttribute('data-side', 'bottom');
    expect(within(sheet).getByRole('combobox', { name: 'Gender' })).toHaveTextContent('Man');

    await user.click(within(sheet).getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    await user.click(within(sheet).getByRole('button', { name: /^Show \d+ workers$/ }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  it('keeps the cards plain, so the name link and the buttons are not nested in a button', async () => {
    renderWorkers();
    const list = await screen.findByRole('list', { name: 'Workers' }, { timeout: LOAD_MS });
    await waitFor(
      () => {
        expect(list.querySelectorAll('li[data-row-id]')).toHaveLength(TINY_WORLD_PEOPLE);
      },
      { timeout: LOAD_MS },
    );

    expect(list.querySelector('[role="button"]')).toBeNull();
    const [card] = list.querySelectorAll<HTMLElement>('li[data-row-id]');
    if (card === undefined) throw new Error('The list has no cards.');
    const personId = card.getAttribute('data-row-id') ?? '';
    expect(within(card).getAllByRole('link')[0]).toHaveAttribute(
      'href',
      `${routes.game.workers()}/${personId}`,
    );
  });
});

describe('the Injured quick filter (WRK6-06)', () => {
  it('shows nobody injured as an empty state, not an error', async () => {
    const { router, user, listArgs } = renderWorkers();
    await findRows();

    const toggle = screen.getByRole('button', { name: 'Injured' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);

    await waitFor(() => {
      expect(router.state.location.search).toBe('?availability=injured');
    });
    await waitFor(() => {
      expect(listArgs().at(-1)).toEqual({ filters: { availability: ['injured'] } });
    });
    expect(await screen.findByText('Nobody is injured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Injured' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('lists everyone hurt with the injury and the return date, and turns off again', async () => {
    const { people, state } = healthFakeState();
    const { router, user } = renderWorkers(`${routes.game.workers()}?availability=injured`, {
      state,
    });

    const rows = await findRows();
    expect(rows.map((row) => row.dataset['rowId']).sort()).toEqual(
      [people.injured, people.rivalInjured].sort(),
    );
    const table = await findTable();
    expect(within(table).getByRole('columnheader', { name: /Injury/ })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: /Back on/ })).toBeInTheDocument();
    expect(within(table).getAllByText(/^Test .* injury · /).length).toBe(2);
    expect(within(table).getAllByText(/days? left$/).length).toBe(2);

    await user.click(screen.getByRole('button', { name: 'Injured' }));
    await waitFor(() => {
      expect(router.state.location.search).toBe('');
    });
    await waitFor(() => {
      expect(within(table).queryByRole('columnheader', { name: /Back on/ })).toBeNull();
    });
  });

  it('shows the toggle pressed at once and adds the injury columns with the injured list (WRK6-09)', async () => {
    const { people, state } = healthFakeState();
    let release = (): void => undefined;
    const holdInjuredList = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { user } = renderWorkers(routes.game.workers(), { state, holdInjuredList });
    const everyone = (await findRows()).length;
    const table = await findTable();

    await user.click(screen.getByRole('button', { name: 'Injured' }));
    // Pressed while the engine is still working on the injured list; the full list stays up with
    // its own columns rather than being laid out again with the injury ones.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Injured' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
    expect(within(table).queryByRole('columnheader', { name: /Back on/ })).toBeNull();
    expect(table.querySelectorAll('tbody tr[data-row-id]').length).toBe(everyone);

    release();
    await waitFor(() => {
      expect(within(table).getByRole('columnheader', { name: /Back on/ })).toBeInTheDocument();
    });
    const rows = await findRows();
    expect(rows.map((row) => row.dataset['rowId']).sort()).toEqual(
      [people.injured, people.rivalInjured].sort(),
    );
  });
});
