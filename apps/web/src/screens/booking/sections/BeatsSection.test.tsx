import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { act } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialEngineState, parseContentKey, parseGameDate } from '@ringside/engine';
import type {
  CommandArgs,
  CommandName,
  EventInstanceId,
  PersonId,
  SegmentDraft,
  SegmentId,
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

const LOAD_MS = 10_000;
const NAMES = ['Kai Moreno', 'Rex Hale', 'Jo Park'];

interface BeatsWorld {
  readonly transport: InProcessTransport;
  readonly eventInstanceId: EventInstanceId;
  /** A confrontation in slot 2: Kai Moreno (side 0) faces Rex Hale (side 1). */
  readonly confrontation: SegmentId;
  readonly kai: PersonId;
  readonly rex: PersonId;
}

function confrontation(kai: PersonId, rex: PersonId): SegmentDraft {
  return {
    kind: 'angle',
    label: null,
    storylineIds: [],
    crew: { refereeId: null, producerId: null, announcerIds: [] },
    participants: [
      { personId: kai, side: 0, role: 'speaker', teamId: null, talkRole: 'wrestler' },
      { personId: rex, side: 1, role: 'speaker', teamId: null, talkRole: 'wrestler' },
    ],
    angle: { angleTypeKey: parseContentKey('angle.confrontation') },
  };
}

async function run<K extends CommandName>(
  transport: InProcessTransport,
  name: K,
  args: CommandArgs<K>,
): Promise<void> {
  const { result } = await transport.host.command(name, args);
  if (!result.ok) throw new Error(`${name} was refused: ${result.reasons[0]?.message ?? ''}`);
}

/** The player's promotion with three wrestlers and a weekly show with a confrontation booked. */
async function beatsWorld(): Promise<BeatsWorld> {
  const { world, ids } = worldBuilder({
    worldName: 'Test Beats World',
    startDate: parseGameDate('2026-01-05'),
    currentDate: BOOKING_WORLD_START,
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
  const [kai, rex] = ids.people;
  if (kai === undefined || rex === undefined) throw new Error('The beats world has no roster.');
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(initialEngineState(world));
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const shows = await transport.host.query('booking.shows', {});
  if (!shows.result.ok) throw new Error('booking.shows was refused.');
  const show = shows.result.data.rows[0];
  if (show === undefined) throw new Error('The beats world has no show.');
  const eventInstanceId = show.eventInstanceId;
  await run(transport, 'booking.addSegment', {
    eventInstanceId,
    preShow: false,
    slot: 1,
    draft: confrontation(kai, rex),
  });
  const card = await transport.host.query('booking.card', { eventInstanceId });
  if (!card.result.ok) throw new Error('booking.card was refused.');
  const found = card.result.data.sections
    .flatMap((section) => section.slots)
    .find((slot) => !slot.preShow && slot.slot === 1);
  if (found?.segment == null) throw new Error('Slot 2 is empty.');
  return { transport, eventInstanceId, confrontation: found.segment.segmentId, kai, rex };
}

function renderBooking(built: BeatsWorld): UserEvent {
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
  return userEvent.setup({ delay: null });
}

/** Opens the editor on the confrontation; returns the sheet and its Beats section. */
async function openBeats(built: BeatsWorld) {
  await screen.findByRole('article', { name: 'Slot 2: Midcard' }, { timeout: LOAD_MS });
  act(() => {
    useSegmentEditor.getState().openExisting(built.confrontation);
  });
  const editor = await screen.findByRole('dialog', { name: /^Slot 2 · / }, { timeout: LOAD_MS });
  const section = await within(editor).findByRole(
    'region',
    { name: 'Beats' },
    { timeout: LOAD_MS },
  );
  return { editor, section };
}

/** Beat `n`'s row (1-based), found by its heading. */
function beatRow(section: HTMLElement, beatNumber: number): HTMLElement {
  const heading = within(section).getByRole('heading', {
    level: 4,
    name: `Beat ${String(beatNumber)}`,
  });
  const row = heading.closest('li');
  if (row === null) throw new Error(`Beat ${String(beatNumber)} has no row.`);
  return row;
}

async function addTo(user: UserEvent, row: HTMLElement, group: string, name: string) {
  await user.click(within(row).getByRole('button', { name: `Add person to ${group}` }));
  const picker = await screen.findByRole('dialog', { name: `Add to ${group}` });
  await user.click(within(picker).getByRole('button', { name }));
}

afterEach(() => {
  useSegmentEditor.getState().close();
  useSessionStore.getState().clear();
  vi.restoreAllMocks();
});

const TEST_TIMEOUT_MS = 20_000;

describe('BeatsSection', { timeout: TEST_TIMEOUT_MS }, () => {
  it('shows the stored beat, saves a second one with group one first and the right sides', async () => {
    const built = await beatsWorld();
    const commandSpy = vi.spyOn(built.transport.host, 'command');
    const user = renderBooking(built);
    const { editor, section } = await openBeats(built);

    const first = beatRow(section, 1);
    expect(within(first).getByRole('group', { name: 'Side A' })).toHaveTextContent('Kai Moreno');
    expect(within(first).getByRole('group', { name: 'Side B' })).toHaveTextContent('Rex Hale');

    await user.click(within(section).getByRole('button', { name: 'Add beat' }));
    const second = beatRow(section, 2);
    // The picker offers the segment's own speakers only.
    await user.click(within(second).getByRole('button', { name: 'Add person to Side A' }));
    const picker = await screen.findByRole('dialog', { name: 'Add to Side A' });
    expect(within(picker).queryByRole('button', { name: 'Jo Park' })).toBeNull();
    await user.click(within(picker).getByRole('button', { name: 'Rex Hale' }));
    await addTo(user, second, 'Side B', 'Kai Moreno');

    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(commandSpy.mock.calls.some((call) => call[0] === 'booking.updateSegment')).toBe(true);
    });
    const card = await built.transport.host.query('booking.card', {
      eventInstanceId: built.eventInstanceId,
    });
    if (!card.result.ok) throw new Error('booking.card was refused.');
    const draft = card.result.data.sections
      .flatMap((entry) => entry.slots)
      .find((slot) => slot.segment?.segmentId === built.confrontation)?.segment?.draft;
    if (draft?.kind !== 'angle') throw new Error('The confrontation is gone.');
    expect(draft.angle.beats).toEqual([
      { beatKey: 'beat.staredown', personIds: [built.kai, built.rex] },
      { beatKey: 'beat.staredown', personIds: [built.rex, built.kai] },
    ]);
    expect(draft.participants.map((person) => [person.personId, person.side])).toEqual([
      [built.kai, 0],
      [built.rex, 1],
    ]);
  });

  it("says why groups that can't be stored aren't saved", async () => {
    const built = await beatsWorld();
    const user = renderBooking(built);
    const { section } = await openBeats(built);
    await user.click(within(section).getByRole('button', { name: 'Add beat' }));
    const second = beatRow(section, 2);
    await addTo(user, second, 'Side A', 'Kai Moreno');
    await addTo(user, second, 'Side A', 'Rex Hale');
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      /Kai Moreno and Rex Hale .* opposed in beat 1; booking can't store that\. These beats aren't saved/,
    );
  });
});
