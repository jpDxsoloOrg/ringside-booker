/**
 * The show night screen (EVT10-02) in the real route tree, against the test engine in process: the
 * booking world on the day of the player's Thursday show, its card full of singles matches with
 * planned winners, on the Live setting.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { diffDays, parseContentKey } from '@ringside/engine';
import type {
  BookingShowRow,
  CommandArgs,
  CommandName,
  EventInstanceId,
  PersonId,
} from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { bookingFakeState, fakeEngineFactory } from '@/test/fakeEngine';
import { setMatchMedia } from '@/test/matchMedia';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { resetSettingsForTest } from '@/test/settings';

/** The lazily loaded screen and the engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

afterEach(() => {
  setMatchMedia(() => false);
  resetSettingsForTest();
  useSessionStore.getState().clear();
});

async function command<K extends CommandName>(
  transport: InProcessTransport,
  name: K,
  args: CommandArgs<K>,
): Promise<void> {
  const { result } = await transport.host.command(name, args);
  if (!result.ok) throw new Error(`${name} was refused: ${JSON.stringify(result.reasons)}`);
}

interface ShowWorld {
  readonly transport: InProcessTransport;
  readonly show: BookingShowRow;
}

/**
 * The booking world on the show's day. `matches` singles fill the main card from slot 1, each with
 * a planned winner (the show needs three); `unplanned` leaves the last one without a result.
 */
async function showNightWorld({
  matches = 3,
  unplanned = false,
}: { matches?: number; unplanned?: boolean } = {}): Promise<ShowWorld> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const { state, roster } = bookingFakeState();
  const install = transport.host.installEngine(state);
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  const shows = await transport.host.query('booking.shows', {});
  if (!shows.result.ok) throw new Error('booking.shows was refused.');
  const show = shows.result.data.rows[0];
  if (show === undefined) throw new Error('The booking world has no show.');
  // Slots 1, 2 and the main event (slot 6), so the card can run.
  const slots = [0, 1, 5, 2, 3, 4].slice(0, matches);
  for (const [index, slot] of slots.entries()) {
    const first: PersonId | undefined = roster[index * 2];
    const second: PersonId | undefined = roster[index * 2 + 1];
    if (first === undefined || second === undefined) throw new Error('The roster is too small.');
    const last = index === slots.length - 1;
    await command(transport, 'booking.addSegment', {
      eventInstanceId: show.eventInstanceId,
      preShow: false,
      slot,
      draft: {
        kind: 'match',
        label: null,
        storylineIds: [],
        crew: { refereeId: null, producerId: null, announcerIds: [] },
        participants: [
          { personId: first, side: 0, role: 'competitor', teamId: null },
          { personId: second, side: 1, role: 'competitor', teamId: null },
        ],
        match: {
          matchTypeKey: parseContentKey('match.singles'),
          stipulationKeys: [],
          titleIds: [],
          finishKey: null,
        },
        outcome:
          unplanned && last
            ? null
            : { kind: 'win', winningSide: 0, methodKey: parseContentKey('method.pinfall') },
      },
    });
  }
  await command(transport, 'shows.setShowNight', { mode: 'live' });
  const clock = await transport.host.query('clock.get', {});
  if (!clock.result.ok) throw new Error('clock.get was refused.');
  const days = diffDays(clock.result.data.date, show.date);
  if (days > 0) await transport.host.advanceDays({ maxDays: days }, () => undefined);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  return { transport, show };
}

function renderShowNight(transport: InProcessTransport, eventInstanceId: EventInstanceId) {
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [routes.game.showNight(eventInstanceId)],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { router, user: userEvent.setup({ delay: null }) };
}

function runningOrder(): HTMLElement {
  return screen.getByRole('list', { name: 'Running order' });
}

async function findRunNext(): Promise<HTMLElement> {
  const button = await screen.findByRole(
    'button',
    { name: 'Run next segment' },
    { timeout: LOAD_MS },
  );
  await waitFor(
    () => {
      expect(button).toBeEnabled();
    },
    { timeout: LOAD_MS },
  );
  return button;
}

function liveRegion(): HTMLElement {
  const region = document.querySelector('main [aria-live="polite"]');
  if (!(region instanceof HTMLElement)) throw new Error('No live region.');
  return region;
}

