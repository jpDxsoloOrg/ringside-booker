import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { setMatchMedia } from '@/test/matchMedia';
import { LiveAnnouncer, useAnnounce } from '../a11y/LiveAnnouncer';
import { devSeat } from '../dev/EnterShellRoute';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '../router';
import { routes } from '../routes';
import { useSessionStore } from '../session/sessionStore';

type AppRouter = ReturnType<typeof createMemoryRouter>;

function renderApp(path: string): AppRouter {
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
  return router;
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

describe('AppShell on desktop', () => {
  it('shows the sidebar sections and no bottom bar', async () => {
    loadWorld({ employed: true });
    renderApp(routes.game.office());

    const sidebar = await screen.findByRole('navigation', { name: 'Main' });
    for (const heading of ['Office', 'World', 'Your promotion', 'Creative', 'Business']) {
      expect(within(sidebar).getByRole('heading', { level: 2, name: heading })).toBeVisible();
    }
    expect(screen.queryByRole('navigation', { name: 'Primary' })).toBeNull();
  });

  it('marks the current page in the sidebar and names it in the top bar', async () => {
    loadWorld({ employed: true });
    renderApp(routes.game.titles());

    const sidebar = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(sidebar).getByRole('link', { name: 'Titles' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(sidebar).getByRole('link', { name: 'Roster' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(screen.getByRole('banner')).getByText('Creative')).toBeInTheDocument();
  });

  it('hides the promotion sections while unemployed', async () => {
    loadWorld({ employed: false });
    renderApp(routes.game.office());

    const sidebar = await screen.findByRole('navigation', { name: 'Main' });
    expect(within(sidebar).getByRole('heading', { name: 'World' })).toBeVisible();
    expect(within(sidebar).queryByRole('heading', { name: 'Creative' })).toBeNull();
    expect(within(sidebar).queryByRole('heading', { name: 'Your promotion' })).toBeNull();
    expect(within(sidebar).queryByRole('heading', { name: 'Business' })).toBeNull();
  });

  it('renders the placeholder screen with the item label as the heading and page title', async () => {
    loadWorld({ employed: true });
    renderApp(routes.game.storylines());

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Storylines' }),
    ).toBeInTheDocument();
    expect(screen.getByText("This screen isn't built yet")).toBeInTheDocument();
    await waitFor(() => {
      expect(document.title).toBe('Storylines · Ringside Booker');
    });
  });

  it('puts the skip link first and the content in the main landmark', async () => {
    loadWorld({ employed: true });
    renderApp(routes.game.office());

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    const user = userEvent.setup();
    await user.tab();

    const skipLink = screen.getByRole('link', { name: 'Skip to content' });
    expect(skipLink).toHaveFocus();
    expect(skipLink).toHaveAttribute('href', '#main');

    await user.click(skipLink);
    expect(screen.getByRole('main')).toHaveFocus();
  });
});

describe('AppShell on a phone', () => {
  it('shows the bottom bar with four tabs and More, and no sidebar', async () => {
    usePhoneLayout();
    loadWorld({ employed: true });
    renderApp(routes.game.office());

    const bottomNav = await screen.findByRole('navigation', { name: 'Primary' });
    const tabs = within(bottomNav).getAllByRole('link');
    const buttons = within(bottomNav).getAllByRole('button');

    expect(tabs.map((tab) => tab.textContent)).toEqual(['Office', 'Roster', 'Booking', 'Calendar']);
    expect(buttons.map((button) => button.textContent)).toEqual(['More']);
    expect(tabs.length + buttons.length).toBe(5);
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('falls back to World and Office screens in the tab bar while unemployed', async () => {
    usePhoneLayout();
    loadWorld({ employed: false });
    renderApp(routes.game.office());

    const bottomNav = await screen.findByRole('navigation', { name: 'Primary' });
    expect(
      within(bottomNav)
        .getAllByRole('link')
        .map((tab) => tab.textContent),
    ).toEqual(['Office', 'Workers', 'Inbox', 'News']);
  });

  it('opens every section in the More sheet and closes it after navigating', async () => {
    usePhoneLayout();
    loadWorld({ employed: true });
    renderApp(routes.game.office());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'More' }));

    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    for (const heading of ['Office', 'World', 'Your promotion', 'Creative', 'Business']) {
      expect(within(sheet).getByRole('heading', { level: 3, name: heading })).toBeVisible();
    }
    expect(within(sheet).getByRole('link', { name: 'Settings' })).toHaveAttribute(
      'href',
      routes.settings(),
    );
    expect(within(sheet).getByRole('button', { name: 'Main menu' })).toBeEnabled();

    await user.click(within(sheet).getByRole('link', { name: 'Titles' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Titles' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens Settings from the sidebar and returns to the game screen it left', async () => {
    loadWorld({ employed: true });
    const router = renderApp(routes.game.roster());
    const user = userEvent.setup();

    const sidebar = await screen.findByTestId('sidebar');
    await user.click(within(sidebar).getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: 'Back to game' }));
    expect(router.state.location.pathname).toBe(routes.game.roster());
    expect(await screen.findByRole('heading', { level: 1, name: 'Roster' })).toBeInTheDocument();
  });

  it('opens Settings from the More sheet and returns to the game screen it left', async () => {
    usePhoneLayout();
    loadWorld({ employed: true });
    const router = renderApp(routes.game.titles());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'More' }));
    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    await user.click(within(sheet).getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Back to game' }));
    expect(router.state.location.pathname).toBe(routes.game.titles());
  });

  it('leaves the promotion sections out of the More sheet while unemployed', async () => {
    usePhoneLayout();
    loadWorld({ employed: false });
    renderApp(routes.game.office());
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'More' }));

    const sheet = screen.getByRole('dialog', { name: 'Menu' });
    expect(within(sheet).getByRole('heading', { name: 'World' })).toBeVisible();
    expect(within(sheet).queryByRole('heading', { name: 'Creative' })).toBeNull();
  });
});

