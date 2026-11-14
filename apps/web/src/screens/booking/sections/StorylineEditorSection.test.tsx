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
  StorylineId,
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
import { SAVE_FIRST_TEXT } from './StorylineEditorSection';

const LOAD_MS = 10_000;
const NAMES = ['Kai Moreno', 'Rex Hale', 'Jo Park', 'Sam Reed'];
const ASHFALL = 'Test Ashfall Rivalry';
const HARBOUR = 'Test Harbour Grudge';

interface LinkWorld {
  readonly transport: InProcessTransport;
  readonly eventInstanceId: EventInstanceId;
  /** Kai Moreno vs Rex Hale in slot 2 (Ashfall's people), Jo Park vs Sam Reed in slot 3. */
  readonly ashfallMatch: SegmentId;
  readonly harbourMatch: SegmentId;
  readonly ashfall: StorylineId;
}

function singles(left: PersonId, right: PersonId): SegmentDraft {
  return {
    kind: 'match',
    label: null,
    storylineIds: [],
    crew: { refereeId: null, producerId: null, announcerIds: [] },
    participants: [
      { personId: left, side: 0, role: 'competitor', teamId: null },
      { personId: right, side: 1, role: 'competitor', teamId: null },
    ],
    match: {
      matchTypeKey: parseContentKey('match.singles'),
      stipulationKeys: [],
      titleIds: [],
      finishKey: null,
    },
    outcome: null,
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

/**
 * The player's promotion with four wrestlers, two storylines (Ashfall: Kai and Rex; Harbour: Jo
 * and Sam) and a weekly show a day in, with one match for each storyline's people on the card.
 */
async function linkWorld(): Promise<LinkWorld> {
  const { world, ids } = worldBuilder({
    worldName: 'Test Link World',
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
          )
          .withStoryline(
            { name: ASHFALL, heat: 54 },
            {
              members: [
                [0, 'face'],
                [1, 'heel'],
              ],
            },
          )
          .withStoryline(
            { name: HARBOUR, heat: 48 },
            {
              members: [
                [2, 'face'],
                [3, 'heel'],
              ],
            },
          ),
    )
    .build();
  const [kai, rex, jo, sam] = ids.people;
  const [ashfall] = ids.storylines;
  if (kai === undefined || rex === undefined || jo === undefined || sam === undefined) {
    throw new Error('The link world has no roster.');
  }
  if (ashfall === undefined) throw new Error('The link world has no storylines.');
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(initialEngineState(world));
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const shows = await transport.host.query('booking.shows', {});
  if (!shows.result.ok) throw new Error('booking.shows was refused.');
  const show = shows.result.data.rows[0];
  if (show === undefined) throw new Error('The link world has no show.');
  const eventInstanceId = show.eventInstanceId;
  await run(transport, 'booking.addSegment', {
    eventInstanceId,
    preShow: false,
    slot: 1,
    draft: singles(kai, rex),
  });
  await run(transport, 'booking.addSegment', {
    eventInstanceId,
    preShow: false,
    slot: 2,
    draft: singles(jo, sam),
  });
  const card = await transport.host.query('booking.card', { eventInstanceId });
  if (!card.result.ok) throw new Error('booking.card was refused.');
  const slots = card.result.data.sections.flatMap((section) => section.slots);
  const segmentIn = (slot: number): SegmentId => {
    const found = slots.find((candidate) => !candidate.preShow && candidate.slot === slot);
    if (found?.segment == null) throw new Error(`Slot ${String(slot)} is empty.`);
    return found.segment.segmentId;
  };
  return {
    transport,
    eventInstanceId,
    ashfallMatch: segmentIn(1),
    harbourMatch: segmentIn(2),
    ashfall,
  };
}

function renderBooking(built: LinkWorld): UserEvent {
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

/** Opens the editor on a segment already on the card; returns its Storyline section. */
async function openSection(segmentId: SegmentId): Promise<HTMLElement> {
  await screen.findByRole('article', { name: 'Slot 2: Midcard' }, { timeout: LOAD_MS });
  act(() => {
    useSegmentEditor.getState().openExisting(segmentId);
  });
  const editor = await screen.findByRole('dialog', { name: /^Slot \d+ · / }, { timeout: LOAD_MS });
  return within(editor).findByRole('region', { name: 'Storyline' }, { timeout: LOAD_MS });
}

function linkQueries(spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } }) {
  return spy.mock.calls.filter((call) => call[0] === 'storylines.linkOptions').length;
}

afterEach(() => {
  useSegmentEditor.getState().close();
  useSessionStore.getState().clear();
  vi.restoreAllMocks();
});

const TEST_TIMEOUT_MS = 20_000;

describe('StorylineEditorSection', { timeout: TEST_TIMEOUT_MS }, () => {
  it('suggests the storyline whose people are in the match and links it with one tap', async () => {
    const built = await linkWorld();
    const querySpy = vi.spyOn(built.transport.host, 'query');
    const commandSpy = vi.spyOn(built.transport.host, 'command');
    const user = renderBooking(built);
    const section = await openSection(built.ashfallMatch);

    const suggested = await within(section).findByRole(
      'list',
      { name: 'Suggested storylines' },
      { timeout: LOAD_MS },
    );
    const chip = within(suggested).getByRole('button', {
      name: /^Link Test Ashfall Rivalry\s?, 2 here/,
    });
    expect(within(suggested).queryByRole('button', { name: /Harbour/ })).toBeNull();
    const before = linkQueries(querySpy);
    await user.click(chip);

    const linked = await within(section).findByRole(
      'list',
      { name: 'Linked storylines' },
      { timeout: LOAD_MS },
    );
    expect(within(linked).getByText(ASHFALL)).toBeInTheDocument();
    expect(within(section).queryByRole('list', { name: 'Suggested storylines' })).toBeNull();
    expect(linkQueries(querySpy)).toBeGreaterThan(before);
    expect(commandSpy).toHaveBeenCalledWith('storylines.linkSegment', {
      segmentId: built.ashfallMatch,
      storylineIds: [built.ashfall],
    });

    // The card behind the sheet shows the link, and Save writes the same links back.
    const row = screen.getByRole('article', { name: 'Slot 2: Midcard', hidden: true });
    await within(row).findByText(`Story: ${ASHFALL}`, {}, { timeout: LOAD_MS });
    const editor = screen.getByRole('dialog', { name: /^Slot 2 · / });
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      const saved = commandSpy.mock.calls.find((call) => call[0] === 'booking.updateSegment');
      expect(saved?.[1]).toMatchObject({ draft: { storylineIds: [built.ashfall] } });
    });
  });

  it("shows the engine's refusal under the section", async () => {
    const built = await linkWorld();
    const original = built.transport.host.command.bind(built.transport.host);
    vi.spyOn(built.transport.host, 'command').mockImplementation(async (name, args) => {
      if (name === 'storylines.linkSegment') {
        return {
          revision: 0,
          result: {
            ok: false,
            reasons: [{ code: 'storylines.tooManyLinks', message: 'Test refusal: too many links' }],
          },
        };
      }
      return original(name, args);
    });
    const user = renderBooking(built);
    const section = await openSection(built.ashfallMatch);
    const suggested = await within(section).findByRole(
      'list',
      { name: 'Suggested storylines' },
      { timeout: LOAD_MS },
    );
    await user.click(within(suggested).getByRole('button', { name: /^Link Test Ashfall/ }));
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Test refusal: too many links',
    );
  });

  it('asks before moving a finale here from another segment', async () => {
    const built = await linkWorld();
    await run(built.transport, 'storylines.linkSegment', {
      segmentId: built.ashfallMatch,
      storylineIds: [built.ashfall],
    });
    await run(built.transport, 'storylines.setFinale', {
      storylineId: built.ashfall,
      segmentId: built.ashfallMatch,
    });
    await run(built.transport, 'storylines.linkSegment', {
      segmentId: built.harbourMatch,
      storylineIds: [built.ashfall],
    });
    const commandSpy = vi.spyOn(built.transport.host, 'command');
    const user = renderBooking(built);
    const section = await openSection(built.harbourMatch);

    expect(
      await within(section).findByText(
        'Finale is currently Test Weekly, Slot 2',
        {},
        { timeout: LOAD_MS },
      ),
    ).toBeInTheDocument();
    await user.click(within(section).getByRole('switch', { name: `Finale of ${ASHFALL}` }));
    const confirm = await screen.findByRole('alertdialog', {
      name: `Move the finale of '${ASHFALL}' here from Test Weekly, Slot 2?`,
    });
    expect(commandSpy).not.toHaveBeenCalledWith('storylines.setFinale', expect.anything());
    await user.click(within(confirm).getByRole('button', { name: 'Move finale' }));
    await waitFor(() => {
      expect(commandSpy).toHaveBeenCalledWith('storylines.setFinale', {
        storylineId: built.ashfall,
        segmentId: built.harbourMatch,
      });
    });
    await waitFor(() => {
      expect(within(section).getByRole('switch', { name: `Finale of ${ASHFALL}` })).toBeChecked();
    });
    // The card behind the sheet marks the new finale's slot.
    const row = screen.getByRole('article', { name: /^Slot 3: /, hidden: true });
    await within(row).findByText('Finale', {}, { timeout: LOAD_MS });
    expect(within(row).getByText(`Story: ${ASHFALL}`)).toBeInTheDocument();
  });

  it('asks for a Save before a new segment can be linked', async () => {
    const built = await linkWorld();
    const user = renderBooking(built);
    const row = await screen.findByRole(
      'article',
      { name: 'Slot 4: Midcard' },
      { timeout: LOAD_MS },
    );
    await user.click(within(row).getByRole('button', { name: 'Add match' }));
    const editor = await screen.findByRole('dialog', { name: /^Slot 4 · / });
    const section = await within(editor).findByRole(
      'region',
      { name: 'Storyline' },
      { timeout: LOAD_MS },
    );
    expect(within(section).getByText(SAVE_FIRST_TEXT)).toBeInTheDocument();
    expect(within(section).queryByRole('button')).toBeNull();
  });
});
