/**
 * The day control in the real shell, against the UI-08 test engine in process: a gate that can
 * stop a skip on a chosen day (with a reason and a route hint), and a phase that throws on a
 * chosen day. The live announcer is replaced with a spy so each completion's announcement can be
 * counted; the engine host's autosave is a spy so the policy's answers can be checked without
 * touching storage.
 */
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { diffDays, initialEngineState, parseContentKey } from '@ringside/engine';
import type { CommandArgs, CommandName, EngineState, GameDate, PersonId } from '@ringside/engine';
import { worldBuilder } from '@ringside/engine/testing';
import { formatGameDate } from '@/components/format';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import {
  bookingFakeState,
  FAKE_FAILING_STEP_ID,
  FAKE_FAILURE_MESSAGE,
  FAKE_START_DATE,
  fakeAdvanceDay,
  fakeEngineFactory,
  fakeEngineState,
} from '@/test/fakeEngine';
import type { FakeEngineOptions } from '@/test/fakeEngine';
import { fakeSlot } from '@/test/fakeStorage';
import { setMatchMedia } from '@/test/matchMedia';
import type { SaveSlotResult } from '@/worker/engineHost';
import { EngineProvider } from '../../engine/EngineProvider';
import { createInProcessTransport } from '../../engine/transport';
import type { InProcessTransport } from '../../engine/transport';
import { buildAppRoutes, routerFutureFlags, routerProviderFutureFlags } from '../../router';
import { routes } from '../../routes';
import { useSessionStore } from '../../session/sessionStore';

const announceSpy = vi.hoisted(() => vi.fn());

vi.mock('@/app/a11y/LiveAnnouncer', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAnnounce: () => announceSpy };
});

const SHOW_REASON = 'Tonight: Harbor Lights Showdown';
const SLOT_ID = 'slot-1';

/** A world where no human runs anything: the local seat is an observer with no promotion. */
function observerState(): EngineState {
  const built = worldBuilder()
    .withGeography('mini')
    .withPromotion({ name: 'Computer Promotion' }, (promotion) => promotion.withBrand())
    .build();
  return initialEngineState(built.world);
}

interface GameOptions {
  /** The world to load. The fake engine's tiny world by default. */
  readonly state?: EngineState;
  readonly fake?: FakeEngineOptions;
  /** The slot the game was loaded from. Null (the default) means nothing to autosave into. */
  readonly saveSlotId?: string | null;
  readonly autosaveResult?: SaveSlotResult;
}

function renderGame({
  state = fakeEngineState(),
  fake = {},
  saveSlotId = null,
  autosaveResult,
}: GameOptions = {}) {
  const transport = createInProcessTransport(fakeEngineFactory(fake), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(state);
  useSessionStore.getState().setLoaded({ saveSlotId, seat: install.seat });
  const autosaveSpy = vi
    .spyOn(transport.host, 'autosave')
    .mockResolvedValue(autosaveResult ?? { ok: true, slot: fakeSlot({ slotId: SLOT_ID }) });
  const advanceSpy = vi.spyOn(transport.host, 'advanceDays');
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    // A placeholder screen, not the office: the sample dashboard's large DOM makes every role
    // query slow enough that a 30-day skip outlasts the test timeout in CI.
    initialEntries: [routes.game.calendar()],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { transport, router, autosaveSpy, advanceSpy, user: userEvent.setup() };
}

function longDate(date: GameDate): string {
  return formatGameDate(date, 'long');
}

/** The date chip, once the engine has answered with `date`. */
async function expectDateChip(date: GameDate): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId('date-chip')).toHaveTextContent(longDate(date));
  });
}

function dayButton(name: string | RegExp = 'Next day'): HTMLElement {
  return within(screen.getByTestId('day-control')).getByRole('button', { name });
}

async function openSkipSheet(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: 'Skip days' }));
  return screen.findByRole('dialog', { name: 'Skip days' });
}

async function skip(user: ReturnType<typeof userEvent.setup>, quickChoice: string): Promise<void> {
  const sheet = await openSkipSheet(user);
  await user.click(within(sheet).getByRole('button', { name: quickChoice }));
  await user.click(within(sheet).getByRole('button', { name: 'Start' }));
}

/**
 * A 30-day skip moves the fake engine a day at a time through the real shell, which takes over a
 * second under coverage on a CI runner: longer than the default wait for an element.
 */
