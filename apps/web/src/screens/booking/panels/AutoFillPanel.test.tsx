import { act, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, CARD_FULL_MESSAGE, parseId } from '@ringside/engine';
import type { AutoFillResult, BookingCard, EventInstanceId } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { useSessionStore } from '@/app/session/sessionStore';
import { useTracePanelStore } from '@/components/Trace';
import { registeredBookingPanels } from '@/screens/booking/registries/bookingPanels';
import {
  BOOKING_WORLD_START,
  bookingFakeState,
  fakeEngineFactory,
  fakeEngineState,
} from '@/test/fakeEngine';
import { AutoFillPanel, autoFillBlocks, REBOOK_QUESTION } from './AutoFillPanel';
import { AutoFillReasonsSheet, PICK_WINNERS_TEXT } from './AutoFillReasonsSheet';
import { AUTO_FILL_PANEL } from './register';

const LOAD_MS = 10_000;

interface PanelWorld {
  readonly transport: InProcessTransport;
  readonly eventInstanceId: EventInstanceId;
  /** The computer's show, which the player cannot book. */
  readonly rivalShow: EventInstanceId;
  readonly card: BookingCard;
}

async function cardOf(transport: InProcessTransport, id: EventInstanceId): Promise<BookingCard> {
  const { result } = await transport.host.query('booking.card', { eventInstanceId: id });
  if (!result.ok) throw new Error('booking.card was refused.');
  return result.data;
}

/** The booking world a day in: the player's Thursday show stored, its card empty. */
async function panelWorld(): Promise<PanelWorld> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(bookingFakeState().state);
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  const shows = await transport.host.query('booking.shows', {});
  if (!shows.result.ok) throw new Error('booking.shows was refused.');
  const eventInstanceId = shows.result.data.rows[0]?.eventInstanceId;
  if (eventInstanceId === undefined) throw new Error('The booking world has no show.');
  const calendar = await transport.host.query('calendar.range', {
    from: addDays(BOOKING_WORLD_START, 1),
    to: addDays(BOOKING_WORLD_START, 15),
    scope: 'world',
  });
  if (!calendar.result.ok) throw new Error('calendar.range was refused.');
  const rivalShow = calendar.result.data.shows.find((show) => !show.isOwn)?.eventInstanceId;
  if (rivalShow === undefined || rivalShow === null) throw new Error('No rival show stored.');
  return { transport, eventInstanceId, rivalShow, card: await cardOf(transport, eventInstanceId) };
}

function renderPanel(world: PanelWorld, eventInstanceId = world.eventInstanceId) {
  const command = vi.spyOn(world.transport.host, 'command');
  render(
    <EngineProvider createTransport={() => world.transport}>
      <AutoFillPanel eventInstanceId={eventInstanceId} card={world.card} />
    </EngineProvider>,
  );
  return { command, user: userEvent.setup({ delay: null }) };
}

beforeEach(() => {
  useSessionStore.getState().clear();
});

afterEach(() => {
  act(() => {
    useTracePanelStore.setState({ openPanelId: null });
  });
});

describe('the Auto-fill panel', () => {
  it('is registered as a side panel through the booking feature list', async () => {
    await import('@/screens/booking/sections');
    expect(registeredBookingPanels().map((panel) => panel.id)).toContain('aip.autoFill');
    expect(AUTO_FILL_PANEL).toMatchObject({ order: 50, placement: 'side' });
  });

  it('fills the open slots, lists why, and leaves every winner to the player', async () => {
    const world = await panelWorld();
    const { command, user } = renderPanel(world);
    await user.click(screen.getByRole('button', { name: 'Auto-fill empty slots' }));

    expect(command).toHaveBeenCalledWith('aip.autoFillCard', {
      eventInstanceId: world.eventInstanceId,
      keepFilledSlots: true,
    });
    const sheet = await screen.findByRole(
      'dialog',
      { name: /^Filled \d+ slots$/ },
      { timeout: LOAD_MS },
    );
    const filled = within(sheet).getByRole('list', { name: 'Filled slots' });
    const whys = within(filled).getAllByRole('button', { name: /^Why this segment\? Slot / });
    expect(whys.length).toBeGreaterThan(0);
    expect(within(sheet).getByText(PICK_WINNERS_TEXT)).toBeInTheDocument();
    expect(sheet).not.toHaveTextContent(/minute/i);

    const card = await cardOf(world.transport, world.eventInstanceId);
    const segments = card.sections.flatMap((section) =>
      section.slots.flatMap((slot) => (slot.segment === null ? [] : [slot.segment])),
    );
    expect(segments).toHaveLength(whys.length);
    expect(segments.every((segment) => segment.result === null)).toBe(true);

    // Closing the sheet hands focus back to the panel's first button that can be pressed.
    await user.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Auto-fill empty slots' })).toHaveFocus();
  });

  it('asks before rebooking the whole card', async () => {
    const world = await panelWorld();
    const { command, user } = renderPanel(world);
    await user.click(screen.getByRole('button', { name: 'Rebook whole card' }));

    const confirm = screen.getByRole('alertdialog', { name: REBOOK_QUESTION });
    expect(command).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole('button', { name: 'Rebook whole card' }));
    expect(command).toHaveBeenCalledWith('aip.autoFillCard', {
      eventInstanceId: world.eventInstanceId,
      keepFilledSlots: false,
    });
    expect(
      await screen.findByRole('dialog', { name: /^Filled \d+ slots$/ }, { timeout: LOAD_MS }),
    ).toBeInTheDocument();
  });

  it('shows a refusal in the engine’s own words', async () => {
    const world = await panelWorld();
    const { user } = renderPanel(world, world.rivalShow);
    await user.click(screen.getByRole('button', { name: 'Auto-fill empty slots' }));
    expect(await screen.findByRole('alert', {}, { timeout: LOAD_MS })).toHaveTextContent(
      /^Only the person running .+ can book this show$/,
    );
  });
});

