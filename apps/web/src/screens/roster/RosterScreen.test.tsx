import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initialEngineState, ROSTER_NOT_YOURS } from '@ringside/engine';
import type { BrandId, EngineState, PromotionId, RosterRow } from '@ringside/engine';
import {
  aPerson,
  anEmployment,
  TEST_PLAYER_ID,
  TEST_START_DATE,
  testId,
  worldBuilder,
} from '@ringside/engine/testing';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routePatterns, routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { NO_MOMENTUM } from './rosterColumns';
import { NO_GAME_TEXT, RosterScreen } from './RosterScreen';
import { registerRosterTab } from './rosterTabRegistry';

/** The engine's first answer can take a moment when several test files load the machine. */
const LOAD_MS = 10_000;

interface RosterTestWorld {
  readonly state: EngineState;
  readonly own: PromotionId;
  readonly rival: PromotionId;
  readonly secondBrand: BrandId;
}

/**
 * Promotion A (the player's) with two brands: six wrestlers on the flagship, the first of them a
 * star stuck at the bottom of the card (so they expect more); one wrestler on the second brand;
 * one wrestler and one referee on no brand. No managers, announcers or producers.
 */
function rosterWorld(): RosterTestWorld {
  let secondBrand: BrandId | undefined;
  const { world, ids } = worldBuilder({ startDate: TEST_START_DATE })
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Test Promotion A',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
        regionalPop: { [testId('region', 1)]: 60 },
      },
      (promotion) =>
        promotion
          .withBrand({ name: 'Test Brand One' })
          .withBrand({ name: 'Test Brand Two' })
          .withRoster(6, {
            person: (index) => ({ regionalPop: { [testId('region', 1)]: index === 0 ? 95 : 10 } }),
            employment: (index) => ({
              push: index === 0 ? 'enhancement' : 'lowerCard',
              ringName: `Test Name ${String(index + 1)}`,
            }),
          }),
    )
    .withPromotion({ name: 'Test Promotion B' }, (promotion) => promotion.withRoster(2))
    .with('the second brand and the shared contracts', (context) => {
      const promotionId = context.ids.promotions.A;
      const brandId = context.ids.brands[1];
      if (promotionId === undefined || brandId === undefined) throw new Error('No promotion A.');
      secondBrand = brandId;
      const contracts = [
        { role: 'wrestler', ringName: 'Test Second Brand Name', brandId },
        { role: 'wrestler', ringName: 'Test Shared Name', brandId: null },
        { role: 'referee', ringName: 'Test Referee Name', brandId: null },
      ] as const;
      for (const contract of contracts) {
        const crew = contract.role !== 'wrestler';
        const person = context.insert(
          'people',
          aPerson(
            crew
              ? { roles: [contract.role], style: 'nonWrestler', debutDate: null }
              : { roles: ['wrestler'] },
            context.sequence,
          ),
        );
        context.insert(
          'employments',
          anEmployment(
            {
              personId: person.id,
              promotionId,
              offeredOn: TEST_START_DATE,
              startsOn: TEST_START_DATE,
              role: contract.role,
              push: crew ? 'none' : 'midCard',
              ringName: contract.ringName,
              brandId: contract.brandId,
            },
            context.sequence,
          ),
        );
      }
    })
    .build();
  const own = ids.promotions.A;
  const rival = ids.promotions.B;
  if (own === undefined || rival === undefined || secondBrand === undefined) {
    throw new Error('The roster world lost a promotion or a brand.');
  }
  return { state: initialEngineState(world), own, rival, secondBrand };
}

/** The roster has 9 contracts: 8 wrestlers and 1 referee. */
const ROSTER_SIZE = 9;

interface RenderOptions {
  /** The promotion the session says the seat runs; the engine's own seat when left out. */
  readonly promotionId?: PromotionId;
  /** Leave the engine with no world, as the smoke sweep's bare shell does. */
  readonly noWorld?: boolean;
}

function ProfileStub() {
  const { personId } = useParams();
  return <h1>{`Profile ${personId ?? ''}`}</h1>;
}

