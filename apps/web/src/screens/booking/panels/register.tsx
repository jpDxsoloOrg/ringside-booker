/**
 * Registers the Auto-fill panel (AIP4-07) through the booking screen's feature list
 * (`../sections/index.ts`): a side panel at order 50, under the checklist on desktop and under the
 * card on a phone. No phone summary: the show forecast owns the sticky bar's line.
 */
import { registerBookingPanel } from '../registries/bookingPanels';
import type { BookingPanelDefinition } from '../registries/bookingPanels';
import { AutoFillPanel } from './AutoFillPanel';

export const AUTO_FILL_PANEL: BookingPanelDefinition = {
  id: 'aip.autoFill',
  order: 50,
  placement: 'side',
  title: 'Auto-fill',
  render: ({ eventInstanceId, card }) => (
    <AutoFillPanel key={eventInstanceId} eventInstanceId={eventInstanceId} card={card} />
  ),
};

registerBookingPanel(AUTO_FILL_PANEL);