const SUMMARY_TIMEOUT_MS = 4000;

/**
 * The whole month-change test: a day, a 30-day skip and two autosaves. With the full suite running
 * beside it on a busy machine it has gone past the default five seconds.
 */
const MONTH_SKIP_TEST_TIMEOUT_MS = 15_000;
const MONTH_SKIP_SUMMARY_TIMEOUT_MS = 10_000;

async function summary(timeoutMs: number = SUMMARY_TIMEOUT_MS): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Last advance' }, { timeout: timeoutMs });
}

beforeEach(() => {
  announceSpy.mockClear();
  useSessionStore.getState().clear();
  window.localStorage.clear();
});

describe('DayControl: Next day', () => {
  it('advances exactly one day and the date chip follows, with the season under it', async () => {
    const { user, advanceSpy } = renderGame();
    await expectDateChip(FAKE_START_DATE);
    expect(screen.getByTestId('date-chip')).toHaveTextContent('Season 2');
    expect(screen.getByTestId('cash-chip')).toHaveTextContent('Cash');
    expect(screen.getByTestId('popularity-chip')).toHaveTextContent(/Prestige \d+/);

    await user.click(dayButton());

    await expectDateChip(fakeAdvanceDay(2));
    expect(advanceSpy).toHaveBeenCalledTimes(1);
    expect(advanceSpy.mock.calls[0]?.[0]).toEqual({ maxDays: 1 });
    await waitFor(() => {
      expect(announceSpy).toHaveBeenCalledTimes(1);
    });
    expect(announceSpy).toHaveBeenCalledWith(`Advanced 1 day to ${longDate(fakeAdvanceDay(2))}.`, {
      politeness: 'polite',
    });
    // A plain single day is announced, not bannered, and shows no overlay.
    expect(screen.queryByRole('region', { name: 'Last advance' })).toBeNull();
    expect(screen.getByTestId('advance-overlay')).not.toHaveAttribute('open');
  });

  it('runs from Shift+N, and documents the shortcut on the button', async () => {
    const { user, advanceSpy } = renderGame();
    await expectDateChip(FAKE_START_DATE);
    expect(dayButton()).toHaveAttribute('aria-keyshortcuts', 'Shift+N');
    expect(dayButton()).toHaveAttribute('title', 'Next day (Shift+N)');

    await user.keyboard('{Shift>}N{/Shift}');

    await expectDateChip(fakeAdvanceDay(2));
    expect(advanceSpy).toHaveBeenCalledTimes(1);
  });
});

