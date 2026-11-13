/**
 * The booking screen's feature list: one import per feature that registers a booking panel
 * (`registerBookingPanel`) or, from EVT2-07, a segment editor section. Append a line; never
 * reorder. The booking folder's `index.ts` imports this file once, so everything registered here
 * is in place before the screen draws.
 *
 * Wired: MTCH2's Finish section (EVT2-07).
 *
 * Expected: EVT4's forecast, EVT6's venue and crowd, CRTV8's tournament matches, AIP4's auto-fill.
 */
import '@/screens/show-results/bookingPanel';
import './BookingFinishSection';
import '../venue/register';
