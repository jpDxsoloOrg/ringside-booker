import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialEngineState, parseContentKey, parseGameDate, parseId } from '@ringside/engine';
import type {
  CommandName,
  EventInstanceId,
  FinishOption,
  MatchDraft,
  PersonId,
  SegmentDraft,
} from '@ringside/engine';
import { worldBuilder } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { useSessionStore } from '@/app/session/sessionStore';
import { BOOKING_WORLD_START, fakeEngineFactory } from '@/test/fakeEngine';
import { BookingView } from '../BookingView';
import { bookingShowUrl } from '../bookingUrl';
import { useSegmentEditor } from '../editor/editorStore';
import { RANDOM_WINNERS_RESULT_TEXT } from '../editor/PlannedResultField';
import {
  FINISH_METHOD_RESET_MESSAGE,
  finishesArgsForDraft,
  finishMisfit,
  finishPatch,
  RANDOM_WINNERS_FINISH_TEXT,
} from './BookingFinishSection';

const LOAD_MS = 10_000;
const SINGLES = parseContentKey('match.singles');
const PINFALL = parseContentKey('method.pinfall');
const DISQUALIFICATION = parseContentKey('method.disqualification');
const NAMES = ['Kai Moreno', 'Rex Hale', 'Jo Park', 'Sam Reed'];

const KAI: PersonId = parseId('person', 'per_0000000001');
const REX: PersonId = parseId('person', 'per_0000000002');

function singlesDraft(outcome: MatchDraft['outcome'], finishKey: string | null = null): MatchDraft {
  return {
    kind: 'match',
    label: null,
    storylineIds: [],
    crew: { refereeId: null, producerId: null, announcerIds: [] },
    participants: [
      { personId: KAI, side: 0, role: 'competitor', teamId: null },
      { personId: REX, side: 1, role: 'competitor', teamId: null },
    ],
    match: {
      matchTypeKey: SINGLES,
      stipulationKeys: [],
      titleIds: [],
      finishKey: finishKey === null ? null : parseContentKey(finishKey),
    },
    outcome,
  };
}

function finish(key: string, name: string, methods: readonly string[]): FinishOption {
  return {
    key: parseContentKey(key),
    name,
    summary: `${name}.`,
    category: 'clean',
    outcomeKind: 'win',
    allowsTitleChange: !key.includes('disqualification'),
    effects: { workRate: 0, crowd: 0 },
    methods: methods.map((method) => ({
      key: parseContentKey(method),
      name: method,
      changesTitles: method !== 'method.disqualification',
    })),
    autoPickable: true,
  };
}

const CLEAN = finish('finish.clean', 'Clean finish', ['method.pinfall', 'method.submission']);
const DQ = finish('finish.disqualification', 'Disqualification', ['method.disqualification']);

describe('the Finish section rules', () => {
  it('asks for the finishes of the built sides and the planned result kind', () => {
    expect(finishesArgsForDraft(singlesDraft(null))).toEqual({
      matchTypeKey: SINGLES,
      sideCount: 2,
    });
    expect(finishesArgsForDraft(singlesDraft({ kind: 'draw' }))).toEqual({
      matchTypeKey: SINGLES,
      sideCount: 2,
      outcomeKind: 'draw',
    });
  });

  it('switches a planned win to a way of winning the finish ends with, keeping one it allows', () => {
    const win = singlesDraft({ kind: 'win', winningSide: 1, methodKey: PINFALL });
    expect(finishPatch(win, DQ.key, [CLEAN, DQ])).toEqual({
      match: { finishKey: DQ.key },
      outcome: { kind: 'win', winningSide: 1, methodKey: DISQUALIFICATION },
    });
    expect(finishPatch(win, CLEAN.key, [CLEAN, DQ])).toEqual({ match: { finishKey: CLEAN.key } });
    expect(finishPatch(win, null, [CLEAN, DQ])).toEqual({ match: { finishKey: null } });
  });

  it('says why a booked finish no longer fits', () => {
    const dqByPinfall = singlesDraft(
      { kind: 'win', winningSide: 0, methodKey: PINFALL },
      'finish.disqualification',
    );
    expect(finishMisfit(dqByPinfall, [CLEAN, DQ])).toBe(FINISH_METHOD_RESET_MESSAGE);
    expect(finishMisfit(dqByPinfall, [CLEAN])).toBe(
      'Finish reset to Auto: not allowed for this match',
    );
    expect(finishMisfit(singlesDraft(null, 'finish.disqualification'), [CLEAN, DQ])).toBeNull();
  });
});

