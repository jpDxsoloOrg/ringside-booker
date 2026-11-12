/**
 * What the results page adds to the calendar, checked in the real calendar against the tiny world:
 * its show `evi_0000000001` ran last Thursday and scored 62.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import type { CalendarShow } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { fakeEngineFactory, fakeEngineState } from '@/test/fakeEngine';
import { completedShowId, RESULT_SECTION, RESULTS_ACTION, SCORE_BADGE } from './calendarHooks';

const SHOW = parseId('eventInstance', 'evi_0000000001');
const LOAD_MS = 10_000;

afterEach(() => {
  useSessionStore.getState().clear();
});

function renderCalendarOn(path: string) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(fakeEngineState());
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
  return { router, user: userEvent.setup() };
}

function row(overrides: Partial<CalendarShow>): CalendarShow {
  return {
    key: SHOW,
    eventInstanceId: SHOW,
    definitionId: null,
    promotion: {
      id: parseId('promotion', 'pro_0000000001'),
      name: 'Test Promotion A',
      shortName: 'TPA',
      color: '#fff',
    },
    isOwn: true,
    brand: null,
    name: 'Test Weekly',
    importance: 'regular',
    format: { slots: 6, preShowSlots: 1 },
    televised: null,
    date: parseGameDate('2026-04-09'),
    airDate: parseGameDate('2026-04-09'),
    status: 'completed',
    cancellation: null,
    region: {
      id: parseId('region', 'reg_0000000001'),
      name: 'Test Region',
      countryName: 'Test Country',
    },
    venue: null,
    segmentCount: 4,
    canCancel: false,
    score: 62,
    ...overrides,
  };
}

describe('the results calendar hooks', () => {
  it('shows the score and a Results button in a completed show’s sheet', async () => {
    const { router, user } = renderCalendarOn(
      routes.game.calendarAt({ month: '2026-04', show: SHOW }),
    );
    const sheet = await screen.findByRole('dialog', { name: 'Test Weekly' }, { timeout: LOAD_MS });
    const result = await within(sheet).findByRole(
      'region',
      { name: 'Result' },
      { timeout: LOAD_MS },
    );
    expect(result).toHaveTextContent('Score');
    expect(result).toHaveTextContent('62');
    await waitFor(() => {
      expect(within(result).getByRole('img', { name: /out of 5|No stars/ })).toBeInTheDocument();
    });

    await user.click(within(sheet).getByRole('button', { name: 'Results' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(routes.game.showResults(SHOW));
    });
  });

  it('leaves everything out for a show that has not run, and keeps "Not run" for a cancelled one', () => {
    for (const status of ['scheduled', 'booked', 'cancelled', 'projected'] as const) {
      const show = row({ status, score: null });
      const context = { show, isOwn: true, today: parseGameDate('2026-04-10') };
      expect(completedShowId(show)).toBeNull();
      expect(RESULT_SECTION.render(context)).toBeNull();
      expect(RESULTS_ACTION.render(context)).toBeNull();
      expect(SCORE_BADGE.render({ show })).toBeNull();
    }
  });

  it('badges a completed chip with its score', () => {
    render(<p>{SCORE_BADGE.render({ show: row({}) })}</p>);
    expect(screen.getByText('62')).toBeInTheDocument();
    expect(screen.getByText('Score', { exact: false })).toBeInTheDocument();
  });
});
