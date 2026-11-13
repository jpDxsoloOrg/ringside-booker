import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineState } from '@ringside/engine';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { StatusChips } from '@/app/AppShell/status/StatusChips';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { OfficeScreen } from './OfficeScreen';
import { PANEL_ERROR_TITLE } from './panels/OfficePanelFrame';
import { registerOfficePanel } from './panels/officePanelRegistry';

/** The engine's first answer can take a moment under load. */
const LOAD_MS = 10_000;

/**
 * Days simulated before the Office opens. The tiny world starts on Friday 10 April 2026, so this
 * crosses three Mondays (13, 20 and 27 April), leaving three weekly rows, and today is Tuesday 28.
 */
const DAYS_PLAYED = 18;

const KPI_LABELS = ['Cash', 'Popularity', 'Prestige', 'Roster', 'Average morale'] as const;

/** Hands every promotion and brand to the computer, so the local seat runs none. */
function withoutHumanPromotion(state: EngineState): EngineState {
  const { tables } = state.world;
  return {
    ...state,
    world: {
      ...state.world,
      tables: {
        ...tables,
        promotions: tables.promotions.map((promotion) => ({
          ...promotion,
          controller: { kind: 'computer' as const },
        })),
        brands: tables.brands.map((brand) =>
          brand.controller === null
            ? brand
            : { ...brand, controller: { kind: 'computer' as const } },
        ),
      },
    },
  };
}

interface RenderOptions {
  readonly daysPlayed?: number;
  readonly noPromotion?: boolean;
}

async function renderOffice(options: RenderOptions = {}): Promise<InProcessTransport> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const state = fakeEngineState();
  const install = transport.host.installEngine(
    options.noPromotion === true ? withoutHumanPromotion(state) : state,
  );
  if (options.daysPlayed !== undefined) {
    await transport.host.advanceDays({ maxDays: options.daysPlayed }, () => undefined);
  }
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });

  const router = createMemoryRouter(
    [
      {
        path: routes.game.office(),
        element: (
          <LiveAnnouncer>
            <OfficeScreen />
          </LiveAnnouncer>
        ),
      },
    ],
    { initialEntries: [routes.game.office()], future: routerFutureFlags },
  );
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return transport;
}

async function findKeyNumbers(): Promise<HTMLElement> {
  return screen.findByRole('group', { name: 'Key numbers' }, { timeout: LOAD_MS });
}

/** The ids of the panels drawn in a column, top to bottom. */
function panelIdsIn(column: 'main' | 'side'): (string | null)[] {
  const element = document.querySelector(`[data-office-column="${column}"]`);
  if (element === null) return [];
  return Array.from(element.querySelectorAll('[data-office-panel]')).map((panel) =>
    panel.getAttribute('data-office-panel'),
  );
}

const removers: (() => void)[] = [];

afterEach(() => {
  act(() => {
    for (const remove of removers.splice(0)) remove();
  });
  vi.restoreAllMocks();
});

