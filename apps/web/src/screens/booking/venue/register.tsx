/**
 * Registers the "Venue and crowd" panel (EVT6-06) through the booking screen's feature list
 * (`../sections/index.ts`). No phone summary: on a phone the panel sits in the page, and the
 * show forecast owns the sticky bar's line.
 */
import { registerBookingPanel } from '../registries/bookingPanels';
import type { BookingPanelDefinition } from '../registries/bookingPanels';
import { VenueCrowdPanel } from './VenueCrowdPanel';

export const VENUE_CROWD_PANEL: BookingPanelDefinition = {
  id: 'boxOffice.venueCrowd',
  order: 20,
  placement: 'side',
  title: 'Venue and crowd',
  render: ({ eventInstanceId, card }) => (
    <VenueCrowdPanel
      key={eventInstanceId}
      eventInstanceId={eventInstanceId}
      canEdit={card.canEdit}
    />
  ),
};

registerBookingPanel(VENUE_CROWD_PANEL);
