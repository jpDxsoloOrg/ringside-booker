import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { diffDays, parseContentKey } from '@ringside/engine';
import type {
  BookingShowRow,
  CommandArgs,
  CommandName,
  MatchOutcome,
  PersonId,
  SegmentDraft,
  SegmentId,
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
import { bookingShowUrl } from './bookingUrl';
import { registerBookingPanel } from './registries/bookingPanels';
import { useSegmentEditor } from './editor/editorStore';

/** The lazily loaded booking chunk and the engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

const SINGLES = parseContentKey('match.singles');
const PINFALL = parseContentKey('method.pinfall');
const WIN: MatchOutcome = { kind: 'win', winningSide: 0, methodKey: PINFALL };

function singles(people: readonly PersonId[], outcome: MatchOutcome | null): SegmentDraft {
  const [first, second] = people;
  if (first === undefined || second === undefined) throw new Error('A singles match needs two.');
  return {
    kind: 'match',
    label: null,
    storylineIds: [],
    crew: { refereeId: null, producerId: null, announcerIds: [] },
    participants: [
      { personId: first, side: 0, role: 'competitor', teamId: null },
      { personId: second, side: 1, role: 'competitor', teamId: null },
    ],
    match: { matchTypeKey: SINGLES, stipulationKeys: [], titleIds: [], finishKey: null },
    outcome,
  };
}

interface Booked {
  readonly transport: InProcessTransport;
  readonly roster: readonly PersonId[];
  readonly show: BookingShowRow;
  readonly opener: SegmentId;
}

async function command<K extends CommandName>(
  transport: InProcessTransport,
  name: K,
  args: CommandArgs<K>,
): Promise<void> {
  const { result } = await transport.host.command(name, args);
  if (!result.ok) throw new Error(`${name} was refused: ${JSON.stringify(result.reasons)}`);
}

/**
 * The booking world a day in, with the player's Thursday show partly booked: the opener with a
 * planned winner, slot 3 with no result yet, the main event open. With `onShowDay`, the clock is
 * then moved to the show's day (the fake engine leaves the show-day gate out).
 */
async function bookedWorld({ onShowDay = false }: { onShowDay?: boolean } = {}): Promise<Booked> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const { state, roster } = bookingFakeState();
  const install = transport.host.installEngine(state);
  // One simulated day lets the daily schedule store the shows.
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const { result } = await transport.host.query('booking.shows', {});
  if (!result.ok) throw new Error('booking.shows was refused.');
  const show = result.data.rows[0];
  if (show === undefined) throw new Error('The booking world has no show.');
  const eventInstanceId = show.eventInstanceId;
  await command(transport, 'booking.addSegment', {
    eventInstanceId,
    preShow: false,
    slot: 0,
    draft: singles(roster.slice(0, 2), WIN),
  });
  await command(transport, 'booking.addSegment', {
    eventInstanceId,
    preShow: false,
    slot: 2,
    draft: singles(roster.slice(2, 4), null),
  });
  const card = await transport.host.query('booking.card', { eventInstanceId });
  if (!card.result.ok) throw new Error('booking.card was refused.');
  const opener = card.result.data.sections.at(-1)?.slots[0]?.segment?.segmentId;
  if (opener === undefined) throw new Error('The opener was not booked.');
  if (onShowDay) {
    const clock = await transport.host.query('clock.get', {});
    if (!clock.result.ok) throw new Error('clock.get was refused.');
    const days = diffDays(clock.result.data.date, show.date);
    if (days > 0) await transport.host.advanceDays({ maxDays: days }, () => undefined);
  }
  return { transport, roster, show, opener };
}

