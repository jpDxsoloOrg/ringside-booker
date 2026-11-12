import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDays, initialEngineState, parseGameDate } from '@ringside/engine';
import type { CalendarShow, EngineState, GameDate } from '@ringside/engine';
import { TEST_PLAYER_ID, worldBuilder } from '@ringside/engine/testing';
import { devSeat } from '@/app/dev/EnterShellRoute';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { Badge } from '@/components/Badge';
import { useTracePanelStore } from '@/components/Trace';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { fakeEngineFactory } from '@/test/fakeEngine';
import { setMatchMedia } from '@/test/matchMedia';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import {
  registerCalendarDayMarkers,
  registerCalendarToolbarItem,
  registerShowChipBadge,
  registerShowSheetAction,
} from './registry';

/** The lazily loaded calendar chunk and the engine's first answers can take a moment under load. */
const CALENDAR_LOAD_MS = 10_000;

const THURSDAY = 3;
const SATURDAY = 5;

/** A Friday. The test simulates it, so the screen opens on Saturday 11 April 2026. */
const WORLD_DATE = parseGameDate('2026-04-10');
const TODAY = addDays(WORLD_DATE, 1);
/** The last day shows are stored for: 90 days after today. */
const HORIZON_END = addDays(TODAY, 90);

/**
 * A small world for the calendar: Test Promotion A, run by the local player, with a Thursday
 * show ("Test Weekly", six main slots and a pre-show) on Test Brand A, and the computer's Test
 * Promotion B with a Saturday show.
 */
function calendarWorldState(): EngineState {
  const { world } = worldBuilder({
    worldName: 'Test Calendar World',
    startDate: parseGameDate('2026-01-05'),
    currentDate: WORLD_DATE,
  })
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Test Promotion A',
        shortName: 'TPA',
        controller: { kind: 'human', playerId: TEST_PLAYER_ID },
      },
      (promotion) =>
        promotion
          .withBrand({ name: 'Test Brand A' })
          .withWeeklyShow(
            { name: 'Test Weekly', weekdays: [THURSDAY] },
            { format: { slots: 6, preShowSlots: 1 } },
          ),
    )
    .withPromotion({ name: 'Test Promotion B', shortName: 'TPB' }, (promotion) =>
      promotion.withWeeklyShow({ name: 'Test Rival Weekly', weekdays: [SATURDAY] }),
    )
    .build();
  return initialEngineState(world);
}

interface RenderOptions {
  /** False renders the shell with a faked seat and no world behind it. */
  readonly loadWorld?: boolean;
  /** False makes the seat one that runs no promotion. */
  readonly hasPromotion?: boolean;
}

async function renderCalendar(
  path: string = routes.game.calendar(),
  { loadWorld = true, hasPromotion = true }: RenderOptions = {},
) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  if (loadWorld) {
    const install = transport.host.installEngine(calendarWorldState());
    // One simulated day lets the daily schedule fill the stored horizon.
    await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
    useSessionStore.getState().setLoaded({
      saveSlotId: null,
      seat: hasPromotion ? install.seat : { ...install.seat, promotionId: null },
    });
  } else {
    useSessionStore.getState().setLoaded({ saveSlotId: null, seat: devSeat(null) });
  }
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [path],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { router, transport, user: userEvent.setup() };
}

/** The day's cell on the month grid, once the calendar has loaded. */
async function findDay(name: RegExp): Promise<HTMLElement> {
  return screen.findByRole('gridcell', { name }, { timeout: CALENDAR_LOAD_MS });
}

/** A chip on a day, once the month's shows have arrived. */
async function findChip(day: HTMLElement, name: RegExp): Promise<HTMLElement> {
  return within(day).findByRole('button', { name }, { timeout: CALENDAR_LOAD_MS });
}

/** The stored shows of one date, straight from the engine. */
async function storedShowsOn(
  transport: InProcessTransport,
  date: GameDate,
): Promise<CalendarShow[]> {
  const { result } = await transport.host.query('calendar.range', {
    from: date,
    to: date,
    scope: 'world',
  });
  if (!result.ok) throw new Error('The calendar range query was refused.');
  return result.data.shows;
}

function fact(sheet: HTMLElement, term: string): HTMLElement {
  const value = within(sheet).getByText(term, { selector: 'dt' }).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`The fact "${term}" has no value.`);
  return value;
}

