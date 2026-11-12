import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { parseId } from '@ringside/engine';
import type { BookingCard } from '@ringside/engine';
import { createInProcessTransport } from '@/app/engine/transport';
import { routes } from '@/app/routes';
import { registeredBookingPanels } from '@/screens/booking/registries/bookingPanels';
import { bookingFakeState, fakeEngineFactory } from '@/test/fakeEngine';
import { RAN_BANNER_PANEL } from './bookingPanel';

const SHOW = parseId('eventInstance', 'evi_0000000001');

/** A real card from the booking world's first show, with the status asked for. */
async function cardWithStatus(status: BookingCard['show']['status']): Promise<BookingCard> {
  const transport = createInProcessTransport(fakeEngineFactory(), { progressIntervalMs: 0 });
  transport.host.installEngine(bookingFakeState().state);
  await transport.host.advanceDays({ maxDays: 1 }, () => undefined);
  const shows = await transport.host.query('booking.shows', {});
  if (!shows.result.ok) throw new Error('booking.shows was refused.');
  const eventInstanceId = shows.result.data.rows[0]?.eventInstanceId;
  if (eventInstanceId === undefined) throw new Error('The booking world has no show.');
  const card = await transport.host.query('booking.card', { eventInstanceId });
  if (!card.result.ok) throw new Error('booking.card was refused.');
  return { ...card.result.data, show: { ...card.result.data.show, status } };
}

async function renderPanel(status: BookingCard['show']['status']) {
  const content = RAN_BANNER_PANEL.render({
    eventInstanceId: SHOW,
    card: await cardWithStatus(status),
    validation: null,
  });
  const router = createMemoryRouter([
    { path: '/', element: <>{content}</> },
    { path: routes.game.showResults(SHOW), element: <p>Results page</p> },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

describe('the booking screen’s "This show has run" panel', () => {
  it('is registered as a side panel through the booking feature list', async () => {
    await import('@/screens/booking/sections');
    expect(registeredBookingPanels().map((panel) => panel.id)).toContain('shows.ranBanner');
    expect(RAN_BANNER_PANEL).toMatchObject({ order: 5, placement: 'side' });
  });

  it('says a completed show has run and links to its results', async () => {
    const router = await renderPanel('completed');
    expect(screen.getByText('This show has run')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'See results' }));
    expect(router.state.location.pathname).toBe(routes.game.showResults(SHOW));
  });

  it('draws nothing for a show still to run', async () => {
    for (const status of ['scheduled', 'booked'] as const) {
      expect(
        RAN_BANNER_PANEL.render({
          eventInstanceId: SHOW,
          card: await cardWithStatus(status),
          validation: null,
        }),
      ).toBeNull();
    }
  });
});
