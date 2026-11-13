/**
 * Test support (EVT6-06) for the venue panel, the venue picker and the calendar's Crowd section: the
 * booking fake world one day in, so its shows are stored (the player's Test Weekly and the
 * computer's Test Rival Weekly), with no venue chosen yet. It has no real venues, so the picker
 * lists the generic local ones.
 */
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { addDays } from '@ringside/engine';
import type { CalendarShow, EventInstanceId } from '@ringside/engine';
import { EngineProvider } from '@/app/engine/EngineProvider';
import { createInProcessTransport } from '@/app/engine/transport';
import type { InProcessTransport } from '@/app/engine/transport';
import { useSessionStore } from '@/app/session/sessionStore';
import { BOOKING_WORLD_START, bookingFakeState, fakeEngineFactory } from '@/test/fakeEngine';

export interface VenueTestWorld {
  readonly transport: InProcessTransport;
  /** The player's first stored show. */
  readonly ownShow: CalendarShow & { readonly eventInstanceId: EventInstanceId };
  /** The computer's first stored show. */
  readonly rivalShow: CalendarShow & { readonly eventInstanceId: EventInstanceId };
}

function stored(
  show: CalendarShow | undefined,
): (CalendarShow & { readonly eventInstanceId: EventInstanceId }) | null {
  if (show === undefined || show.eventInstanceId === null) return null;
  return { ...show, eventInstanceId: show.eventInstanceId };
}

export async function venueTestWorld(): Promise<VenueTestWorld> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  const install = transport.host.installEngine(bookingFakeState().state);
  useSessionStore.getState().setLoaded({ saveSlotId: null, seat: install.seat });
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  const today = addDays(BOOKING_WORLD_START, 1);
  const range = await transport.host.query('calendar.range', {
    from: addDays(today, 2),
    to: addDays(today, 14),
    scope: 'world',
  });
  if (!range.result.ok) throw new Error('calendar.range was refused.');
  const shows = range.result.data.shows.filter((show) => show.status !== 'projected');
  const ownShow = stored(shows.find((show) => show.isOwn));
  const rivalShow = stored(shows.find((show) => !show.isOwn));
  if (ownShow === null || rivalShow === null) throw new Error('The booking world lacks a show.');
  return { transport, ownShow, rivalShow };
}

export function renderWithEngine(transport: InProcessTransport, ui: ReactNode) {
  return render(<EngineProvider createTransport={() => transport}>{ui}</EngineProvider>);
}