describe('ShowNightScreen', () => {
  it('opens ready to go live with the card still to come, then runs one segment and reports it', async () => {
    const { transport, show } = await showNightWorld();
    const { user } = renderShowNight(transport, show.eventInstanceId);

    const runNext = await findRunNext();
    expect(screen.getByRole('heading', { name: 'Ready to go live' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: show.name })).toBeInTheDocument();
    expect(within(runningOrder()).getAllByText('Up next')).toHaveLength(1);
    expect(within(runningOrder()).getAllByText('Still to come')).toHaveLength(2);
    expect(
      within(screen.getByRole('group', { name: 'Show so far' })).getByText('0/3'),
    ).toBeVisible();
    expect(runNext).toHaveAccessibleDescription(/^Up next Slot 1: Opener · Singles: /);

    await user.click(runNext);

    const report = await screen.findByRole('region', { name: /^Just now/ }, { timeout: LOAD_MS });
    expect(within(report).getByRole('article')).toBeInTheDocument();
    expect(within(report).getByText('Segment score')).toBeInTheDocument();
    expect(within(report).getByText(/def\./)).toBeInTheDocument();
    await waitFor(() => {
      expect(within(runningOrder()).getAllByText('Done')).toHaveLength(1);
    });
    expect(within(runningOrder()).getByRole('button', { name: /^Slot 1: Opener/ })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(
      within(screen.getByRole('group', { name: 'Show so far' })).getByText('1/3'),
    ).toBeVisible();
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(/^Opener: .+ wins by Pinfall\. .+, score \d+$/);
    });
    expect(screen.getByRole('main').textContent).not.toMatch(RUNNING_TIME_WORDS);
  });

  it('runs the next segment on Enter', async () => {
    const { transport, show } = await showNightWorld();
    const { user } = renderShowNight(transport, show.eventInstanceId);
    await findRunNext();

    act(() => {
      screen.getByRole('heading', { level: 1 }).focus();
    });
    await user.keyboard('{Enter}');
    await waitFor(
      () => {
        expect(within(runningOrder()).getAllByText('Done')).toHaveLength(1);
      },
      { timeout: LOAD_MS },
    );
  });

  it('sims the rest of the show, says it is over with the final score, then opens the results', async () => {
    const { transport, show } = await showNightWorld();
    const { user, router } = renderShowNight(transport, show.eventInstanceId);
    await findRunNext();

    await user.click(screen.getByRole('button', { name: 'Sim the rest of the show' }));

    const over = await screen.findByRole('region', { name: "Show's over" }, { timeout: LOAD_MS });
    expect(within(over).getByText('Final score')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Final score' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run next segment' })).toBeNull();
    expect(within(runningOrder()).getAllByText('Done')).toHaveLength(3);
    // The main event's report stays under the panel.
    expect(screen.getByRole('region', { name: /^Report/ })).toHaveTextContent('Main event');
    await waitFor(() => {
      expect(liveRegion()).toHaveTextContent(/^Show's over\. Final score \d+/);
    });

    await user.click(within(over).getByRole('button', { name: 'See the results' }));
    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe(routes.game.showResults(show.eventInstanceId));
      },
      { timeout: LOAD_MS },
    );
    // Simmed segments were never seen one by one, so the results play them in.
    expect(router.state.location.search).toBe('?reveal=1');
  });

  it('leaves to the office, and coming back resumes at the next segment', async () => {
    const { transport, show } = await showNightWorld();
    const { user, router } = renderShowNight(transport, show.eventInstanceId);
    await user.click(await findRunNext());
    await screen.findByRole('region', { name: /^Just now/ }, { timeout: LOAD_MS });

    await user.click(screen.getByRole('button', { name: 'Leave and finish later' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe(routes.game.office());
    });

    await act(async () => {
      await router.navigate(routes.game.showNight(show.eventInstanceId));
    });
    await findRunNext();
    expect(within(runningOrder()).getAllByText('Done')).toHaveLength(1);
    expect(within(runningOrder()).getByText('Up next').closest('li')).toHaveTextContent(
      'Slot 2: Midcard',
    );
    expect(screen.getByRole('region', { name: /^Just now/ })).toHaveTextContent('Slot 1: Opener');
    expect(screen.queryByRole('heading', { name: 'Ready to go live' })).toBeNull();
  });

  it('brings back an earlier report from the running order', async () => {
    const { transport, show } = await showNightWorld();
    const { user } = renderShowNight(transport, show.eventInstanceId);
    await user.click(await findRunNext());
    await waitFor(() => {
      expect(within(runningOrder()).getAllByText('Done')).toHaveLength(1);
    });
    await user.click(await findRunNext());
    await waitFor(() => {
      expect(within(runningOrder()).getAllByText('Done')).toHaveLength(2);
    });

    await user.click(within(runningOrder()).getByRole('button', { name: /^Slot 1: Opener/ }));

    expect(screen.getByRole('region', { name: /^Report/ })).toHaveTextContent('Slot 1: Opener');
  });

  it('keeps the show from starting while the card has problems, and points to the card', async () => {
    const { transport, show } = await showNightWorld({ unplanned: true });
    const { user, router } = renderShowNight(transport, show.eventInstanceId);

    const fix = await screen.findByRole('button', { name: 'Fix the card' }, { timeout: LOAD_MS });
    expect(screen.getByRole('heading', { name: /^Fix 1 problem to run the show$/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Run next segment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sim the rest of the show' })).toBeDisabled();

    await user.click(fix);
    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe(routes.game.booking());
      },
      { timeout: LOAD_MS },
    );
  });

  it('on a phone, folds the running order into a strip that opens', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const { transport, show } = await showNightWorld();
    const { user } = renderShowNight(transport, show.eventInstanceId);
    await findRunNext();

    const strip = screen.getByRole('button', { name: /^Running order/ });
    expect(strip).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Running order' })).toBeNull();
    await user.click(strip);
    expect(strip).toHaveAttribute('aria-expanded', 'true');
    expect(within(runningOrder()).getAllByRole('listitem')).toHaveLength(3);
  });

  it('fades each new report in', async () => {
    const first = await showNightWorld();
    const view = renderShowNight(first.transport, first.show.eventInstanceId);
    await view.user.click(await findRunNext());
    const report = await screen.findByRole('region', { name: /^Just now/ }, { timeout: LOAD_MS });
    expect(report.querySelector('[data-animated]')).toHaveAttribute('data-animated', 'true');
  });

  it('shows each report at once with reduced motion', async () => {
    setMatchMedia((query) => query.includes('prefers-reduced-motion'));
    const { transport, show } = await showNightWorld();
    const { user } = renderShowNight(transport, show.eventInstanceId);
    await user.click(await findRunNext());
    const report = await screen.findByRole('region', { name: /^Just now/ }, { timeout: LOAD_MS });
    expect(report.querySelector('[data-animated]')).toHaveAttribute('data-animated', 'false');
  });
});
