import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initialEngineState, parseContentKey, parseGameDate } from '@ringside/engine';
import type {
  BookingShowRow,
  CommandArgs,
  CommandName,
  PersonId,
  SegmentDraft,
  TeamId,
} from '@ringside/engine';
import { aTeam, worldBuilder } from '@ringside/engine/testing';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { LiveAnnouncer } from '@/app/a11y/LiveAnnouncer';
import { routerFutureFlags, routerProviderFutureFlags } from '@/app/router';
import { useSessionStore } from '@/app/session/sessionStore';
import { BP_MOBILE_QUERY } from '@/styles/breakpoints';
import { BOOKING_WORLD_START, fakeEngineFactory } from '@/test/fakeEngine';
import { setMatchMedia } from '@/test/matchMedia';
import { RUNNING_TIME_WORDS } from '@/test/runningTimeWords';
import { BookingView } from '../BookingView';
import { bookingShowUrl } from '../bookingUrl';
import { registerSegmentEditorSection } from '../registries/segmentEditorSections';
import { useSegmentEditor } from './editorStore';

/** The lazily loaded booking chunk and the engine's first answers can take a moment under load. */
const LOAD_MS = 10_000;

const SINGLES = parseContentKey('match.singles');
const PINFALL = parseContentKey('method.pinfall');
const TAG_TEAM = 'Tag Team · 2 sides · 2 each';
const BATTLE_ROYAL = 'Battle Royal · 6–30 sides · 1 each';

/** Ring names by roster index. Kai and Rex are a team; Tia is hurt but can talk; Rhea holds the title. */
const NAMES = ['Kai Moreno', 'Rex Hale', 'Tia Cruz', 'Rhea Cortez', 'Sam Reed', 'Jo Park'];
const TIA = 2;
const RHEA = 3;

interface EditorWorld {
  readonly transport: InProcessTransport;
  readonly roster: readonly PersonId[];
  readonly team: TeamId;
  readonly show: BookingShowRow;
}

/**
 * The player's promotion with six wrestlers, a team, a held title and a weekly Thursday show (six
 * slots and a pre-show), a day in so the show is stored.
 */
async function editorWorld(): Promise<EditorWorld> {
  const { world, ids } = worldBuilder({
    worldName: 'Test Editor World',
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
            person: (index) =>
              index === TIA
                ? {
                    injury: {
                      kindKey: parseContentKey('injury.test'),
                      bodyPart: 'legs',
                      since: BOOKING_WORLD_START,
                      expectedReturn: parseGameDate('2026-06-01'),
                      canWorkAngles: true,
                    },
                  }
                : {},
            employment: (index) => ({ ringName: NAMES[index] ?? 'Someone' }),
          })
          .withTitle({ name: 'Test Heavyweight Title', prestige: 80 }, { holder: RHEA })
          .withWeeklyShow(
            { name: 'Test Weekly', weekdays: [3] },
            { format: { slots: 6, preShowSlots: 1 } },
          ),
    )
    .with('a team', (context) => {
      const [first, second] = context.ids.people;
      if (first === undefined || second === undefined) throw new Error('No roster.');
      context.insert(
        'teams',
        aTeam({ name: 'The Hale Storm', memberIds: [first, second] }, context.sequence),
      );
    })
    .build();
  const team = ids.teams[0];
  if (team === undefined) throw new Error('The editor world has no team.');

  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(initialEngineState(world));
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const { result } = await transport.host.query('booking.shows', {});
  if (!result.ok) throw new Error('booking.shows was refused.');
  const show = result.data.rows[0];
  if (show === undefined) throw new Error('The editor world has no show.');
  return { transport, roster: ids.people.slice(0, NAMES.length), team, show };
}