describe('DayControl: skipping days', () => {
  it('stops a 30-day skip at the gate on day 5 and says why', async () => {
    const { user, router } = renderGame({
      fake: {
        gateDate: fakeAdvanceDay(5),
        gateHit: { reason: SHOW_REASON, actionHint: 'showNight' },
      },
    });
    await expectDateChip(FAKE_START_DATE);

    await skip(user, '30 days');

    const banner = await summary();
    expect(banner).toHaveTextContent(`Advanced 4 days to ${longDate(fakeAdvanceDay(5))}`);
    expect(banner).toHaveTextContent(SHOW_REASON);
    await expectDateChip(fakeAdvanceDay(5));
    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy).toHaveBeenCalledWith(
      `Advanced 4 days to ${longDate(fakeAdvanceDay(5))}. ${SHOW_REASON}.`,
      { politeness: 'polite' },
    );

    // The show now waits: the button goes to the show, with the reason as its description, and
    // Skip is off. The banner offers the same way in.
    expect(within(banner).getByRole('link', { name: 'Go to the show' })).toHaveAttribute(
      'href',
      routes.game.booking(),
    );
    const goToShow = await waitFor(() => dayButton('Go to the show'));
    expect(goToShow).toHaveAccessibleDescription(SHOW_REASON);
    expect(screen.getByRole('button', { name: 'Skip days' })).toBeDisabled();
    await user.click(goToShow);
    expect(router.state.location.pathname).toBe(routes.game.booking());
  });

  it('stops after the current day when Stop is pressed, and says it was you', async () => {
    const { user } = renderGame();
    await expectDateChip(FAKE_START_DATE);

    await skip(user, '365 days');

    const overlay = screen.getByTestId('advance-overlay');
    await waitFor(() => {
      expect(overlay).toHaveAttribute('open');
      expect(within(overlay).getByText(/^Day \d+ of 365$/)).toBeInTheDocument();
    });
    expect(within(overlay).getByRole('progressbar', { name: 'Days simulated' })).toHaveAttribute(
      'max',
      '365',
    );
    await user.click(within(overlay).getByRole('button', { name: 'Stop' }));

    const banner = await summary();
    expect(banner).toHaveTextContent('Stopped by you');
    const advanced = /Advanced (\d+) days?/.exec(banner.textContent);
    expect(Number(advanced?.[1])).toBeGreaterThan(0);
    expect(Number(advanced?.[1])).toBeLessThan(365);
    expect(overlay).not.toHaveAttribute('open');
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it('lists the step that failed on day 2, ready to copy', async () => {
    const { user } = renderGame({ fake: { failDate: fakeAdvanceDay(2) } });
    await expectDateChip(FAKE_START_DATE);

    await skip(user, '7 days');

    const banner = await summary();
    expect(banner).toHaveTextContent(`Advanced 7 days to ${longDate(fakeAdvanceDay(8))}`);
    expect(announceSpy).toHaveBeenCalledWith(
      `Advanced 7 days to ${longDate(fakeAdvanceDay(8))}. 1 background step failed.`,
      { politeness: 'polite' },
    );
    await user.click(within(banner).getByRole('button', { name: '1 background step failed' }));

    const sheet = await screen.findByRole('dialog', { name: 'Background steps that failed' });
    const [failure] = within(sheet).getAllByRole('listitem');
    expect(failure).toHaveTextContent(formatGameDate(fakeAdvanceDay(2), 'short'));
    expect(failure).toHaveTextContent(FAKE_FAILING_STEP_ID);
    expect(failure).toHaveTextContent(FAKE_FAILURE_MESSAGE);

    await user.click(within(sheet).getByRole('button', { name: 'Copy details' }));
    expect(await within(sheet).findByText('Copied')).toBeInTheDocument();
    await expect(navigator.clipboard.readText()).resolves.toBe(
      `${fakeAdvanceDay(2)}  ${FAKE_FAILING_STEP_ID}  ${FAKE_FAILURE_MESSAGE}`,
    );
  });

  it('dismisses the summary', async () => {
    const { user } = renderGame();
    await expectDateChip(FAKE_START_DATE);
    await skip(user, '7 days');
    const banner = await summary();

    await user.click(within(banner).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByRole('region', { name: 'Last advance' })).toBeNull();
  });
});

describe('DayControl: gates waiting today', () => {
  it('sends decisions to the inbox, filtered, with Skip off', async () => {
    const { user, router, advanceSpy } = renderGame({
      fake: {
        gateDate: FAKE_START_DATE,
        gateHit: { reason: 'A contract offer needs an answer', actionHint: 'inbox' },
      },
    });

    const button = await waitFor(() => dayButton('1 decision waiting'));
    expect(screen.getByRole('button', { name: 'Skip days' })).toBeDisabled();
    await user.click(button);

    expect(router.state.location.pathname).toBe(routes.game.inbox());
    expect(router.state.location.search).toBe('?filter=decisions');
    expect(advanceSpy).not.toHaveBeenCalled();
  });

  it('links the show the gate names', async () => {
    const { user, router } = renderGame({
      fake: {
        gateDate: FAKE_START_DATE,
        gateHit: {
          reason: SHOW_REASON,
          actionHint: 'showNight',
          subject: { kind: 'eventInstance', id: 'evi_harbor' },
        },
      },
    });

    await user.click(await waitFor(() => dayButton('Go to the show')));

    expect(router.state.location.pathname).toBe(routes.game.booking());
    expect(router.state.location.search).toBe('?event=evi_harbor');
  });

  it('shows the reasons of a gate no screen handles yet', async () => {
    const { user, advanceSpy } = renderGame({
      fake: {
        gateDate: FAKE_START_DATE,
        gateHit: { reason: 'Your draft pick is due', actionHint: 'draftRoom' },
      },
    });

    await user.click(await waitFor(() => dayButton('Needs attention')));

    const sheet = await screen.findByRole('dialog', { name: 'Waiting on you' });
    expect(sheet).toHaveTextContent('Your draft pick is due');
    expect(advanceSpy).not.toHaveBeenCalled();
  });
});

describe('DayControl: autosave', () => {
  it('asks the policy after each advance and saves only when it says so', async () => {
    const { user, autosaveSpy } = renderGame({ saveSlotId: SLOT_ID });
    await expectDateChip(FAKE_START_DATE);

    // The first advance of a session has no autosave on record, so the policy saves.
    await user.click(dayButton());
    await waitFor(() => {
      expect(autosaveSpy).toHaveBeenCalledTimes(1);
    });
    expect(autosaveSpy).toHaveBeenLastCalledWith(SLOT_ID, { monthlyBackup: false });
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    // One day later: not yet.
    await user.click(dayButton());
    await expectDateChip(fakeAdvanceDay(3));
    await waitFor(() => {
      expect(announceSpy).toHaveBeenCalledTimes(2);
    });
    expect(autosaveSpy).toHaveBeenCalledTimes(1);

    // A week on from the last autosave: save again.
    await skip(user, '7 days');
    await summary();
    await waitFor(() => {
      expect(autosaveSpy).toHaveBeenCalledTimes(2);
    });
    expect(autosaveSpy).toHaveBeenLastCalledWith(SLOT_ID, { monthlyBackup: false });
  });

  it(
    'rotates a monthly backup when the month changes',
    async () => {
      const { user, autosaveSpy } = renderGame({ saveSlotId: SLOT_ID });
      await expectDateChip(FAKE_START_DATE);
      await user.click(dayButton());
      await waitFor(() => {
        expect(autosaveSpy).toHaveBeenCalledTimes(1);
      });

      // From 11 April, 30 days reach May.
      await skip(user, '30 days');
      await summary(MONTH_SKIP_SUMMARY_TIMEOUT_MS);
      await waitFor(() => {
        expect(autosaveSpy).toHaveBeenCalledTimes(2);
      });
      expect(autosaveSpy).toHaveBeenLastCalledWith(SLOT_ID, { monthlyBackup: true });
    },
    MONTH_SKIP_TEST_TIMEOUT_MS,
  );

  it('never autosaves a game that has no save slot', async () => {
    const { user, autosaveSpy } = renderGame({ saveSlotId: null });
    await expectDateChip(FAKE_START_DATE);
    await skip(user, '14 days');
    await summary();
    expect(autosaveSpy).not.toHaveBeenCalled();
  });

  it('shows a warning chip with the storage error when the autosave fails', async () => {
    const message = 'The browser has no room left for saves. Delete or export old saves.';
    const { user } = renderGame({
      saveSlotId: SLOT_ID,
      autosaveResult: { ok: false, message, storageError: { code: 'quota', message } },
    });
    await expectDateChip(FAKE_START_DATE);

    await user.click(dayButton());

    const warning = await screen.findByRole('button', { name: 'No room for saves' });
    await user.click(warning);
    expect(await screen.findByText(message)).toBeInTheDocument();
  });
});

describe('DayControl on a phone', () => {
  beforeEach(() => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
  });

  it('shows the short date and the day button, with the rest in the status sheet', async () => {
    const { user } = renderGame();
    const banner = await screen.findByRole('banner');
    const dateButton = await within(banner).findByTestId('status-date');
    expect(dateButton).toHaveTextContent(formatGameDate(FAKE_START_DATE, 'short'));
    expect(within(banner).getByRole('button', { name: 'Next day' })).toBeInTheDocument();
    expect(within(banner).queryByTestId('cash-chip')).toBeNull();
    expect(within(banner).queryByRole('button', { name: 'Skip days' })).toBeNull();

    await user.click(dateButton);
    const sheet = await screen.findByRole('dialog', { name: 'Status' });
    expect(within(sheet).getByTestId('date-chip')).toHaveTextContent('Season 2');
    expect(within(sheet).getByTestId('cash-chip')).toBeInTheDocument();
    expect(within(sheet).getByTestId('popularity-chip')).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Skip days' }));
    const skipSheet = await screen.findByRole('dialog', { name: 'Skip days' });
    expect(skipSheet).toHaveAttribute('data-side', 'bottom');
  });
});

