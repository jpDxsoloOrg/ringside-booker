import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CommandName,
  ProductionChangePreview,
  ProductionOverview,
  PromotionId,
} from '@ringside/engine';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { KpiCard } from '@/components/KpiCard';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { LOAD_MS, renderFinances } from '@/test/financesScreen';
import { NO_EFFECT_TEXT } from './ProductionAreaRow';
import { LOWERING_IS_FREE_TEXT } from './ProductionChangeDialog';
import { PRODUCTION_HEADER_ORDERS } from './ProductionHeader';
import {
  listProductionHeaderItems,
  registerProductionHeaderItem,
  resetProductionHeaderRegistryForTests,
} from './productionHeaderRegistry';
import { ProductionScreen } from './ProductionScreen';
import { ProductionOverviewView } from './ProductionView';

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

afterEach(() => {
  resetProductionHeaderRegistryForTests();
});

interface Issued {
  readonly name: CommandName;
  readonly args: unknown;
}

interface RenderedProduction {
  readonly user: ReturnType<typeof userEvent.setup>;
  readonly transport: InProcessTransport;
  readonly promotionId: PromotionId;
  readonly issued: Issued[];
  /** The player's `production.overview`, asked of the engine directly. */
  readonly askOverview: () => Promise<ProductionOverview>;
  /** The player's `production.changePreview` for camera at `level`, asked directly. */
  readonly askCameraPreview: (level: number) => Promise<ProductionChangePreview>;
}

interface RenderOptions {
  /** Adds this reason to every `production.changePreview` answer, so the change is refused. */
  readonly refuseWith?: string;
}

/** The screen on its own route against the tiny world, with every command recorded. */
function renderProduction(options: RenderOptions = {}): RenderedProduction {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
  const promotionId = install.seat.promotionId;
  if (promotionId === null) throw new Error('The tiny world seats the player at a promotion');
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });

  const { host } = transport;
  const runQuery = host.query.bind(host);
  const runCommand = host.command.bind(host);
  const askOverview = async (): Promise<ProductionOverview> => {
    const { result } = await runQuery('production.overview', { promotionId });
    if (!result.ok) throw new Error('production.overview refused');
    return result.data;
  };
  const askCameraPreview = async (level: number): Promise<ProductionChangePreview> => {
    const { result } = await runQuery('production.changePreview', {
      promotionId,
      area: 'camera',
      level,
    });
    if (!result.ok) throw new Error('production.changePreview refused');
    return result.data;
  };
  const { refuseWith } = options;
  if (refuseWith !== undefined) {
    host.query = async (name, args) => {
      const response = await runQuery(name, args);
      const data: unknown = response.result.ok ? response.result.data : null;
      if (name === 'production.changePreview' && typeof data === 'object' && data !== null) {
        Object.assign(data, {
          reasons: [{ code: 'production.tvDealCamera', message: refuseWith }],
          canApply: false,
        });
      }
      return response;
    };
  }
  const issued: Issued[] = [];
  host.command = async (name, args) => {
    issued.push({ name, args });
    return runCommand(name, args);
  };

  const router = createMemoryRouter(
    [
      {
        path: routes.game.production(),
        element: (
          <LiveAnnouncer>
            <ProductionScreen />
          </LiveAnnouncer>
        ),
      },
    ],
    { initialEntries: [routes.game.production()], future: routerFutureFlags },
  );
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return {
    user: userEvent.setup({ delay: null }),
    transport,
    promotionId,
    issued,
    askOverview,
    askCameraPreview,
  };
}

async function findGroup(name: string): Promise<HTMLElement> {
  return screen.findByRole('region', { name }, { timeout: LOAD_MS });
}

async function findArea(label: string): Promise<HTMLElement> {
  return screen.findByRole('listitem', { name: label }, { timeout: LOAD_MS });
}