function renderBooking(transport: InProcessTransport, path: string = routes.game.booking()) {
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

/** A slot's row on the card, once the card has loaded. */
async function findSlot(name: string): Promise<HTMLElement> {
  return screen.findByRole('article', { name }, { timeout: LOAD_MS });
}

function mainCard(): HTMLElement {
  const heading = screen.getByRole('heading', { level: 3, name: 'Main card' });
  const section = heading.closest('section');
  if (section === null) throw new Error('The main card has no section.');
  return section;
}

function checklist(): HTMLElement {
  return screen.getByRole('region', { name: 'Checklist' });
}

afterEach(() => {
  useSegmentEditor.getState().close();
  useSessionStore.getState().clear();
  vi.restoreAllMocks();
});

describe('BookingScreen', () => {
  it('opens on the next show to book and puts it in the URL', async () => {
    const { transport, show } = await bookedWorld();
    const { router } = renderBooking(transport);

    await waitFor(
      () => {
        expect(router.state.location.search).toBe(`?event=${show.eventInstanceId}`);
      },
      { timeout: LOAD_MS },
    );
    await findSlot('Slot 1: Opener');
    expect(screen.getByRole('heading', { level: 2, name: 'Test Weekly' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Booking' })).toBeInTheDocument();
    expect(screen.getByText('In 5 days')).toBeInTheDocument();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Show' })).toHaveTextContent(
      'Thu 16 Apr · Test Weekly · 2/6',
    );
    expect(screen.getByRole('link', { name: 'Open in calendar' })).toHaveAttribute(
      'href',
      routes.game.calendarAt({ month: '2026-04', show: show.eventInstanceId }),
    );
  });

  it('shows every slot by role, the open slots with add actions, and the winner', async () => {
    const { transport, show } = await bookedWorld();
    renderBooking(transport, bookingShowUrl(show.eventInstanceId));

    const opener = await findSlot('Slot 1: Opener');
    const roles = [
      'Slot 1: Opener',
      'Slot 2: Midcard',
      'Slot 3: Midcard',
      'Slot 4: Midcard',
      'Slot 5: Semi-main',
      'Slot 6: Main event',
    ];
    const slots = within(mainCard()).getAllByRole('article');
    expect(slots).toHaveLength(roles.length);
    roles.forEach((name, index) => {
      expect(slots[index]).toBe(within(mainCard()).getByRole('article', { name }));
    });
    expect(screen.getByRole('article', { name: 'Slot 1: Pre-show' })).toBeInTheDocument();
    expect(within(opener).getByText('Winner')).toBeInTheDocument();

    const open = screen.getByRole('article', { name: 'Slot 2: Midcard' });
    expect(within(open).getByRole('button', { name: 'Add match' })).toBeInTheDocument();
    await userEvent
      .setup()
      .click(within(open).getByRole('button', { name: 'Add talking segment' }));
    expect(useSegmentEditor.getState().request).toEqual({
      mode: 'new',
      eventInstanceId: show.eventInstanceId,
      preShow: false,
      slot: 1,
      kind: 'angle',
    });
    expect(await screen.findByRole('dialog', { name: 'Slot 2 · Midcard' })).toBeInTheDocument();

    // A card is slots, never minutes.
    expect(document.body.textContent).not.toMatch(RUNNING_TIME_WORDS);
  });

  it('has no Lock card: before show day the card stays editable and nothing runs it', async () => {
    const { transport, show } = await bookedWorld();
    renderBooking(transport, bookingShowUrl(show.eventInstanceId));

    await findSlot('Slot 1: Opener');
    await within(checklist()).findByText('3 problems');
    expect(screen.queryByRole('button', { name: /lock/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Run the show' })).toBeNull();
    expect(screen.queryByText(/to run the show$/)).toBeNull();
    expect(screen.getByText('Scheduled')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actions for slot 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear card' })).toBeInTheDocument();
  });

  it('on show night, keeps Run the show off until the card can run, then runs it and opens the results', async () => {
    const { transport, roster, show, opener } = await bookedWorld({ onShowDay: true });
    const { user, router } = renderBooking(transport, bookingShowUrl(show.eventInstanceId));

    await findSlot('Slot 1: Opener');
    await within(checklist()).findByText('Main card filled (2 of 6, needs 3)');
    expect(within(checklist()).getByText('Every match has a result')).toBeInTheDocument();
    expect(within(checklist()).getByText('3 problems')).toBeInTheDocument();
    expect(screen.getByText('Tonight')).toBeInTheDocument();
    const run = screen.getByRole('button', { name: 'Run the show' });
    expect(run).toBeDisabled();
    expect(run).toHaveAccessibleDescription('Fix 3 problems to run the show');
    expect(
      within(screen.getByRole('article', { name: 'Slot 3: Midcard' })).getByText('1 problem'),
    ).toBeInTheDocument();

    // Book the main event behind the screen's back, then plan slot 3's winner from its menu.
    await command(transport, 'booking.addSegment', {
      eventInstanceId: show.eventInstanceId,
      preShow: false,
      slot: 5,
      draft: singles(roster.slice(4, 6), WIN),
    });
    act(() => {
      screen.getByRole('button', { name: 'Actions for slot 3' }).focus();
    });
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: 'Winner' });
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowRight}');
    await user.click(await screen.findByRole('menuitem', { name: /^Side 2:/ }));

    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: 'Run the show' })).toBeEnabled();
      },
      { timeout: LOAD_MS },
    );

    // A refusal (the card changed elsewhere) lists the game's reasons, each jumping to its slot.
    const realCommand = transport.host.command.bind(transport.host);
    const spy = vi.spyOn(transport.host, 'command').mockImplementationOnce(async (name, args) => {
      if (name !== 'shows.runTonight') return realCommand(name, args);
      return {
        revision: 0,
        result: {
          ok: false,
          reasons: [
            {
              code: 'cardNotRunnable',
              message:
                'Opener: no result planned; pick a winner, Auto, Random, a draw or a no contest',
              subject: { kind: 'segment', id: opener },
            },
          ],
        },
      };
    });
    await user.click(screen.getByRole('button', { name: 'Run the show' }));
    await user.click(
      await screen.findByRole('button', {
        name: 'Opener: no result planned; pick a winner, Auto, Random, a draw or a no contest',
      }),
    );
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('booking-slot-main-0');
    });

    // The show runs, and the results page opens with the reveal.
    spy.mockRestore();
    await user.click(screen.getByRole('button', { name: 'Run the show' }));
    await waitFor(
      () => {
        expect(router.state.location.pathname).toBe(routes.game.showResults(show.eventInstanceId));
      },
      { timeout: LOAD_MS },
    );
    expect(router.state.location.search).toBe('?reveal=1');
  });

  it('moves a segment down with booking.moveSegment', async () => {
    const { transport, show, opener } = await bookedWorld();
    const spy = vi.spyOn(transport.host, 'command');
    const { user } = renderBooking(transport, bookingShowUrl(show.eventInstanceId));

    await findSlot('Slot 1: Opener');
    await user.click(screen.getByRole('button', { name: 'Actions for slot 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }));

    expect(spy).toHaveBeenCalledWith('booking.moveSegment', {
      segmentId: opener,
      toPreShow: false,
      toSlot: 1,
    });
    await waitFor(() => {
      expect(screen.getByRole('article', { name: 'Slot 1: Opener' })).toHaveAttribute(
        'data-state',
        'empty',
      );
    });
    expect(screen.getByRole('article', { name: 'Slot 2: Midcard' })).toHaveAttribute(
      'data-state',
      'booked',
    );
  });

  it('shows a refused move as it happens, then puts the order back with the reason', async () => {
    const { transport, show } = await bookedWorld();
    let refuse: () => void = () => undefined;
    const realCommand = transport.host.command.bind(transport.host);
    vi.spyOn(transport.host, 'command').mockImplementation((name, args) => {
      if (name !== 'booking.moveSegment') return realCommand(name, args);
      return new Promise((resolve) => {
        refuse = () => {
          resolve({
            revision: 0,
            result: {
              ok: false,
              reasons: [{ code: 'showPast', message: 'This show has already happened' }],
            },
          });
        };
      });
    });
    const { user } = renderBooking(transport, bookingShowUrl(show.eventInstanceId));

    await findSlot('Slot 1: Opener');
    await user.click(screen.getByRole('button', { name: 'Actions for slot 1' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move down' }));

    // Until the game answers, the card shows the move.
    expect(screen.getByRole('article', { name: 'Slot 1: Opener' })).toHaveAttribute(
      'data-state',
      'empty',
    );
    act(() => {
      refuse();
    });

    expect(await screen.findByText('This show has already happened')).toBeInTheDocument();
    expect(screen.getByText("That change didn't go through")).toBeInTheDocument();
    expect(screen.getByRole('article', { name: 'Slot 1: Opener' })).toHaveAttribute(
      'data-state',
      'booked',
    );
    expect(screen.getByRole('article', { name: 'Slot 2: Midcard' })).toHaveAttribute(
      'data-state',
      'empty',
    );
  });

  it('takes a problem in the checklist to its slot', async () => {
    const { transport, show } = await bookedWorld();
    const { user } = renderBooking(transport, bookingShowUrl(show.eventInstanceId));

    await findSlot('Slot 1: Opener');
    await within(checklist()).findByText('3 problems');
    await user.click(within(checklist()).getByRole('button', { name: /^Slot 3/ }));

    await waitFor(() => {
      expect(document.activeElement?.id).toBe('booking-slot-main-2');
    });
  });

  it('collapses the checklist into a sticky bar on a phone', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const { transport, show } = await bookedWorld();
    const { user } = renderBooking(transport, bookingShowUrl(show.eventInstanceId));

    await findSlot('Slot 1: Opener');
    expect(screen.queryByRole('region', { name: 'Checklist' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move slot 1' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Move slot 1 down' })).toBeInTheDocument();
    expect(screen.queryByText('Forecast: steady')).toBeNull();
    await user.click(await screen.findByRole('button', { name: '3 problems' }));
    const sheet = await screen.findByRole('dialog', { name: '3 problems' });
    expect(within(sheet).getByText('Every match has a result')).toBeInTheDocument();
  });

  it('draws registered panels beside and under the card, and their phone summaries', async () => {
    const removeSide = registerBookingPanel({
      id: 'test.forecast',
      order: 10,
      placement: 'side',
      title: 'Test forecast',
      render: ({ card }) => <p>Forecast for {card.show.name}</p>,
      phoneSummary: () => 'Forecast: steady',
    });
    const removeBelow = registerBookingPanel({
      id: 'test.venue',
      order: 10,
      placement: 'below',
      render: ({ validation }) => <p>Venue panel {validation === null ? 'waiting' : 'checked'}</p>,
    });
    try {
      const { transport, show } = await bookedWorld();
      renderBooking(transport, bookingShowUrl(show.eventInstanceId));

      await findSlot('Slot 1: Opener');
      const side = screen.getByRole('region', { name: 'Test forecast' });
      expect(within(side).getByText('Forecast for Test Weekly')).toBeInTheDocument();
      expect(screen.getByRole('complementary', { name: 'Checks and panels' })).toContainElement(
        side,
      );
      expect(await screen.findByText('Venue panel checked')).toBeInTheDocument();
    } finally {
      removeSide();
      removeBelow();
    }
  });

  it('says so when the seat runs no promotion', async () => {
    const { transport } = await bookedWorld();
    const { seat } = useSessionStore.getState();
    if (seat === null) throw new Error('No seat was loaded.');
    useSessionStore
      .getState()
      .setLoaded({ saveSlotId: null, seat: { ...seat, promotionId: null } });
    renderBooking(transport);

    expect(
      await screen.findByText("You don't run a promotion", {}, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run the show' })).toBeNull();
  });
});
