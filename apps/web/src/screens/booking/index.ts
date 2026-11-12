// Registered once, when the app's navigation loads this folder: the calendar's "Book this show"
// action, then every feature's booking panel (the append-only list in sections/index.ts).
import './calendarAction';
import './sections';

export { BookingScreen } from './BookingScreen';
export { BOOKING_PARAMS, bookingShowUrl } from './bookingUrl';
export { useSegmentEditor } from './editor/editorStore';
export type { SegmentEditorRequest } from './editor/editorStore';
export { registerBookingPanel } from './registries/bookingPanels';
export type { BookingPanelContext, BookingPanelDefinition } from './registries/bookingPanels';