describe('DayControl without a promotion', () => {
  it('still offers Next day while the cash and popularity chips stay hidden', async () => {
    const { user } = renderGame({ state: observerState() });
    const dateChip = await screen.findByTestId('date-chip');
    expect(screen.queryByTestId('cash-chip')).toBeNull();
    expect(screen.queryByTestId('popularity-chip')).toBeNull();
    const start = dateChip.querySelector('time')?.getAttribute('datetime');

    await user.click(dayButton());

    await waitFor(() => {
      expect(screen.getByTestId('date-chip').querySelector('time')).not.toHaveAttribute(
        'datetime',
        start ?? '',
      );
    });
  });
});

async function command<K extends CommandName>(
  transport: InProcessTransport,
  name: K,
  args: CommandArgs<K>,
): Promise<void> {
  const { result } = await transport.host.command(name, args);
  if (!result.ok) throw new Error(`${name} was refused: ${JSON.stringify(result.reasons)}`);
}

/**
 * The booking world the day before the player's Thursday show, its card full of singles matches
 * with planned winners, with the real show-day gate. There is no lock (EVT2-09): the next Next Day
 * stops on the show, and the player runs it from the show screen.
 */
async function renderShowEve() {
  const transport = createInProcessTransport(fakeEngineFactory({ showDayGate: true }), {
    progressIntervalMs: 0,
  });
  const { state, roster } = bookingFakeState();
  const install = transport.host.installEngine(state);
  // One simulated day stores the shows.
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  const shows = await transport.host.query('booking.shows', {});
  if (!shows.result.ok) throw new Error('booking.shows was refused.');
  const show = shows.result.data.rows[0];
  if (show === undefined) throw new Error('The booking world has no show.');
  const pairs: (readonly [PersonId, PersonId])[] = [];
  for (let index = 0; index + 1 < roster.length; index += 2) {
    const first = roster[index];
    const second = roster[index + 1];
    if (first !== undefined && second !== undefined) pairs.push([first, second]);
  }
  for (const [slot, [first, second]] of pairs.slice(0, show.slots).entries()) {
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
        outcome: { kind: 'win', winningSide: 0, methodKey: parseContentKey('method.pinfall') },
      },
    });
  }
  const clock = await transport.host.query('clock.get', {});
  if (!clock.result.ok) throw new Error('clock.get was refused.');
  const daysToEve = diffDays(clock.result.data.date, show.date) - 1;
  if (daysToEve > 0) await transport.host.advanceDays({ maxDays: daysToEve }, () => undefined);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const router = createMemoryRouter(buildAppRoutes({ includeDevRoutes: false }), {
    initialEntries: [routes.game.calendar()],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => transport}>
      <RouterProvider router={router} future={routerProviderFutureFlags} />
    </EngineProvider>,
  );
  return { show, router, user: userEvent.setup() };
}