describe('in-game routing', () => {
  it('sends /game/* to the title screen when no world is loaded', async () => {
    const router = renderApp(routes.game.roster());

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Ringside Booker' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Load or start a game first.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(routes.title());
  });

  it('opens the office for /game, leaving focus alone during the start-up redirect', async () => {
    loadWorld({ employed: true });
    const router = renderApp(routes.game.root());

    const heading = await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect(heading).toBeVisible();
    expect(router.state.location.pathname).toBe(routes.game.office());
    expect(heading).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it('shows the not-found screen for an unknown path', async () => {
    renderApp('/game-of-thrones');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the main menu' })).toHaveAttribute(
      'href',
      routes.title(),
    );
  });

  it('moves focus to the new page heading after a navigation, but not on first load', async () => {
    loadWorld({ employed: true });
    renderApp(routes.game.office());
    const user = userEvent.setup();

    const dashboardHeading = await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect(dashboardHeading).not.toHaveFocus();

    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    await user.click(within(sidebar).getByRole('link', { name: 'Roster' }));

    const rosterHeading = await screen.findByRole('heading', { level: 1, name: 'Roster' });
    await waitFor(() => {
      expect(rosterHeading).toHaveFocus();
    });
    expect(document.title).toBe('Roster · Ringside Booker');
  });

  it('keeps focus in place when only the hash changes', async () => {
    loadWorld({ employed: true });
    const router = renderApp(routes.game.office());

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    const skipLink = screen.getByRole('link', { name: 'Skip to content' });
    skipLink.focus();

    await act(async () => {
      await router.navigate(`${routes.game.office()}#section`);
    });

    expect(skipLink).toHaveFocus();
  });
});

function AnnounceButton({ message }: { readonly message: string }) {
  const announce = useAnnounce();
  return (
    <button
      type="button"
      onClick={() => {
        announce(message);
      }}
    >
      Announce
    </button>
  );
}

describe('LiveAnnouncer', () => {
  it('renders a polite and an assertive live region', () => {
    render(
      <LiveAnnouncer>
        <p>Content</p>
      </LiveAnnouncer>,
    );

    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('announces the same message again by clearing the region first', async () => {
    render(
      <LiveAnnouncer>
        <AnnounceButton message="Advanced to Monday" />
      </LiveAnnouncer>,
    );
    const user = userEvent.setup();
    const politeRegion = screen.getByRole('status');

    await user.click(screen.getByRole('button', { name: 'Announce' }));
    await waitFor(() => {
      expect(politeRegion).toHaveTextContent('Advanced to Monday');
    });

    await user.click(screen.getByRole('button', { name: 'Announce' }));
    expect(politeRegion).toHaveTextContent('');
    await waitFor(() => {
      expect(politeRegion).toHaveTextContent('Advanced to Monday');
    });
  });

  it('sends assertive messages to the assertive region', async () => {
    function AssertiveButton() {
      const announce = useAnnounce();
      return (
        <button
          type="button"
          onClick={() => {
            announce('Show day', { politeness: 'assertive' });
          }}
        >
          Alert
        </button>
      );
    }
    render(
      <LiveAnnouncer>
        <AssertiveButton />
      </LiveAnnouncer>,
    );

    await userEvent.setup().click(screen.getByRole('button', { name: 'Alert' }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Show day');
    });
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('throws a clear error without a provider', () => {
    function Orphan() {
      useAnnounce();
      return null;
    }
    const silenceReactError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => render(<Orphan />)).toThrow(/LiveAnnouncer/);
    silenceReactError.mockRestore();
  });
});