interface FinishWorld {
  readonly transport: InProcessTransport;
  readonly eventInstanceId: EventInstanceId;
}

/** The player's promotion with four wrestlers and a weekly show, a day in so the show is stored. */
async function finishWorld(randomWinners: boolean): Promise<FinishWorld> {
  const { world } = worldBuilder({
    worldName: 'Test Finish World',
    startDate: parseGameDate('2026-01-05'),
    currentDate: BOOKING_WORLD_START,
    settings: { extra: { randomWinners } },
  })
    .withCatalogs()
    .withGeography('mini')
    .withPromotion(
      {
        name: 'Test Promotion A',
        shortName: 'TPA',
        controller: { kind: 'human', playerId: 'player-1' },
      },
      (promotion) =>
        promotion
          .withBrand({ name: 'Test Brand A' })
          .withRoster(NAMES.length, {
            employment: (index) => ({ ringName: NAMES[index] ?? 'Someone' }),
          })
          .withWeeklyShow(
            { name: 'Test Weekly', weekdays: [3] },
            { format: { slots: 6, preShowSlots: 1 } },
          ),
    )
    .build();
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(initialEngineState(world));
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const { result } = await transport.host.query('booking.shows', {});
  if (!result.ok) throw new Error('booking.shows was refused.');
  const show = result.data.rows[0];
  if (show === undefined) throw new Error('The finish world has no show.');
  return { transport, eventInstanceId: show.eventInstanceId };
}

/**
 * The booking view on its own, without the app shell or the lazily loaded route chunk (as the
 * segment editor tests do). Importing the section file above registers the Finish section.
 */
function renderBooking(built: FinishWorld): UserEvent {
  const router = createMemoryRouter([{ path: '*', element: <BookingView /> }], {
    initialEntries: [bookingShowUrl(built.eventInstanceId)],
    future: routerFutureFlags,
  });
  render(
    <EngineProvider createTransport={() => built.transport}>
      <LiveAnnouncer>
        <RouterProvider router={router} future={routerProviderFutureFlags} />
      </LiveAnnouncer>
    </EngineProvider>,
  );
  // No pause between simulated keys and clicks: nothing here depends on typing speed.
  return userEvent.setup({ delay: null });
}

/** Opens a new match in slot 2 and puts Kai Moreno against Rex Hale. */
async function newSingles(user: UserEvent): Promise<HTMLElement> {
  const row = await screen.findByRole('article', { name: 'Slot 2: Midcard' }, { timeout: LOAD_MS });
  await user.click(within(row).getByRole('button', { name: 'Add match' }));
  const editor = await screen.findByRole('dialog', { name: 'Slot 2 · Midcard' });
  await within(editor).findByRole('combobox', { name: /type/ }, { timeout: LOAD_MS });
  for (const [index, name] of [
    [0, /Kai Moreno/],
    [1, /Rex Hale/],
  ] as const) {
    const opener = within(editor).getAllByRole('button', { name: 'Add wrestler' })[index];
    if (opener === undefined) throw new Error(`No "Add wrestler" button ${String(index)}.`);
    await user.click(opener);
    const picker = await screen.findByRole('dialog', { name: /^Add to Side \d+$/ });
    await user.click(await within(picker).findByRole('option', { name }, { timeout: LOAD_MS }));
  }
  await within(editor).findByRole('link', { name: 'Rex Hale' });
  return editor;
}

/** The option names of an open select. */
async function openOptions(user: UserEvent, label: string): Promise<string[]> {
  const field = screen.getByRole('combobox', { name: label });
  field.focus();
  await user.keyboard('{Enter}');
  const list = await screen.findByRole('listbox');
  return within(list)
    .getAllByRole('option')
    .map((option) => option.textContent);
}