function renderRoster(path: string = routes.game.roster(), options: RenderOptions = {}) {
  const world = rosterWorld();
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  if (options.noWorld !== true) {
    const install = transport.host.installEngine(world.state);
    const seat =
      options.promotionId === undefined
        ? install.seat
        : { ...install.seat, promotionId: options.promotionId };
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat });
  }
  const router = createMemoryRouter(
    [
      { path: routes.game.roster(), element: <RosterScreen /> },
      { path: routePatterns.worker, element: <ProfileStub /> },
    ],
    { initialEntries: [path], future: routerFutureFlags },
  );
  render(
    <LiveAnnouncer>
      <EngineProvider createTransport={() => transport}>
        <RouterProvider router={router} future={routerProviderFutureFlags} />
      </EngineProvider>
    </LiveAnnouncer>,
  );
  /** The engine's own rows for the whole roster, to check the screen against. */
  const engineRows = async (): Promise<readonly RosterRow[]> => {
    const answer = await transport.host.query('roster.rows', { promotionId: world.own });
    if (!answer.result.ok) throw new Error('The engine refused the roster.');
    return answer.result.data.rows;
  };
  return { router, world, engineRows, user: userEvent.setup({ delay: null }) };
}

async function findTable(name: string): Promise<HTMLElement> {
  return screen.findByRole('grid', { name }, { timeout: LOAD_MS });
}

/** The ring names in the table, once it has rows. */
async function namesIn(name: string): Promise<string[]> {
  const table = await findTable(name);
  await waitFor(
    () => {
      expect(table.querySelectorAll('tbody tr[data-row-id]').length).toBeGreaterThan(0);
    },
    { timeout: LOAD_MS },
  );
  return within(table)
    .getAllByRole('link')
    .map((link) => link.textContent);
}

/** The number in a tab's badge, from the tab's accessible name: "Wrestlers (8)" is 8. */
function tabCount(tab: HTMLElement): number {
  const match = /\((\d+)\)/.exec(tab.textContent);
  if (match === null) throw new Error(`The tab "${tab.textContent}" has no count.`);
  return Number(match[1]);
}

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