describe('autoFillBlocks', () => {
  const open = { segment: null };
  const full = { segment: { segmentId: 'seg_0000000001' } };

  it('blocks both buttons with the engine’s reason when the card cannot change', () => {
    const reason = { code: 'showCompleted', message: 'This show has already run' };
    expect(
      autoFillBlocks({
        canEdit: false,
        editBlock: reason,
        sections: [{ slots: [open] }],
      }),
    ).toEqual({ fill: reason.message, rebook: reason.message });
  });

  it('blocks only filling when every slot is taken', () => {
    expect(
      autoFillBlocks({
        canEdit: true,
        editBlock: null,
        sections: [{ slots: [full] }],
      }),
    ).toEqual({ fill: CARD_FULL_MESSAGE, rebook: null });
    expect(
      autoFillBlocks({
        canEdit: true,
        editBlock: null,
        sections: [{ slots: [full, open] }],
      }),
    ).toEqual({ fill: null, rebook: null });
  });
});

/** The sheet's Why? buttons fetch their breakdown, so they need an engine to ask. */
function renderWithEngine(ui: ReactElement) {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  transport.host.installEngine(fakeEngineState());
  return render(<EngineProvider createTransport={() => transport}>{ui}</EngineProvider>);
}

describe('the reasons sheet', () => {
  const result: AutoFillResult = {
    filled: [
      {
        segmentId: parseId('segment', 'seg_0000000001'),
        preShow: false,
        displayNumber: 6,
        roleLabel: 'Main event',
        label: 'Ace vs Rookie',
        headline: ['Rival Title: due, 34 days since the last defence', 'Card score 71'],
        traceRef: { kind: 'aip.cardSlot', id: 'seg_0000000001' },
      },
    ],
    open: [{ displayNumber: 2, preShow: false, reason: 'No one left who is fit to wrestle' }],
    kept: 1,
    message: null,
  };

  it('lists the filled slots with their reasons and the ones left open', () => {
    renderWithEngine(<AutoFillReasonsSheet open onClose={() => undefined} result={result} />);
    const sheet = screen.getByRole('dialog', { name: 'Filled 1 slot' });
    expect(within(sheet).getByText('Slot 6 · Main event')).toBeInTheDocument();
    expect(within(sheet).getByText('Ace vs Rookie')).toBeInTheDocument();
    expect(within(sheet).getByText('Card score 71')).toBeInTheDocument();
    expect(
      within(sheet).getByRole('button', { name: 'Why this segment? Slot 6 · Main event' }),
    ).toBeInTheDocument();
    const left = within(sheet).getByRole('region', { name: 'Left open' });
    expect(left).toHaveTextContent('Slot 2');
    expect(left).toHaveTextContent('No one left who is fit to wrestle');
  });

  it('gives the planner’s message when nothing could be booked', () => {
    renderWithEngine(
      <AutoFillReasonsSheet
        open
        onClose={() => undefined}
        result={{ filled: [], open: [], kept: 0, message: 'Only 3 wrestlers available, needs 5' }}
      />,
    );
    const sheet = screen.getByRole('dialog', { name: 'Nothing was filled' });
    expect(within(sheet).getByText('Only 3 wrestlers available, needs 5')).toBeInTheDocument();
  });
});
