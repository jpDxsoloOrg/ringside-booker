import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { setMatchMedia } from '@/test/matchMedia';
import { devSeat } from '../dev/EnterShellRoute';
import { navigationSections } from '../navigation';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '../router';
import { routes } from '../routes';
import { useSessionStore } from '../session/sessionStore';
import { AppShell } from './AppShell';
import type { AppShellProps } from './AppShell';

function renderRoutes(routeList: RouteObject[], path: string): void {
  const router = createMemoryRouter(routeList, {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(<RouterProvider router={router} future={routerProviderFutureFlags} />);
}

function renderApp(path: string): void {
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(
    // The Office reads the engine; with no world installed it says so instead of crashing.
    <EngineProvider createTransport={() => createInProcessTransport(fakeEngineFactory())}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
}

/** The shell on its own at /game/office, with a stub screen and the given props. */
function renderShell(props: Omit<AppShellProps, 'children'>): void {
  renderRoutes(
    [
      {
        path: routes.game.office(),
        element: (
          <AppShell sections={navigationSections} {...props}>
            <p>Stub screen</p>
          </AppShell>
        ),
      },
    ],
    routes.game.office(),
  );
}

function loadWorld({ employed }: { readonly employed: boolean }): void {
  useSessionStore
    .getState()
    .setLoaded({ saveSlotId: null, seat: devSeat(employed ? 'pro_dev' : null) });
}

function usePhoneLayout(): void {
  setMatchMedia((query) => query === BP_MOBILE_QUERY);
}

beforeEach(() => {
  useSessionStore.getState().clear();
});

describe('shell chrome on desktop', () => {
  it('shows the promotion crest block under the wordmark', async () => {
    loadWorld({ employed: true });
    renderApp(routes.game.office());

    const block = await screen.findByTestId('promotion-block');
    expect(block).toHaveTextContent('Longleaf Championship Wrestling');
    expect(block).toHaveTextContent('Sample');
    expect(screen.getByRole('link', { name: 'Ringside Booker' })).toHaveAttribute(
      'href',
      routes.game.office(),
    );
  });

  it('says there is no promotion while unemployed', async () => {
    loadWorld({ employed: false });
    renderApp(routes.game.office());

    expect(await screen.findByTestId('promotion-block')).toHaveTextContent('No promotion');
  });

  it('fills the top bar with the status strip and the Next Day bug', async () => {
    loadWorld({ employed: true });
    renderApp(routes.game.office());

    const banner = await screen.findByRole('banner');
    const status = within(banner).getByRole('group', { name: 'Status (sample figures)' });
    expect(status).toHaveTextContent('Week 11 · Season 2');
    expect(status).toHaveTextContent('Mar 14, 2031');
    expect(within(status).getByText('Cash')).toBeInTheDocument();
    expect(within(status).getByText('Popularity')).toBeInTheDocument();
    expect(status).toHaveTextContent('82%');

    const nextDay = within(banner).getByRole('button', { name: 'Next day' });
    expect(nextDay).toHaveAttribute('aria-disabled', 'true');
    expect(nextDay).toHaveAccessibleDescription('Not available yet.');
  });

  it('leaves cash and popularity out while unemployed', async () => {
    loadWorld({ employed: false });
    renderApp(routes.game.office());

    const status = await screen.findByRole('group', { name: 'Status (sample figures)' });
    expect(status).toHaveTextContent('Week 11 · Season 2');
    expect(within(status).queryByText('Cash')).toBeNull();
    expect(within(status).queryByText('Popularity')).toBeNull();
  });

  it('shows the ticker after the content, labelled as sample news', async () => {
    loadWorld({ employed: true });
    renderApp(routes.game.office());

    const ticker = await screen.findByRole('region', { name: 'News ticker' });
    expect(ticker).toHaveTextContent('Sample news');
    const main = screen.getByRole('main');
    expect(main.compareDocumentPosition(ticker) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('shell chrome on a phone', () => {
  it('keeps a crest, a short status and Next Day in the top bar', async () => {
    usePhoneLayout();
    loadWorld({ employed: true });
    renderApp(routes.game.office());

    const banner = await screen.findByRole('banner');
    const status = within(banner).getByRole('group', { name: 'Status (sample figures)' });
    expect(status).toHaveTextContent('Wk 11 · S2');
    expect(within(status).queryByText('Popularity')).toBeNull();
    expect(within(banner).getByRole('button', { name: 'Next day' })).toBeInTheDocument();
    expect(screen.queryByTestId('promotion-block')).toBeNull();
  });

  it('puts the ticker between the content and the tab bar', async () => {
    usePhoneLayout();
    loadWorld({ employed: true });
    renderApp(routes.game.office());

    const ticker = await screen.findByRole('region', { name: 'News ticker' });
    const tabBar = screen.getByRole('navigation', { name: 'Primary' });
    expect(ticker.compareDocumentPosition(tabBar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('shell slots', () => {
  it('lets the day control replace the end of the top bar', async () => {
    loadWorld({ employed: true });
    renderShell({
      renderTopBarEnd: ({ compact }) => <span>{compact ? 'compact end' : 'wide end'}</span>,
    });

    const banner = await screen.findByRole('banner');
    expect(within(banner).getByText('wide end')).toBeInTheDocument();
    expect(within(banner).queryByRole('button', { name: 'Next day' })).toBeNull();
  });

  it('takes its own ticker, or none', async () => {
    loadWorld({ employed: true });
    renderShell({ ticker: <p>Real headlines</p> });
    expect(await screen.findByText('Real headlines')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'News ticker' })).toBeNull();
  });

  it('draws no ticker strip when given null', async () => {
    loadWorld({ employed: true });
    renderShell({ ticker: null });

    await screen.findByText('Stub screen');
    expect(screen.queryByTestId('ticker-slot')).toBeNull();
  });
});