describe('ProductionScreen', () => {
  it('shows the eight areas in two groups, each with its level and cost', async () => {
    renderProduction();
    expect(screen.getByRole('heading', { level: 1, name: 'Production' })).toBeInTheDocument();
    const perShow = await findGroup('On every show');
    const monthly = await findGroup('Every month');
    const names = (group: HTMLElement): string[] =>
      within(group)
        .getAllByRole('heading', { level: 3 })
        .map((heading) => heading.textContent);
    expect(names(perShow)).toEqual(['Stage', 'Camera', 'Editing', 'Pyro']);
    expect(names(monthly)).toEqual(['Music', 'Writing', 'Marketing', 'Back office']);

    const camera = await findArea('Camera');
    expect(within(camera).getByRole('group', { name: 'Camera level' })).toBeInTheDocument();
    expect(
      within(camera).getByText(/^per .+\((house|minor|regular|major|flagship)\)$/u),
    ).toBeInTheDocument();
    expect(within(camera).getByRole('button', { name: /^Why is Camera per / })).toBeInTheDocument();
    const music = await findArea('Music');
    expect(within(music).getByText('a month')).toBeInTheDocument();
  });

  it('shows the header numbers with their Why? buttons', async () => {
    const rendered = renderProduction();
    const overview = await rendered.askOverview();
    const header = await screen.findByRole(
      'group',
      { name: 'Production at a glance' },
      { timeout: LOAD_MS },
    );
    const ceiling = within(header).getByRole('group', { name: 'Popularity ceiling' });
    expect(
      within(ceiling).getByRole('button', { name: /^Why is Popularity ceiling/u }),
    ).toBeInTheDocument();
    const overhead = within(header).getByRole('group', { name: 'Monthly overhead' });
    expect(
      within(overhead).getByRole('button', { name: /^Why is Monthly overhead/u }),
    ).toBeInTheDocument();
    expect(within(overhead).getByText('Back office')).toBeInTheDocument();
    const shows = within(header).getByRole('group', { name: 'Show production, next 4 weeks' });
    expect(
      within(shows).getByRole('button', { name: /^Why is Show production/u }),
    ).toBeInTheDocument();
    const count = overview.upcomingShows?.count ?? 0;
    expect(
      within(shows).getByText(
        count === 0 ? 'No shows in the next 4 weeks' : new RegExp(`^${String(count)} shows?,`, 'u'),
      ),
    ).toBeInTheDocument();
  });

  it('says "No effect yet" for an area nothing uses', async () => {
    renderProduction();
    const music = await findArea('Music');
    expect(within(music).getByText(`${NO_EFFECT_TEXT}.`)).toBeInTheDocument();
    // The show-quality ceiling fills the per-show rows.
    const camera = await findArea('Camera');
    expect(within(camera).queryByText(`${NO_EFFECT_TEXT}.`)).toBeNull();
    expect(within(camera).getByText(/^Shows can score up to /u)).toBeInTheDocument();
  });

  it('opens the change dialog one level up with the fee and the after-values from the preview', async () => {
    const rendered = renderProduction();
    const camera = await findArea('Camera');
    const overview = await rendered.askOverview();
    const from = overview.rows.find((row) => row.area === 'camera')?.level ?? 0;
    const preview = await rendered.askCameraPreview(from + 1);

    await rendered.user.click(within(camera).getByRole('button', { name: 'Raise Camera' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: `Camera: level ${String(from)} → ${String(from + 1)}`,
    });
    const confirm = await within(dialog).findByRole(
      'button',
      { name: /^Pay \$[\d,]+ and raise$/u },
      { timeout: LOAD_MS },
    );
    await waitFor(() => {
      expect(confirm).toBeEnabled();
    });
    expect(within(dialog).getByText('One-time fee')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: /^Why is Camera upgrade fee/u }),
    ).toBeInTheDocument();
    for (const row of preview.rows) {
      expect(within(dialog).getByText(row.label)).toBeInTheDocument();
    }
    expect(within(dialog).getByText('Show quality ceiling')).toBeInTheDocument();

    // Confirming runs the command with the level shown, and the dialog closes.
    await rendered.user.click(confirm);
    await waitFor(() => {
      expect(rendered.issued).toEqual([
        {
          name: 'production.setLevel',
          args: { promotionId: rendered.promotionId, area: 'camera', level: from + 1 },
        },
      ]);
    });
    await waitFor(
      () => {
        expect(screen.queryByRole('alertdialog')).toBeNull();
      },
      { timeout: LOAD_MS },
    );
    await waitFor(
      () => {
        expect(within(camera).getByRole('meter', { name: 'Camera level' })).toHaveAttribute(
          'aria-valuenow',
          String(from + 1),
        );
      },
      { timeout: LOAD_MS },
    );
  });

  it('lets the level move inside the dialog and says lowering is free', async () => {
    const rendered = renderProduction();
    const camera = await findArea('Camera');
    await rendered.user.click(within(camera).getByRole('button', { name: 'Raise Camera' }));
    const dialog = await screen.findByRole('alertdialog');
    const stepper = within(dialog).getByRole('group', { name: 'Camera level' });
    await rendered.user.click(within(stepper).getByRole('button', { name: 'Lower Camera' }));
    await rendered.user.click(within(stepper).getByRole('button', { name: 'Lower Camera' }));
    expect(within(dialog).getByText(LOWERING_IS_FREE_TEXT)).toBeInTheDocument();
    expect(
      await within(dialog).findByRole('button', { name: /^Lower to \d+$/u }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });

  it('shows a refusal in place and holds the confirm back', async () => {
    const message = 'You have an active TV deal with Channel 9: camera stays at 3 or higher';
    const rendered = renderProduction({ refuseWith: message });
    const camera = await findArea('Camera');
    await rendered.user.click(within(camera).getByRole('button', { name: 'Raise Camera' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(await within(dialog).findByText(message, {}, { timeout: LOAD_MS })).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', {
      name: /^(Pay .+ and raise|Raise to \d+)$/u,
    });
    expect(confirm).toBeDisabled();
    await rendered.user.click(confirm);
    expect(rendered.issued).toEqual([]);
  });
});

describe('ProductionOverviewView for a rival', () => {
  it('shows levels and effect lines with no buttons and no costs', async () => {
    const rendered = renderProduction();
    const own = await rendered.askOverview();
    const rival: ProductionOverview = {
      ...own,
      mine: false,
      monthlyOverhead: null,
      upcomingShows: null,
      typicalImportance: null,
      tvDeal: null,
      rows: own.rows.map((row) => ({ ...row, cost: null, costTrace: null, costBasis: null })),
    };
    document.body.innerHTML = '';
    render(<ProductionOverviewView overview={rival} />);
    expect(screen.getAllByRole('listitem', { name: /./u }).length).toBeGreaterThanOrEqual(8);
    expect(screen.queryByRole('button', { name: /^(Raise|Lower) /u })).toBeNull();
    expect(screen.queryByText('a month')).toBeNull();
    expect(screen.getAllByRole('meter')).toHaveLength(8);
    const header = screen.getByRole('group', { name: 'Production at a glance' });
    expect(
      within(header)
        .getAllByRole('group')
        .map((card) => card.getAttribute('aria-labelledby')),
    ).toHaveLength(1);
    expect(within(header).getByRole('group', { name: 'Popularity ceiling' })).toBeInTheDocument();
    expect(screen.getAllByText(/^Shows can score up to /u)).toHaveLength(4);
  });
});

describe('the production header registry', () => {
  it('holds ECO7 cards at 20, 30 and 40 and refuses a taken id', () => {
    expect(listProductionHeaderItems().map((item) => [item.id, item.order])).toEqual([
      ['production.popularityCeiling', PRODUCTION_HEADER_ORDERS.popularityCeiling],
      ['production.monthlyOverhead', PRODUCTION_HEADER_ORDERS.monthlyOverhead],
      ['production.upcomingShows', PRODUCTION_HEADER_ORDERS.upcomingShows],
    ]);
    expect(() =>
      registerProductionHeaderItem({
        id: 'production.monthlyOverhead',
        order: 5,
        render: () => null,
      }),
    ).toThrow(/already registered/u);
  });

  it('draws an added card in its place and takes it out on the test reset', async () => {
    registerProductionHeaderItem({
      id: 'cardFlow.showCeiling',
      order: 10,
      render: () => <KpiCard label="Show quality ceiling" value="47" />,
    });
    expect(listProductionHeaderItems()[0]?.id).toBe('cardFlow.showCeiling');
    renderProduction();
    const header = await screen.findByRole(
      'group',
      { name: 'Production at a glance' },
      { timeout: LOAD_MS },
    );
    const cards = within(header)
      .getAllByRole('group')
      .map((card) => card.textContent);
    expect(cards[0]).toMatch(/^Show quality ceiling/u);
    resetProductionHeaderRegistryForTests();
    expect(listProductionHeaderItems()).toHaveLength(3);
  });
});

describe('the Monthly overhead card on the Finances Overview', () => {
  it('renders through the finance KPI registry with its Why? and a link to Production', async () => {
    await renderFinances();
    const card = await screen.findByRole(
      'group',
      { name: 'Monthly overhead' },
      { timeout: LOAD_MS },
    );
    expect(
      within(card).getByRole('button', { name: /^Why is Monthly overhead/u }),
    ).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Production' })).toHaveAttribute(
      'href',
      routes.game.production(),
    );
  });
});