const cleanups: (() => void)[] = [];

beforeEach(() => {
  useSessionStore.getState().clear();
  useTracePanelStore.setState({ openPanelId: null });
});

afterEach(() => {
  // The calendar is still mounted here and re-renders when a slot loses a definition.
  act(() => {
    for (const unregister of cleanups.splice(0)) unregister();
  });
});

describe('CalendarScreen', () => {
  it('opens on the month of the game’s date with the screen’s heading and title', async () => {
    await renderCalendar();
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    await findDay(/^Saturday, April 11, 2026, today/);

    expect(screen.getByRole('heading', { level: 2, name: 'April 2026' })).toBeInTheDocument();
    expect(screen.getByRole('grid', { name: 'April 2026' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(document.title).toBe('Calendar · Ringside Booker');
    expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled();
    expect(screen.getByText('Dashed = projected')).toBeInTheDocument();
    for (const label of ['House show', 'Minor', 'Regular', 'Major', 'Flagship']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('keeps Calendar highlighted in the sidebar', async () => {
    await renderCalendar();
    await findDay(/^Saturday, April 11, 2026/);
    const sidebar = screen.getByRole('navigation', { name: 'Main' });
    expect(within(sidebar).getByRole('link', { name: 'Calendar' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('puts the weekly show’s chips on Thursdays, tagged with its brand', async () => {
    await renderCalendar();
    for (const thursday of [/^Thursday, April 16, 2026/, /^Thursday, April 23, 2026/]) {
      const chip = await findChip(await findDay(thursday), /Test Weekly/);
      expect(chip).toHaveAttribute('data-status', 'scheduled');
      expect(chip).toHaveAttribute('data-own', 'true');
      expect(chip).toHaveTextContent('Test Brand A');
    }
    // Before the simulated day the horizon held nothing, so earlier Thursdays have no show.
    expect(
      within(await findDay(/^Thursday, April 9, 2026/)).queryByRole('button'),
    ).not.toBeInTheDocument();
    expect(
      within(await findDay(/^Wednesday, April 15, 2026/)).queryByRole('button'),
    ).not.toBeInTheDocument();
  });

  it('hides the other promotion’s shows in My shows and lists them in Whole world', async () => {
    const { router, user } = await renderCalendar();
    await findChip(await findDay(/^Thursday, April 16, 2026/), /Test Weekly/);

    const scope = screen.getByRole('group', { name: 'Show' });
    expect(within(scope).getByRole('radio', { name: 'My shows' })).toBeChecked();
    expect(screen.queryByRole('button', { name: /Test Rival Weekly/ })).not.toBeInTheDocument();

    await user.click(within(scope).getByRole('radio', { name: 'Whole world' }));
    expect(router.state.location.search).toBe('?scope=world');
    const rival = await findChip(await findDay(/^Saturday, April 18, 2026/), /Test Rival Weekly/);
    expect(rival).toHaveAttribute('data-own', 'false');
    expect(rival).toHaveTextContent('TPB');
    // In the whole world the player's own chips are tagged with their promotion too.
    expect(
      await findChip(await findDay(/^Thursday, April 16, 2026/), /Test Weekly/),
    ).toHaveTextContent('TPA');

    await user.click(within(scope).getByRole('radio', { name: 'My shows' }));
    expect(router.state.location.search).toBe('');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Test Rival Weekly/ })).not.toBeInTheDocument();
    });
  });

  it('moves between months and keeps the month in the URL', async () => {
    const { router, user } = await renderCalendar();
    await findDay(/^Saturday, April 11, 2026/);

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(router.state.location.search).toBe('?month=2026-05');
    expect(screen.getByRole('heading', { level: 2, name: 'May 2026' })).toBeInTheDocument();
    await findChip(await findDay(/^Thursday, May 7, 2026/), /Test Weekly/);

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(router.state.location.search).toBe('?month=2026-03');
    expect(screen.getByRole('heading', { level: 2, name: 'March 2026' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(router.state.location.search).toBe('');
    expect(screen.getByRole('heading', { level: 2, name: 'April 2026' })).toBeInTheDocument();
  });

  it('draws projected chips, dashed, past the stored horizon', async () => {
    const { user } = await renderCalendar(routes.game.calendarAt({ month: '2026-06' }));
    await findDay(/^Monday, June 1, 2026/);
    await user.click(screen.getByRole('button', { name: 'Next month' }));

    // Stored through Friday 10 July; the Thursdays after it are only projected.
    expect(HORIZON_END).toBe('2026-07-10');
    const stored = await findChip(await findDay(/^Thursday, July 9, 2026/), /Test Weekly/);
    expect(stored).toHaveAttribute('data-status', 'scheduled');
    for (const thursday of [/^Thursday, July 16, 2026/, /^Thursday, July 30, 2026/]) {
      const projected = await findChip(await findDay(thursday), /Test Weekly/);
      expect(projected).toHaveAttribute('data-status', 'projected');
      expect(projected).toHaveAccessibleName(expect.stringContaining('Projected'));
    }
  });

  it('opens a projected show’s sheet without touching the URL', async () => {
    const { router, user } = await renderCalendar(routes.game.calendarAt({ month: '2026-08' }));
    await user.click(await findChip(await findDay(/^Thursday, August 6, 2026/), /Test Weekly/));

    const sheet = await screen.findByRole('dialog', { name: 'Test Weekly' });
    expect(fact(sheet, 'Status')).toHaveTextContent('Projected: not on the schedule yet');
    expect(within(sheet).queryByRole('button', { name: 'Cancel show' })).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?month=2026-08');

    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Test Weekly' })).not.toBeInTheDocument();
    });
  });

  it('opens a show’s sheet from its chip, puts the show in the URL and lists its facts', async () => {
    const { router, transport, user } = await renderCalendar();
    const chip = await findChip(await findDay(/^Thursday, April 16, 2026/), /Test Weekly/);
    const [show] = await storedShowsOn(transport, parseGameDate('2026-04-16'));
    await user.click(chip);

    expect(router.state.location.search).toBe(`?show=${show?.eventInstanceId ?? ''}`);
    const sheet = await screen.findByRole('dialog', { name: 'Test Weekly' });
    expect(fact(sheet, 'Date')).toHaveTextContent('Thursday, April 16, 2026');
    expect(fact(sheet, 'Brand')).toHaveTextContent('Test Brand A');
    expect(fact(sheet, 'Importance')).toHaveTextContent('Regular');
    expect(fact(sheet, 'Card')).toHaveTextContent('6 main slots + 1 pre-show');
    expect(fact(sheet, 'Venue')).toHaveTextContent('Venue not chosen yet');
    expect(fact(sheet, 'Status')).toHaveTextContent('Scheduled');
    await waitFor(() => {
      expect(fact(sheet, 'Runs')).toHaveTextContent('Every Thursday');
    });
    expect(
      within(fact(sheet, 'Venue')).getByRole('button', { name: /^Why is the venue/ }),
    ).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(RUNNING_TIME_WORDS);

    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Test Weekly' })).not.toBeInTheDocument();
    });
    expect(router.state.location.search).toBe('');
  });

  it('hands focus back to the chip, or to the day, when the sheet closes', async () => {
    const { user } = await renderCalendar();
    const day = await findDay(/^Thursday, April 16, 2026/);
    const chip = await findChip(day, /Test Weekly/);

    await user.click(chip);
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Test Weekly' })).getByRole('button', {
        name: 'Close',
      }),
    );
    await waitFor(() => {
      expect(chip).toHaveFocus();
    });

    // Enter on the day opens its first show; Escape puts focus back on the day.
    act(() => {
      day.focus();
    });
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Test Weekly' });
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(day).toHaveFocus();
    });
  });

  it('puts focus on the show’s day when a sheet opened from a link closes', async () => {
    const probe = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    probe.host.installEngine(calendarWorldState());
    await probe.host.advanceDays({ maxDays: 1 }, () => undefined);
    const [show] = await storedShowsOn(probe, parseGameDate('2026-04-23'));
    if (show?.eventInstanceId == null) throw new Error('There is no show on 23 April.');

    const { user } = await renderCalendar(routes.game.calendarAt({ show: show.eventInstanceId }));
    const sheet = await screen.findByRole(
      'dialog',
      { name: 'Test Weekly' },
      { timeout: CALENDAR_LOAD_MS },
    );
    await waitFor(() => {
      expect(fact(sheet, 'Runs')).toHaveTextContent('Every Thursday');
    });
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.getByRole('gridcell', { name: /^Thursday, April 23, 2026/ })).toHaveFocus();
    });
  });

  it('opens straight on a month, a scope and a show from a link', async () => {
    const probe = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
    probe.host.installEngine(calendarWorldState());
    await probe.host.advanceDays({ maxDays: 1 }, () => undefined);
    // The same world always gets the same ids, so an id read from one engine opens in another.
    const [rival] = await storedShowsOn(probe, parseGameDate('2026-05-09'));
    if (rival?.eventInstanceId == null) throw new Error('The rival has no show on 9 May.');

    await renderCalendar(
      routes.game.calendarAt({ month: '2026-05', scope: 'world', show: rival.eventInstanceId }),
    );
    const sheet = await screen.findByRole(
      'dialog',
      { name: 'Test Rival Weekly' },
      { timeout: CALENDAR_LOAD_MS },
    );
    expect(fact(sheet, 'Promotion')).toHaveTextContent('Test Promotion B');
    expect(within(sheet).queryByRole('button', { name: 'Cancel show' })).not.toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'May 2026', hidden: true }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Show', hidden: true })).getByRole('radio', {
        name: 'Whole world',
        hidden: true,
      }),
    ).toBeChecked();
  });

  it('says so when the link names a show that does not exist', async () => {
    await renderCalendar(`${routes.game.calendar()}?show=evi_00000000zz`);
    const sheet = await screen.findByRole(
      'dialog',
      { name: 'Show not found' },
      { timeout: CALENDAR_LOAD_MS },
    );
    expect(within(sheet).getByText('That show no longer exists')).toBeInTheDocument();
  });

  it('cancels a show after asking, keeps the sheet open and announces it', async () => {
    const { user } = await renderCalendar();
    const day = await findDay(/^Thursday, April 16, 2026/);
    await user.click(await findChip(day, /Test Weekly/));
    const sheet = await screen.findByRole('dialog', { name: 'Test Weekly' });

    await user.click(await within(sheet).findByRole('button', { name: 'Cancel show' }));
    const confirm = await screen.findByRole('alertdialog', {
      name: 'Cancel Test Weekly on Thu 16 Apr 2026?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Cancel show' }));

    await waitFor(() => {
      expect(fact(sheet, 'Status')).toHaveTextContent('Cancelled by you on Sat 11 Apr 2026');
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
    expect(within(sheet).queryByRole('button', { name: 'Cancel show' })).not.toBeInTheDocument();
    await waitFor(() => {
      const spoken = screen
        .getAllByRole('status', { hidden: true })
        .map((region) => region.textContent);
      expect(spoken).toContain('Show cancelled');
    });

    await user.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Test Weekly' })).not.toBeInTheDocument();
    });
    const chip = await findChip(day, /Test Weekly/);
    await waitFor(() => {
      expect(chip).toHaveAttribute('data-status', 'cancelled');
    });
    expect(within(chip).getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows the game’s reason when a cancel is refused', async () => {
    const { transport, user } = await renderCalendar();
    await user.click(await findChip(await findDay(/^Thursday, April 23, 2026/), /Test Weekly/));
    const sheet = await screen.findByRole('dialog', { name: 'Test Weekly' });
    await user.click(await within(sheet).findByRole('button', { name: 'Cancel show' }));
    const confirm = await screen.findByRole('alertdialog');

    // The show is called off behind the screen's back, so the screen still offers Cancel.
    const [show] = await storedShowsOn(transport, parseGameDate('2026-04-23'));
    if (show?.eventInstanceId == null) throw new Error('There is no show on 23 April.');
    const cancelled = await transport.host.command('calendar.cancelShow', {
      eventInstanceId: show.eventInstanceId,
    });
    expect(cancelled.result.ok).toBe(true);

    await user.click(within(confirm).getByRole('button', { name: 'Cancel show' }));
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(
      'This show has already been cancelled.',
    );
  });

  it('forces Whole world and hides the switch for a seat with no promotion', async () => {
    await renderCalendar(routes.game.calendar(), { hasPromotion: false });
    await findChip(await findDay(/^Saturday, April 18, 2026/), /Test Rival Weekly/);
    expect(screen.queryByRole('group', { name: 'Show' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('says no game is loaded when no world answers, and still has one h1', async () => {
    await renderCalendar(routes.game.calendar(), { loadWorld: false });
    expect(
      await screen.findByText('No game loaded', undefined, { timeout: CALENDAR_LOAD_MS }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('lists the month as weeks on a phone', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const { router, user } = await renderCalendar();

    const week = await screen.findByRole(
      'region',
      { name: 'Week of Mon 13 Apr' },
      { timeout: CALENDAR_LOAD_MS },
    );
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(within(week).getByText('Thu 16')).toBeInTheDocument();
    const chip = await within(week).findByRole('button', { name: /Test Weekly/ });
    // The week the month starts in has no stored show of the player's.
    expect(
      within(screen.getByRole('region', { name: 'Week of Mon 30 Mar' })).getByText(
        'No shows this week',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Sat 11').closest('li')).toHaveAttribute('data-today', 'true');

    await user.click(chip);
    expect(router.state.location.search).toMatch(/^\?show=evi_/);
    const sheet = await screen.findByRole('dialog', { name: 'Test Weekly' });
    expect(sheet).toHaveAttribute('data-side', 'bottom');
  });

  describe('slots', () => {
    it('draws a registered sheet action and chip badge, and removes them on unregister', async () => {
      let removeAction: () => void = () => undefined;
      let removeBadge: () => void = () => undefined;
      act(() => {
        removeAction = registerShowSheetAction({
          id: 'test.book',
          order: 10,
          render: ({ isOwn }) => (isOwn ? <button type="button">Tape this show</button> : null),
        });
        removeBadge = registerShowChipBadge({
          id: 'test.taped',
          order: 10,
          render: () => <Badge tone="data">Taped</Badge>,
        });
      });
      cleanups.push(removeAction, removeBadge);

      const { user } = await renderCalendar();
      const chip = await findChip(await findDay(/^Thursday, April 16, 2026/), /Test Weekly/);
      expect(within(chip).getByText('Taped')).toBeInTheDocument();

      await user.click(chip);
      const sheet = await screen.findByRole('dialog', { name: 'Test Weekly' });
      expect(within(sheet).getByRole('button', { name: 'Tape this show' })).toBeInTheDocument();

      act(() => {
        removeAction();
        removeBadge();
      });
      expect(within(sheet).queryByRole('button', { name: 'Tape this show' })).toBeNull();
      expect(screen.queryByText('Taped')).not.toBeInTheDocument();
    });

    it('draws registered toolbar items and day markers, and removes them on unregister', async () => {
      const askedRanges: string[] = [];
      let removeToolbarItem: () => void = () => undefined;
      let removeMarkers: () => void = () => undefined;
      act(() => {
        removeToolbarItem = registerCalendarToolbarItem({
          id: 'test.new-show',
          order: 10,
          render: ({ scope }) => <button type="button">New show ({scope})</button>,
        });
        removeMarkers = registerCalendarDayMarkers({
          id: 'test.draft',
          useMarkers: ({ from, to }) => {
            askedRanges.push(`${from}..${to}`);
            return [
              { date: parseGameDate('2026-04-20'), label: 'Draft day', tone: 'prestige' },
              // Outside the days on screen, so it is ignored.
              { date: parseGameDate('2026-09-01'), label: 'Season ends', tone: 'action' },
            ];
          },
        });
      });
      cleanups.push(removeToolbarItem, removeMarkers);

      await renderCalendar();
      const draftDay = await findDay(/^Monday, April 20, 2026, Draft day/);
      expect(within(draftDay).getByText('Draft day')).toBeInTheDocument();
      expect(screen.queryByText('Season ends')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New show (mine)' })).toBeInTheDocument();
      // April 2026 on screen: Monday 30 March to Sunday 3 May.
      expect(askedRanges.at(-1)).toBe('2026-03-30..2026-05-03');

      act(() => {
        removeToolbarItem();
        removeMarkers();
      });
      expect(screen.queryByText('Draft day')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^New show/ })).not.toBeInTheDocument();
      expect(await findDay(/^Monday, April 20, 2026, no shows$/)).toBeInTheDocument();
    });
  });
});
