// The worker profile's Form tab (MTCH3-04).
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import type { PersonRole, WorkerProfile } from '@ringside/engine';
import { tinyWorld } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { hasRecentForm, RECENT_FORM_TAB } from './recentFormTab';

/** The lazily loaded profile and tab chunks can take a moment under load. */
const LOAD_MS = 10_000;

function ownWrestler() {
  const id = tinyWorld().ids.people[0];
  if (id === undefined) throw new Error('The tiny world lost its people.');
  return id;
}

async function profileOf(): Promise<WorkerProfile> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  transport.host.installEngine(fakeEngineState());
  const { result } = await transport.host.query('workers.profile', { personId: ownWrestler() });
  if (!result.ok) throw new Error('The engine refused workers.profile.');
  return result.data;
}

function withRoles(profile: WorkerProfile, roles: PersonRole[]): { profile: WorkerProfile } {
  return { profile: { ...profile, header: { ...profile.header, roles } } };
}

beforeEach(() => {
  useSessionStore.getState().clear();
});

describe('the Form tab', () => {
  it('is for wrestlers and occasional wrestlers, not for a referee', async () => {
    const profile = await profileOf();
    expect(RECENT_FORM_TAB).toMatchObject({ id: 'recent-form', label: 'Form', order: 55 });
    expect(hasRecentForm(withRoles(profile, ['wrestler']))).toBe(true);
    expect(hasRecentForm(withRoles(profile, ['occasionalWrestler', 'manager']))).toBe(true);
    expect(hasRecentForm(withRoles(profile, ['referee']))).toBe(false);
  });

  it('shows a wrestler’s last matches from match.recentForm as pills and a list', async () => {
    const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    const install = transport.host.installEngine(fakeEngineState());
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
    const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
      initialEntries: [routes.game.worker(ownWrestler())],
      future: routerFutureFlags,
    });
    render(
      <EngineProvider createTransport={() => transport}>
        <RouterProvider router={router} future={routerProviderFutureFlags} />
      </EngineProvider>,
    );
    const user = userEvent.setup({ delay: null });

    await user.click(await screen.findByRole('tab', { name: 'Form' }, { timeout: LOAD_MS }));

    expect(router.state.location.search).toBe('?tab=recent-form');
    const strip = await screen.findByRole(
      'list',
      { name: 'Recent results, newest first' },
      { timeout: LOAD_MS },
    );
    // The tiny world's one run match: a win over Test Person 002 on Test Weekly.
    expect(within(strip).getByRole('listitem')).toHaveAccessibleName(
      /^Win against Test Person 002, Test Weekly, /,
    );
    const list = screen.getByRole('grid', { name: 'Recent matches, newest first' });
    expect(within(list).getAllByRole('row')).toHaveLength(2);
    expect(within(list).getByRole('link', { name: 'Test Person 002' })).toBeInTheDocument();
  }, 20_000);
});