function person(built: EditorWorld, index: number): PersonId {
  const id = built.roster[index];
  if (id === undefined) throw new Error(`No roster ${String(index)}.`);
  return id;
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
 * The booking view on its own, without the app shell or the lazily loaded route chunk: the card,
 * its commands and the editor are the real ones, but the DOM every query walks stays small and
 * there is no chunk to wait for. The BookingScreen tests cover the route and the shell.
 */
function renderBooking(built: EditorWorld) {
  const router = createMemoryRouter([{ path: '*', element: <BookingView /> }], {
    initialEntries: [bookingShowUrl(built.show.eventInstanceId)],
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

/** The roster picker's sheet, once it is open ("Add to Side 1", "Add a speaker"). */
async function findPicker(): Promise<HTMLElement> {
  return screen.findByRole('dialog', { name: /^Add (to Side \d+|a speaker)$/ });
}

/** Clicks an add action on a slot's row and waits for the editor. */
async function openNew(
  user: UserEvent,
  slotName: string,
  action: 'Add match' | 'Add talking segment',
  title: string,
): Promise<HTMLElement> {
  const row = await screen.findByRole('article', { name: slotName }, { timeout: LOAD_MS });
  await user.click(within(row).getByRole('button', { name: action }));
  const dialog = await screen.findByRole('dialog', { name: title });
  await within(dialog).findByRole('combobox', { name: /type/ }, { timeout: LOAD_MS });
  return dialog;
}

/** Opens the picker from the nth "Add …" button and picks `name`. */
async function pick(
  user: UserEvent,
  editor: HTMLElement,
  button: string,
  index: number,
  name: RegExp,
): Promise<void> {
  const buttons = within(editor).getAllByRole('button', { name: button });
  const opener = buttons[index];
  if (opener === undefined) throw new Error(`No "${button}" button ${String(index)}.`);
  await user.click(opener);
  const picker = await findPicker();
  await user.click(await within(picker).findByRole('option', { name }, { timeout: LOAD_MS }));
}

async function choose(user: UserEvent, label: string, option: string): Promise<void> {
  const field = screen.getByRole('combobox', { name: label });
  field.focus();
  await user.keyboard('{Enter}');
  await user.click(await screen.findByRole('option', { name: option }));
  await waitFor(() => {
    expect(screen.queryByRole('listbox')).toBeNull();
  });
}

function hasDraft(value: unknown): value is { readonly draft: SegmentDraft } {
  return typeof value === 'object' && value !== null && 'draft' in value;
}

/** The draft the last `booking.addSegment` or `booking.updateSegment` sent. */
function sentDraft(
  spy: { readonly mock: { readonly calls: readonly (readonly unknown[])[] } },
  name: CommandName,
): SegmentDraft | undefined {
  const args = spy.mock.calls.filter((call) => call[0] === name).at(-1)?.[1];
  return hasDraft(args) ? args.draft : undefined;
}

/** The first element, failing the test when there is none. */
function first(elements: readonly HTMLElement[]): HTMLElement {
  const element = elements[0];
  if (element === undefined) throw new Error('Nothing matched.');
  return element;
}

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  useSegmentEditor.getState().close();
  useSessionStore.getState().clear();
  vi.restoreAllMocks();
});

/**
 * A backstop for a heavily loaded machine only: each test takes well under a second on its own
 * (the first one longest, as it warms up every component), but a full parallel run can slow
 * everything several times over.
 */
const TEST_TIMEOUT_MS = 15_000;

describe('SegmentEditorSheet', { timeout: TEST_TIMEOUT_MS }, () => {
  it('books a singles match with a planned winner and saves it in one command', async () => {
    const built = await editorWorld();
    const spy = vi.spyOn(built.transport.host, 'command');
    const user = renderBooking(built);
    const editor = await openNew(user, 'Slot 2: Midcard', 'Add match', 'Slot 2 · Midcard');

    expect(within(editor).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(
      within(editor).getByText('Put someone on at least two sides to save this match.'),
    ).toBeInTheDocument();

    await pick(user, editor, 'Add wrestler', 0, /Kai Moreno/);
    await pick(user, editor, 'Add wrestler', 1, /Rex Hale/);
    await within(editor).findByRole('link', { name: 'Kai Moreno' });
    await user.click(within(editor).getByRole('radio', { name: 'Side 1: Kai Moreno' }));
    expect(within(editor).getByRole('combobox', { name: 'Method' })).toHaveTextContent('Pinfall');
    await user.click(within(editor).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Slot 2 · Midcard' })).toBeNull();
    });
    expect(spy).toHaveBeenCalledWith('booking.addSegment', {
      eventInstanceId: built.show.eventInstanceId,
      preShow: false,
      slot: 1,
      draft: {
        kind: 'match',
        label: null,
        storylineIds: [],
        crew: { refereeId: null, producerId: null, announcerIds: [] },
        participants: [
          { personId: person(built, 0), side: 0, role: 'competitor', teamId: null },
          { personId: person(built, 1), side: 1, role: 'competitor', teamId: null },
        ],
        match: { matchTypeKey: SINGLES, stipulationKeys: [], titleIds: [], finishKey: null },
        outcome: { kind: 'win', winningSide: 0, methodKey: PINFALL },
      },
    });
    const row = await screen.findByRole('article', { name: 'Slot 2: Midcard' });
    await within(row).findByText('Kai Moreno');
    expect(document.body.textContent).not.toMatch(RUNNING_TIME_WORDS);
  });

  it('never lets an injured worker into a match, but lets them talk when the engine says so', async () => {
    const built = await editorWorld();
    const user = renderBooking(built);
    const editor = await openNew(user, 'Slot 2: Midcard', 'Add match', 'Slot 2 · Midcard');

    await user.click(first(within(editor).getAllByRole('button', { name: 'Add wrestler' })));
    const picker = await findPicker();
    await within(picker).findByRole('option', { name: /Kai Moreno/ }, { timeout: LOAD_MS });
    expect(within(picker).queryByRole('option', { name: /Tia Cruz/ })).toBeNull();
    await user.click(within(picker).getByRole('button', { name: 'Bookable only' }));
    const tia = await within(picker).findByRole('option', { name: /Tia Cruz/ });
    expect(tia).toHaveAttribute('aria-disabled', 'true');
    expect(tia).toHaveAccessibleDescription(/^Can't wrestle on this date: /);
    await user.click(tia);
    expect(within(editor).queryByRole('link', { name: 'Tia Cruz' })).toBeNull();
    await user.click(within(picker).getByRole('button', { name: 'Done' }));
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }));

    const promo = await openNew(user, 'Slot 3: Midcard', 'Add talking segment', 'Slot 3 · Midcard');
    await pick(user, promo, 'Add speaker', 0, /Tia Cruz/);
    // A promo takes up to four speakers, so the picker stays open for more.
    await user.click(within(await findPicker()).getByRole('button', { name: 'Done' }));
    expect(await within(promo).findByRole('link', { name: 'Tia Cruz' })).toBeInTheDocument();
    expect(within(promo).getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('adds both members of a team, naming the team and its wrestlers', async () => {
    const built = await editorWorld();
    const spy = vi.spyOn(built.transport.host, 'command');
    const user = renderBooking(built);
    const editor = await openNew(user, 'Slot 2: Midcard', 'Add match', 'Slot 2 · Midcard');

    await choose(user, 'Match type', TAG_TEAM);
    await user.click(first(within(editor).getAllByRole('button', { name: 'Add team' })));
    const picker = within(await findPicker()).getByRole('listbox', { name: 'Teams' });
    await user.click(
      await within(picker).findByRole('option', { name: /The Hale Storm/ }, { timeout: LOAD_MS }),
    );
    expect(await within(editor).findByRole('link', { name: 'Kai Moreno' })).toBeInTheDocument();
    expect(within(editor).getByRole('link', { name: 'Rex Hale' })).toBeInTheDocument();
    expect(
      within(editor).getByRole('radio', { name: 'Side 1: The Hale Storm (Kai Moreno & Rex Hale)' }),
    ).toBeInTheDocument();
    expect(within(editor).getByText('Team: The Hale Storm')).toBeInTheDocument();
    expect(within(editor).getByText('Needs 2 more on this side')).toBeInTheDocument();

    await pick(user, editor, 'Add wrestler', 1, /Rhea Cortez/);
    // Side 2 takes two, so the picker stays open for the second.
    await user.click(within(await findPicker()).getByRole('option', { name: /Sam Reed/ }));
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(sentDraft(spy, 'booking.addSegment')).toBeDefined();
    });
    expect(sentDraft(spy, 'booking.addSegment')?.participants.slice(0, 2)).toEqual([
      { personId: person(built, 0), side: 0, role: 'competitor', teamId: built.team },
      { personId: person(built, 1), side: 0, role: 'competitor', teamId: built.team },
    ]);
  });

  it('puts titles on the line, flags a missing champion and hides titles where they cannot be', async () => {
    const built = await editorWorld();
    const user = renderBooking(built);
    const editor = await openNew(user, 'Slot 2: Midcard', 'Add match', 'Slot 2 · Midcard');

    const titles = within(editor).getByRole('group', { name: 'Titles on the line' });
    const belt = within(titles).getByRole('checkbox', { name: /Test Heavyweight Title/ });
    expect(within(titles).getByText('Rhea Cortez')).toBeInTheDocument();
    await user.click(belt);
    expect(
      within(titles).getByText('Add the champion, Rhea Cortez, to a side'),
    ).toBeInTheDocument();
    await pick(user, editor, 'Add wrestler', 0, /Rhea Cortez/);
    await waitFor(() => {
      expect(within(titles).queryByText('Add the champion, Rhea Cortez, to a side')).toBeNull();
    });

    await choose(user, 'Match type', BATTLE_ROYAL);
    expect(within(editor).queryByRole('group', { name: 'Titles on the line' })).toBeNull();
    expect(
      within(editor).getByText('Battle Royal runs a step longer than its slot'),
    ).toBeInTheDocument();
    expect(within(editor).getAllByRole('button', { name: 'Add wrestler' })).toHaveLength(6);
  });

  it('shows the engine refusal in the sheet, word for word', async () => {
    const built = await editorWorld();
    const user = renderBooking(built);
    const editor = await openNew(user, 'Slot 2: Midcard', 'Add match', 'Slot 2 · Midcard');
    await pick(user, editor, 'Add wrestler', 0, /Kai Moreno/);
    await pick(user, editor, 'Add wrestler', 1, /Rex Hale/);

    // Someone else fills the slot while the sheet is open.
    await command(built.transport, 'booking.addSegment', {
      eventInstanceId: built.show.eventInstanceId,
      preShow: false,
      slot: 1,
      draft: {
        kind: 'angle',
        label: null,
        storylineIds: [],
        crew: { refereeId: null, producerId: null, announcerIds: [] },
        participants: [{ personId: person(built, 4), side: 0, role: 'speaker', teamId: null }],
        angle: { angleTypeKey: parseContentKey('angle.promo') },
      },
    });
    await user.click(within(editor).getByRole('button', { name: 'Save' }));

    const alert = await within(editor).findByRole('alert');
    expect(alert).toHaveTextContent("This segment wasn't saved");
    expect(alert).toHaveTextContent('Slot 2 already has a segment');
    // The draft survived the refetch.
    expect(within(editor).getByRole('link', { name: 'Kai Moreno' })).toBeInTheDocument();
  });

  it('saves what a registered section patches into the draft', async () => {
    cleanups.push(
      registerSegmentEditorSection({
        id: 'test.billing',
        order: 10,
        appliesTo: 'match',
        title: 'Test section',
        render: ({ draft, patch, disabled }) => (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              patch({ label: 'Number one contender' });
            }}
          >
            {`Bill this ${draft.kind}`}
          </button>
        ),
      }),
    );
    const built = await editorWorld();
    const spy = vi.spyOn(built.transport.host, 'command');
    const user = renderBooking(built);
    const editor = await openNew(user, 'Slot 2: Midcard', 'Add match', 'Slot 2 · Midcard');

    const section = within(editor).getByRole('region', { name: 'Test section' });
    await user.click(within(section).getByRole('button', { name: 'Bill this match' }));
    expect(within(editor).getByRole('textbox', { name: 'Billing line' })).toHaveValue(
      'Number one contender',
    );
    await pick(user, editor, 'Add wrestler', 0, /Kai Moreno/);
    await pick(user, editor, 'Add wrestler', 1, /Rex Hale/);
    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(sentDraft(spy, 'booking.addSegment')?.label).toBe('Number one contender');
    });
  });

  it('edits a segment on the card, asks before discarding changes, and removes it', async () => {
    const built = await editorWorld();
    await command(built.transport, 'booking.addSegment', {
      eventInstanceId: built.show.eventInstanceId,
      preShow: false,
      slot: 0,
      draft: {
        kind: 'match',
        label: null,
        storylineIds: [],
        crew: { refereeId: null, producerId: null, announcerIds: [] },
        participants: [
          { personId: person(built, 4), side: 0, role: 'competitor', teamId: null },
          { personId: person(built, 5), side: 1, role: 'competitor', teamId: null },
        ],
        match: { matchTypeKey: SINGLES, stipulationKeys: [], titleIds: [], finishKey: null },
        outcome: null,
      },
    });
    const spy = vi.spyOn(built.transport.host, 'command');
    const user = renderBooking(built);
    const row = await screen.findByRole(
      'article',
      { name: 'Slot 1: Opener' },
      { timeout: LOAD_MS },
    );
    const segmentId = (
      await built.transport.host.query('booking.card', {
        eventInstanceId: built.show.eventInstanceId,
      })
    ).result;
    if (!segmentId.ok) throw new Error('booking.card was refused.');
    const opener = segmentId.data.sections.at(-1)?.slots[0]?.segment?.segmentId;
    if (opener === undefined) throw new Error('No opener.');
    expect(row).toBeInTheDocument();

    useSegmentEditor.getState().openExisting(opener);
    const editor = await screen.findByRole('dialog', { name: 'Slot 1 · Opener' });
    await within(editor).findByRole('link', { name: 'Sam Reed' }, { timeout: LOAD_MS });
    expect(within(editor).queryByRole('group', { name: 'Kind' })).toBeNull();

    await user.click(within(editor).getByRole('radio', { name: 'Draw' }));
    await user.click(within(editor).getByRole('button', { name: 'Cancel' }));
    const discard = await screen.findByRole('alertdialog', { name: 'Discard changes?' });
    await user.click(within(discard).getByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'Slot 1 · Opener' })).toBeInTheDocument();

    await user.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(sentDraft(spy, 'booking.updateSegment')?.kind).toBe('match');
    });
    const updated = sentDraft(spy, 'booking.updateSegment');
    expect(updated?.kind === 'match' && updated.outcome).toEqual({ kind: 'draw' });

    useSegmentEditor.getState().openExisting(opener);
    const again = await screen.findByRole('dialog', { name: 'Slot 1 · Opener' });
    await user.click(await within(again).findByRole('button', { name: 'Remove' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Remove this match?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Slot 1 · Opener' })).toBeNull();
    });
    expect(spy).toHaveBeenCalledWith('booking.removeSegment', { segmentId: opener });
  });

  it('fills a phone screen', async () => {
    setMatchMedia((query) => query === BP_MOBILE_QUERY);
    const built = await editorWorld();
    const user = renderBooking(built);
    const editor = await openNew(user, 'Slot 2: Midcard', 'Add match', 'Slot 2 · Midcard');
    expect(editor).toHaveAttribute('data-side', 'bottom');
    expect(editor).toHaveAttribute('data-phone-height', 'full');
  });
});