describe('RosterScreen', () => {
  it('shows the roster size, and tab counts that add up to it', async () => {
    renderRoster();
    expect(screen.getByRole('heading', { level: 1, name: 'Roster' })).toBeInTheDocument();
    expect(
      await screen.findByText(
        `${String(ROSTER_SIZE)} under contract at Test Promotion A`,
        {},
        {
          timeout: LOAD_MS,
        },
      ),
    ).toBeInTheDocument();

    const tabs = within(screen.getByRole('tablist', { name: 'Roster sections' })).getAllByRole(
      'tab',
    );
    expect(tabs.map((tab) => tab.textContent.replace(/\d+/g, '').replace(/[()]/g, ''))).toEqual([
      'Wrestlers',
      'Managers',
      'Announcers',
      'Referees',
      'Producers',
      'Others',
      // Registered by WRK6-06 (no count badge).
      'Injuries',
    ]);
    await waitFor(() => {
      const roleTabs = tabs.filter((tab) => !tab.textContent.startsWith('Injuries'));
      expect(roleTabs.reduce((total, tab) => total + tabCount(tab), 0)).toBe(ROSTER_SIZE);
    });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('lists the wrestlers, top of the card first, and switches to another role', async () => {
    const { router, user } = renderRoster();
    const names = await namesIn('Wrestlers at Test Promotion A');
    expect(names).toHaveLength(8);
    expect(names).not.toContain('Test Referee Name');
    // Mid card above lower card above enhancement; ties by ring name.
    expect(names.slice(0, 2)).toEqual(['Test Second Brand Name', 'Test Shared Name']);
    expect(names.at(-1)).toBe('Test Name 1');

    await user.click(screen.getByRole('tab', { name: /Referees/ }));
    expect(await namesIn('Referees at Test Promotion A')).toEqual(['Test Referee Name']);
    expect(router.state.location.search).toBe('?tab=referees');
    // Crew have no card position.
    const table = await findTable('Referees at Test Promotion A');
    expect(within(table).queryByRole('columnheader', { name: /Push/ })).toBeNull();
    expect(within(table).queryByRole('columnheader', { name: /Expects/ })).toBeNull();

    await user.click(screen.getByRole('tab', { name: /Managers/ }));
    expect(
      await screen.findByText('No managers under contract.', {}, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });

  it('opens the tab the URL names', async () => {
    renderRoster(`${routes.game.roster()}?tab=referees`);
    expect(await namesIn('Referees at Test Promotion A')).toEqual(['Test Referee Name']);
  });

  it('falls back to Wrestlers for an unknown tab', async () => {
    renderRoster(`${routes.game.roster()}?tab=nonsense`);
    expect(await namesIn('Wrestlers at Test Promotion A')).toHaveLength(8);
  });

  it('narrows the roster to one brand and keeps it in the URL', async () => {
    const { router, user, world } = renderRoster();
    await namesIn('Wrestlers at Test Promotion A');
    const brand = screen.getByRole('combobox', { name: 'Brand' });
    expect(brand).toHaveTextContent(`All brands (${String(ROSTER_SIZE)})`);

    await choose(user, 'Brand', 'Test Brand Two (1)');
    expect(router.state.location.search).toBe(`?brand=${world.secondBrand}`);
    await waitFor(
      async () => {
        expect(await namesIn('Wrestlers at Test Promotion A')).toEqual(['Test Second Brand Name']);
      },
      { timeout: LOAD_MS },
    );
    // The tab counts follow the brand.
    await waitFor(() => {
      expect(tabCount(screen.getByRole('tab', { name: /Referees/ }))).toBe(0);
    });

    await choose(user, 'Brand', 'Shared (2)');
    expect(router.state.location.search).toBe('?brand=shared');
    await waitFor(() => {
      expect(tabCount(screen.getByRole('tab', { name: /Referees/ }))).toBe(1);
    });
  });

  it('marks a wrestler who expects a bigger push, in words', async () => {
    const { engineRows } = renderRoster();
    const star = (await engineRows()).find((row) => row.pushGap?.verdict === 'expectsMore');
    expect(star?.ringName).toBe('Test Name 1');

    const table = await findTable('Wrestlers at Test Promotion A');
    const row = await waitFor(
      () => {
        const link = within(table).getByRole('link', { name: 'Test Name 1' });
        const found = link.closest('tr');
        if (found === null) throw new Error('No row for Test Name 1.');
        return found;
      },
      { timeout: LOAD_MS },
    );
    expect(within(row).getByText('Expects more')).toBeInTheDocument();
    expect(
      within(row).getByText(/^Expects .+ — expects more than Enhancement$/),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: /^Why is Test Name 1's expected push / }),
    ).toBeInTheDocument();
    // Nobody has worked under their contract yet, so there is no momentum.
    const momentum = row.querySelector('[data-column-id="momentum"]');
    expect(momentum).toHaveTextContent(NO_MOMENTUM);
  });

  it('opens a worker profile when a row is activated', async () => {
    const { router, user, engineRows } = renderRoster();
    const table = await findTable('Wrestlers at Test Promotion A');
    await namesIn('Wrestlers at Test Promotion A');
    const shared = (await engineRows()).find((row) => row.ringName === 'Test Shared Name');
    if (shared === undefined) throw new Error('No shared wrestler.');
    const row = within(table).getByRole('link', { name: 'Test Shared Name' }).closest('tr');
    if (row === null) throw new Error('No row.');
    const pushCell = row.querySelector('[data-column-id="push"]');
    if (!(pushCell instanceof HTMLElement)) throw new Error('No push cell.');

    await user.click(pushCell);
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('heading', { name: `Profile ${shared.personId}` }),
    ).toBeVisible();
    expect(router.state.location.pathname).toBe(routes.game.worker(shared.personId));
  });

  it('says why when the roster cannot be shown', async () => {
    const { rival } = rosterWorld();
    renderRoster(routes.game.roster(), { promotionId: rival });
    expect(await screen.findByText(ROSTER_NOT_YOURS, {}, { timeout: LOAD_MS })).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('asks for a game when no world is loaded', async () => {
    renderRoster(routes.game.roster(), { noWorld: true });
    expect(await screen.findByText(NO_GAME_TEXT, {}, { timeout: LOAD_MS })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Roster' })).toBeInTheDocument();
  });
});

describe('RosterScreen with a registered tab', () => {
  let unregister: (() => void) | null = null;

  afterEach(() => {
    act(() => {
      unregister?.();
    });
    unregister = null;
  });

  it('draws the tab after the role tabs, with its count, and opens it from the URL', async () => {
    unregister = registerRosterTab({
      id: 'test-injuries',
      label: 'Test injuries',
      order: 70,
      count: (context) => context.summary.unavailable,
      render: (context) => <p>{`Test panel for ${context.summary.promotion?.name ?? ''}`}</p>,
    });
    renderRoster(`${routes.game.roster()}?tab=test-injuries`);
    expect(
      await screen.findByText('Test panel for Test Promotion A', {}, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist')).getAllByRole('tab');
    // Six role tabs, the app's own Injuries tab (also order 70, registered first), then this one.
    expect(tabs).toHaveLength(8);
    expect(tabs.at(-1)).toHaveTextContent(/^Test injuries/);
    expect(tabs.at(-1)).toHaveAttribute('aria-selected', 'true');
    expect(tabCount(tabs.at(-1) ?? tabs[0] ?? document.body)).toBe(0);
  });
});
