import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EngineState } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { registerTitleDetailSection } from './titleDetailSections';

/** The engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

const HEAVYWEIGHT = 'Test Heavyweight Title';
const TAG = 'Test Tag Team Title';

function renderAt(path: string, state: EngineState = fakeEngineState()) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { router, user: userEvent.setup({ delay: null }) };
}

/** The tiny world with its tag title vacated the day its current reign began. */
function vacantTagState(): EngineState {
  const state = fakeEngineState();
  const tag = state.world.tables.titles.find((title) => title.name === TAG);
  if (tag === undefined) throw new Error('The tiny world has no tag title.');
  return {
    ...state,
    world: {
      ...state.world,
      tables: {
        ...state.world.tables,
        titleReigns: state.world.tables.titleReigns.map((reign) =>
          reign.titleId === tag.id && reign.lostOn === null
            ? { ...reign, lostOn: reign.wonOn, endReason: 'vacated' as const }
            : reign,
        ),
      },
    },
  };
}

async function findCard(name: string): Promise<HTMLElement> {
  return screen.findByRole('article', { name }, { timeout: LOAD_MS });
}

/** The id of a tiny-world title, by name. */
function titleIdOf(name: string) {
  const title = fakeEngineState().world.tables.titles.find((row) => row.name === name);
  if (title === undefined) throw new Error(`No title called ${name}.`);
  return title.id;
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

describe('TitlesScreen', () => {
  it('shows our titles as champion cards with links, and no actions', async () => {
    renderAt(routes.game.titles());
    const card = await findCard(HEAVYWEIGHT);
    expect(screen.getByRole('heading', { level: 1, name: 'Titles' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Our titles' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(card).getByRole('link', { name: HEAVYWEIGHT })).toHaveAttribute(
      'href',
      routes.game.title(titleIdOf(HEAVYWEIGHT)),
    );
    expect(within(card).getByRole('meter', { name: 'Prestige' })).toBeInTheDocument();
    expect(await findCard(TAG)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Active (2)' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Retired (0)' })).toBeInTheDocument();
    // Read-only until CRTV1-05: the only buttons are the Why? chips.
    const main = screen.getByRole('main');
    for (const button of within(main).queryAllByRole('button')) {
      expect(button).toHaveAccessibleName(/^Why\? /);
    }
  });

  it('keeps the tab and the filter in the URL', async () => {
    const { router, user } = renderAt(routes.game.titles());
    await findCard(HEAVYWEIGHT);

    await user.click(screen.getByRole('tab', { name: 'Around the world' }));
    expect(router.state.location.search).toBe('?tab=world');
    expect(
      await screen.findByText('No other promotion has an active title.', undefined, {
        timeout: LOAD_MS,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /^Retired/ }));
    expect(router.state.location.search).toBe('?tab=world&status=retired');
    expect(
      await screen.findByText('No retired titles', undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });

  it('opens on the view the URL names', async () => {
    renderAt(`${routes.game.titles()}?status=retired`);
    expect(
      await screen.findByText('No retired titles', undefined, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Retired (0)' })).toBeChecked();
  });

  it('says a title is vacant', async () => {
    renderAt(routes.game.titles(), vacantTagState());
    const card = await findCard(TAG);
    expect(card).toHaveAttribute('data-vacant', 'true');
    expect(within(card).getByText('Vacant')).toBeInTheDocument();
  });

  it('explains a prestige the world file set', async () => {
    const { user } = renderAt(routes.game.titles());
    const card = await findCard(HEAVYWEIGHT);
    await user.click(within(card).getByRole('button', { name: /^Why\? Test Heavyweight Title/ }));
    const panel = await screen.findByRole('dialog', { name: `Prestige: ${HEAVYWEIGHT}` });
    expect(within(panel).getAllByText(/Prestige set by the world file/).length).toBeGreaterThan(0);
  });
});

describe('TitleDetailScreen', () => {
  it('shows the header, champion, lineage newest first and records', async () => {
    renderAt(routes.game.title(titleIdOf(HEAVYWEIGHT)));
    expect(
      await screen.findByRole('heading', { level: 1, name: HEAVYWEIGHT }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getByText('Singles')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Champion' })).toBeInTheDocument();

    const lineage = screen.getByRole('grid', { name: `Lineage of the ${HEAVYWEIGHT}` });
    const [, first, second] = within(lineage).getAllByRole('row');
    if (first === undefined || second === undefined) throw new Error('The lineage has no rows.');
    expect(first).toHaveTextContent('Current');
    expect(first).toHaveTextContent('Current champion');
    expect(second).toHaveTextContent('Lost the title');
    expect(within(first).getByRole('cell', { name: '2' })).toBeInTheDocument();
    expect(within(second).getByRole('cell', { name: '1' })).toBeInTheDocument();

    const records = screen.getByRole('region', { name: 'Records' });
    expect(within(records).getByText('Total reigns')).toBeInTheDocument();
    expect(within(records).getByText('Longest reign')).toBeInTheDocument();
    expect(within(records).getAllByRole('link').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Back to Titles' })).toHaveAttribute(
      'href',
      routes.game.titles(),
    );
  });

  it('says a vacant title is vacant and since when', async () => {
    renderAt(routes.game.title(titleIdOf(TAG)), vacantTagState());
    const champion = await screen.findByRole('region', { name: 'Champion' }, { timeout: LOAD_MS });
    expect(within(champion).getByText(/^Vacant since/)).toBeInTheDocument();
    expect(screen.getByText('Tag team')).toBeInTheDocument();
    expect(screen.getAllByText('Vacated').length).toBeGreaterThan(0);
  });

  it('shows a friendly empty state for a title that does not exist', async () => {
    renderAt(routes.game.title(titleIdOf(HEAVYWEIGHT).replace(/.$/, 'z') as never));
    expect(
      await screen.findByRole(
        'heading',
        { level: 1, name: 'Title not found' },
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("That title doesn't exist any more.")).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Back to Titles' }).length).toBeGreaterThan(0);
  });

  describe('with registered sections', () => {
    let removers: (() => void)[] = [];
    afterEach(() => {
      // Unmount first, so taking the sections away does not re-render a page under test.
      cleanup();
      for (const remove of removers) remove();
      removers = [];
    });

    it('draws main sections after the lineage and side sections under the records', async () => {
      removers = [
        registerTitleDetailSection({
          id: 'test-main',
          order: 10,
          column: 'main',
          render: ({ detail }) => <p>{`Main for ${detail.title.name}`}</p>,
        }),
        registerTitleDetailSection({
          id: 'test-side',
          order: 10,
          column: 'side',
          render: () => <p>Side section</p>,
        }),
        registerTitleDetailSection({
          id: 'test-hidden',
          order: 5,
          column: 'main',
          render: () => <p>Hidden section</p>,
          visible: () => false,
        }),
      ];
      renderAt(routes.game.title(titleIdOf(HEAVYWEIGHT)));
      const main = await screen.findByText(`Main for ${HEAVYWEIGHT}`, undefined, {
        timeout: LOAD_MS,
      });
      const side = screen.getByText('Side section');
      const lineage = screen.getByRole('region', { name: 'Lineage' });
      const records = screen.getByRole('region', { name: 'Records' });
      expect(lineage.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(records.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.queryByText('Hidden section')).toBeNull();
    });
  });
});
