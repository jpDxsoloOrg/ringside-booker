/**
 * Every Office panel module, imported once by `OfficeScreen.tsx` so the panels register when the
 * Office loads (lazy routes included). A feature adds its panel with one line here, pointing at its
 * own folder (`import '../../<feature>/officePanel';`). Append only; panel modules never import
 * each other, so deleting a line removes that panel and nothing else.
 */
import './worldClockPanel';
import './worldOverviewPanel';
import '../../calendar/officePanel';
import '../../show-results/officePanel';
import '../../promotion-popularity/officePanel';
import '../../roster/officePanel';
