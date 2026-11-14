// ECO5-09: the worker profile's contract action opens the Negotiation Sheet over the profile.
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NegotiationId, PersonId } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { workersListUrlFrom } from '@/app/entityLinks';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';

/** The lazily loaded profile and sheet and the engine's first answers can take a while under load. */
const LOAD_MS = 10_000;

/** A filtered, sorted Workers list the profile was opened from. */
const LIST_URL = `${routes.game.workers()}?gender=male&sort=age:asc`;

/** The tiny world's free agent (its last person), in countered talks with the player. */
function freeAgent(): { personId: PersonId; negotiationId: NegotiationId } {
  const { world, ids } = tinyWorld();
  const personId = ids.people.at(-1);
  const talks = [...world.tables.negotiations.values()].find(
    (negotiation) => negotiation.personId === personId,
  );
  if (personId === undefined || talks === undefined) {
    throw new Error('The tiny world lost its free agent or their talks.');
  }
  return { personId, negotiationId: talks.id };
}

function renderProfile(search = '') {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [
      {
        pathname: routes.game.worker(freeAgent().personId),
        search,
        state: { workersListUrl: LIST_URL },
      },
    ],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { router, user: userEvent.setup({ delay: null }) };
}

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

describe('contract talks over the worker profile (ECO5-09)', () => {
  it('opens the talks over the profile, closes back to it, and Back still returns to the filtered list', async () => {
    const { router, user } = renderProfile();
    const { personId, negotiationId } = freeAgent();
    await user.click(
      await screen.findByRole('button', { name: 'Open talks' }, { timeout: LOAD_MS }),
    );

    await waitFor(() => {
      expect(router.state.location.search).toContain(`negotiation=${negotiationId}`);
    });
    // Still the profile, with the way back to the Workers list kept.
    expect(router.state.location.pathname).toBe(routes.game.worker(personId));
    expect(workersListUrlFrom(router.state.location.state)).toBe(LIST_URL);
    // The sheet swaps its loading state for the talks, so look the dialog up once they are in.
    expect(
      await screen.findByRole('button', { name: 'Accept counter' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(router.state.location.search).not.toContain('negotiation=');
    });
    expect(router.state.location.pathname).toBe(routes.game.worker(personId));
    expect(screen.getByRole('link', { name: 'Back to Workers' })).toHaveAttribute('href', LIST_URL);
  }, 30_000);

  it('keeps the talks open over the profile on a reload of its address', async () => {
    const { negotiationId } = freeAgent();
    renderProfile(`?negotiation=${negotiationId}`);
    expect(
      await screen.findByRole('button', { name: 'Accept counter' }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Under the open sheet the profile is hidden from assistive tech, but its Back link is kept.
    expect(screen.getByRole('link', { name: 'Back to Workers', hidden: true })).toHaveAttribute(
      'href',
      LIST_URL,
    );
  }, 30_000);
});
