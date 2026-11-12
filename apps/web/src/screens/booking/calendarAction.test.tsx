import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { parseGameDate, parseId } from '@ringside/engine';
import type { CalendarShow } from '@ringside/engine';
import type { ShowSheetContext } from '@/screens/calendar/registry';
import { bookingShowUrl } from './bookingUrl';
import { BOOK_SHOW_ACTION, canOpenInBooking } from './calendarAction';

const TODAY = parseGameDate('2026-04-11');
const SHOW_ID = parseId('eventInstance', 'evi_0000000001');

function show(overrides: Partial<CalendarShow> = {}): CalendarShow {
  return {
    key: SHOW_ID,
    eventInstanceId: SHOW_ID,
    definitionId: null,
    promotion: {
      id: parseId('promotion', 'pro_0000000001'),
      name: 'Test Promotion A',
      shortName: 'TPA',
      color: '#fff',
    },
    isOwn: true,
    brand: null,
    name: 'Test Weekly',
    importance: 'regular',
    format: { slots: 6, preShowSlots: 1 },
    televised: null,
    date: parseGameDate('2026-04-16'),
    airDate: parseGameDate('2026-04-16'),
    status: 'scheduled',
    cancellation: null,
    region: {
      id: parseId('region', 'reg_0000000001'),
      name: 'Test Region',
      countryName: 'Test Country',
    },
    venue: null,
    segmentCount: 0,
    canCancel: true,
    ...overrides,
  };
}

function context(overrides: Partial<CalendarShow> = {}): ShowSheetContext {
  const calendarShow = show(overrides);
  return { show: calendarShow, isOwn: calendarShow.isOwn, today: TODAY };
}

function renderAction(sheetContext: ShowSheetContext) {
  const element: ReactNode = BOOK_SHOW_ACTION.render(sheetContext);
  const router = createMemoryRouter([
    { path: '/', element: <>{element}</> },
    { path: '/game/booking', element: <p>Booking screen</p> },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

describe('the calendar sheet action', () => {
  it('books your own open show and opens Booking on it', async () => {
    const router = renderAction(context());
    await userEvent.setup().click(screen.getByRole('button', { name: 'Book this show' }));
    expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
      bookingShowUrl(SHOW_ID),
    );
  });

  it('says Edit card once something is booked, booked or not', () => {
    renderAction(context({ segmentCount: 3, status: 'booked' }));
    expect(screen.getByRole('button', { name: 'Edit card' })).toBeInTheDocument();
  });

  it('is there for today’s show', () => {
    expect(canOpenInBooking(context({ date: TODAY }))).toBe(true);
  });

  it('is not there for a rival, past, projected, completed or cancelled show', () => {
    expect(canOpenInBooking(context({ isOwn: false }))).toBe(false);
    expect(canOpenInBooking(context({ date: parseGameDate('2026-04-10') }))).toBe(false);
    expect(canOpenInBooking(context({ eventInstanceId: null, status: 'projected' }))).toBe(false);
    expect(canOpenInBooking(context({ status: 'completed' }))).toBe(false);
    expect(canOpenInBooking(context({ status: 'cancelled' }))).toBe(false);

    renderAction(context({ isOwn: false }));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