describe('OfficeScreen', () => {
  it('is titled Dashboard and shows no sample data', async () => {
    await renderOffice();

    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    await findKeyNumbers();
    expect(screen.queryByText(/sample data/iu)).toBeNull();
    expect(screen.queryByText('Placeholder')).toBeNull();
    await waitFor(() => {
      expect(document.title).toBe('Dashboard · Ringside Booker');
    });
  });

  it('shows the five key numbers, with the cash the top bar shows', async () => {
    const transport = await renderOffice({ daysPlayed: DAYS_PLAYED });

    const grid = await findKeyNumbers();
    for (const label of KPI_LABELS) {
      expect(within(grid).getByRole('group', { name: label })).toBeInTheDocument();
    }

    const status = await transport.host.query('sim.status', {});
    if (!status.result.ok) throw new Error('sim.status was refused');
    render(
      <EngineProvider createTransport={() => transport}>
        <StatusChips status={status.result.data} placement="bar" />
      </EngineProvider>,
    );
    const chipMoney = within(screen.getByTestId('cash-chip')).getByText(/\$/u).textContent;
    expect(chipMoney).not.toBe('');
    const cashCard = within(grid).getByRole('group', { name: 'Cash' });
    expect(within(cashCard).getByText(chipMoney)).toBeInTheDocument();
  });

  it('opens the change since last week in the Why? panel, naming both dates', async () => {
    await renderOffice({ daysPlayed: DAYS_PLAYED });
    const user = userEvent.setup({ delay: null });

    const grid = await findKeyNumbers();
    const cashCard = within(grid).getByRole('group', { name: 'Cash' });
    expect(within(cashCard).getByText('vs last week')).toBeInTheDocument();
    expect(within(cashCard).getByRole('img', { name: /^Cash, last 8 weeks/u })).toBeInTheDocument();
    await user.click(within(cashCard).getByRole('button', { name: /^Why is change in cash/u }));

    const panel = await screen.findByRole('dialog', { name: /Change in cash since/u });
    expect(panel).toHaveTextContent('Tue 28 Apr');
    expect(panel).toHaveTextContent('Mon 20 Apr');
  });

  it('draws a registered panel in its column and order, and drops it once removed', async () => {
    removers.push(
      registerOfficePanel({
        id: 'test.later',
        order: 40,
        column: 'main',
        render: () => <p>Later panel</p>,
      }),
      registerOfficePanel({
        id: 'test.earlier',
        order: 30,
        column: 'main',
        render: () => <p>Earlier panel</p>,
      }),
      registerOfficePanel({ id: 'test.nothing', order: 35, column: 'main', render: () => null }),
    );
    const removeSide = registerOfficePanel({
      id: 'test.side',
      order: 5,
      column: 'side',
      render: () => <p>Side panel</p>,
    });
    removers.push(removeSide);
    await renderOffice();

    await screen.findByText('Side panel', undefined, { timeout: LOAD_MS });
    // Partner panels (DAY2-06) sit after these, from order 50 on.
    expect(panelIdsIn('main').slice(0, 2)).toEqual(['test.earlier', 'test.later']);
    expect(panelIdsIn('main')).not.toContain('test.nothing');
    expect(panelIdsIn('side')).toEqual(['test.side', 'day2.worldClock']);

    act(() => {
      removeSide();
    });
    await waitFor(() => {
      expect(screen.queryByText('Side panel')).toBeNull();
    });
    expect(panelIdsIn('side')).toEqual(['day2.worldClock']);
  });

  it('shows a broken panel as one that could not load, and keeps the key numbers', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Broken(): never {
      throw new Error('The test panel broke on purpose');
    }
    removers.push(
      registerOfficePanel({
        id: 'test.broken',
        order: 30,
        column: 'main',
        render: () => <Broken />,
      }),
    );
    await renderOffice();

    const grid = await findKeyNumbers();
    expect(await screen.findByText(PANEL_ERROR_TITLE)).toBeInTheDocument();
    expect(screen.getByText('test.broken')).toBeInTheDocument();
    expect(within(grid).getByRole('group', { name: 'Cash' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'World clock' })).toBeInTheDocument();
    const ownLogs = logged.mock.calls.filter(
      ([message]) => typeof message === 'string' && message.includes('"test.broken"'),
    );
    expect(ownLogs).toHaveLength(1);
  });

  it('shows a seat with no promotion the world overview and no key numbers', async () => {
    await renderOffice({ noPromotion: true });

    const table = await screen.findByRole(
      'grid',
      { name: 'Promotions in the world' },
      { timeout: LOAD_MS },
    );
    expect(screen.getByText('World overview')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Key numbers' })).toBeNull();
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(1);
    expect(screen.getByText(/ under contract · /u)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'World clock' })).toHaveTextContent(
      'Friday, April 10, 2026',
    );
  });

  it('opens the Fan base sheet from the Popularity card for your promotion (DAY2-05)', async () => {
    await renderOffice();
    const user = userEvent.setup({ delay: null });

    const grid = await findKeyNumbers();
    const popularity = within(grid).getByRole('group', { name: 'Popularity' });
    await user.click(within(popularity).getByRole('button', { name: 'Fan base' }));

    const sheet = await screen.findByRole(
      'dialog',
      { name: /^Fan base · /u },
      { timeout: LOAD_MS },
    );
    expect(sheet).toHaveTextContent('Shown as popularity in your home country');
    expect(
      within(sheet).getByRole('group', { name: /^Popularity of .+ by place$/u }),
    ).toBeVisible();
  });

  it("opens one Fan base sheet for a world overview row's promotion (DAY2-05)", async () => {
    await renderOffice({ noPromotion: true });
    const user = userEvent.setup({ delay: null });

    const table = await screen.findByRole(
      'grid',
      { name: 'Promotions in the world' },
      { timeout: LOAD_MS },
    );
    const buttons = within(table).getAllByRole('button', { name: /^Fan base of /u });
    const first = buttons[0];
    if (first === undefined) throw new Error('Every row has a Fan base button');
    const name = (first.getAttribute('aria-label') ?? '').replace(/^Fan base of /u, '');
    await user.click(first);

    const sheet = await screen.findByRole(
      'dialog',
      { name: `Fan base · ${name}` },
      { timeout: LOAD_MS },
    );
    expect(sheet).toHaveTextContent('Shown as popularity in its home country');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('draws the partner panels through the registry, in the order office.md lists (DAY2-06)', async () => {
    await renderOffice();

    await screen.findByRole('region', { name: 'Next show' }, { timeout: LOAD_MS });
    await screen.findByRole('region', { name: 'Last show' }, { timeout: LOAD_MS });
    const main = panelIdsIn('main');
    expect(main.indexOf('calendar.nextShow')).toBeLessThan(main.indexOf('shows.lastShow'));
    expect(main.indexOf('shows.lastShow')).toBeLessThan(main.indexOf('promoPop.lastShow'));
  });

  it('links the Cash card to Finances (DAY2-06)', async () => {
    await renderOffice();

    const grid = await findKeyNumbers();
    const cashCard = within(grid).getByRole('group', { name: 'Cash' });
    expect(within(cashCard).getByRole('link', { name: 'Finances' })).toHaveAttribute(
      'href',
      routes.game.finances(),
    );
  });
});