describe('DayControl: a show night', () => {
  it(
    'stops Next Day on your show with Tonight; Go to the show, Run the show, then the results',
    { timeout: 20_000 },
    async () => {
      const { show, router, user } = await renderShowEve();

      await user.click(await waitFor(() => dayButton()));

      // The day ran in full and landed on show day: the banner says so, and nothing ran the show.
      await expectDateChip(show.date);
      const banner = await summary();
      expect(banner).toHaveTextContent(`Tonight: ${show.name}`);
      expect(within(banner).queryByRole('link', { name: /^See results/ })).toBeNull();
      const goToShow = await waitFor(() => dayButton('Go to the show'));
      expect(goToShow).toHaveAccessibleDescription(`Tonight: ${show.name}`);

      await user.click(goToShow);
      expect(router.state.location.pathname).toBe(routes.game.booking());
      expect(router.state.location.search).toBe(`?event=${show.eventInstanceId}`);

      const run = await screen.findByRole('button', { name: 'Run the show' }, { timeout: 5_000 });
      await waitFor(() => {
        expect(run).toBeEnabled();
      });
      await user.click(run);

      await waitFor(
        () => {
          expect(router.state.location.pathname).toBe(
            routes.game.showResults(show.eventInstanceId),
          );
        },
        { timeout: 5_000 },
      );
      expect(router.state.location.search).toBe('?reveal=1');
      // The show has run, so Next Day moves on again.
      await waitFor(() => dayButton('Next day'));
    },
  );

  it('leaves a plain Next Day with no show of yours unbannered', async () => {
    const { user } = renderGame();
    await expectDateChip(FAKE_START_DATE);
    await user.click(dayButton());
    await expectDateChip(fakeAdvanceDay(2));
    expect(screen.queryByRole('link', { name: /^See results/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Last advance' })).toBeNull();
  });
});