function hasDraft(value: unknown): value is { readonly draft: SegmentDraft } {
  return typeof value === 'object' && value !== null && 'draft' in value;
}

function sentDraft(
  spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } },
  name: CommandName,
): SegmentDraft | undefined {
  const args = spy.mock.calls.filter((call) => call[0] === name).at(-1)?.[1];
  return hasDraft(args) ? args.draft : undefined;
}

afterEach(() => {
  useSegmentEditor.getState().close();
  useSessionStore.getState().clear();
  vi.restoreAllMocks();
});

/** A backstop for a heavily loaded machine only; each test takes about a second on its own. */
const TEST_TIMEOUT_MS = 15_000;

describe('BookingFinishSection', { timeout: TEST_TIMEOUT_MS }, () => {
  it('narrows the finishes to a draw and saves the one picked with the match', async () => {
    const built = await finishWorld(false);
    const spy = vi.spyOn(built.transport.host, 'command');
    const user = renderBooking(built);
    const editor = await newSingles(user);

    const section = within(editor).getByRole('region', { name: 'Finish' });
    await within(section).findByRole('combobox', { name: 'Finish' });
    await user.click(within(editor).getByRole('radio', { name: 'Draw' }));
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: 'Finish' })).toBeEnabled();
    });
    await waitFor(
      async () => {
        const options = await openOptions(user, 'Finish');
        await user.keyboard('{Escape}');
        expect(options).toEqual([
          'Auto (decided on the night)',
          'Double count-out (no title change)',
          'Stalemate (no title change)',
        ]);
      },
      { timeout: LOAD_MS },
    );
    await openOptions(user, 'Finish');
    await user.click(screen.getByRole('option', { name: 'Stalemate (no title change)' }));
    await user.click(within(editor).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(sentDraft(spy, 'booking.addSegment')).toMatchObject({
        match: { finishKey: 'finish.stalemate' },
        outcome: { kind: 'draw' },
      });
    });
  });

  it('switches the way of winning to one the picked finish ends with', async () => {
    const built = await finishWorld(false);
    const user = renderBooking(built);
    const editor = await newSingles(user);

    await user.click(within(editor).getByRole('radio', { name: 'Side 2: Rex Hale' }));
    expect(within(editor).getByRole('combobox', { name: 'Method' })).toHaveTextContent('Pinfall');
    await waitFor(
      async () => {
        const options = await openOptions(user, 'Finish');
        expect(options).toContain('Disqualification (no title change)');
      },
      { timeout: LOAD_MS },
    );
    await user.click(screen.getByRole('option', { name: 'Disqualification (no title change)' }));
    await waitFor(() => {
      expect(within(editor).getByRole('combobox', { name: 'Method' })).toHaveTextContent(
        'Disqualification',
      );
    });
  });

  it('says results and finishes are decided on the night in a Random winners game', async () => {
    const built = await finishWorld(true);
    const spy = vi.spyOn(built.transport.host, 'command');
    const user = renderBooking(built);
    const editor = await newSingles(user);

    expect(within(editor).getByText(RANDOM_WINNERS_RESULT_TEXT)).toBeInTheDocument();
    expect(within(editor).queryByRole('radio', { name: 'Draw' })).toBeNull();
    const section = within(editor).getByRole('region', { name: 'Finish' });
    expect(within(section).getByText(RANDOM_WINNERS_FINISH_TEXT)).toBeInTheDocument();
    expect(within(section).queryByRole('combobox')).toBeNull();

    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(sentDraft(spy, 'booking.addSegment')).toMatchObject({
        match: { finishKey: null },
        outcome: null,
      });
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Slot 2 · Midcard' })).toBeNull();
    });
    await user.click(await screen.findByRole('button', { name: 'Actions for slot 2' }));
    await screen.findByRole('menuitem', { name: 'Edit' });
    expect(screen.queryByRole('menuitem', { name: 'Winner' })).toBeNull();
  });
});
