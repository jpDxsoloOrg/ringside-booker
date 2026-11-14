/**
 * Registers the calendar show sheet's "On TV" section (ECO8-07) from the Networks folder, so
 * EVT1's sheet is not edited. Imported once by the router, so it is in place before any calendar
 * draws.
 */
import { registerShowSheetSection } from '@/screens/calendar/registry';
import { ON_TV_SECTION } from './OnTvSection';

registerShowSheetSection(ON_TV_SECTION);
