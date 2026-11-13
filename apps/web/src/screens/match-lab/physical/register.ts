/**
 * Adds the Physical panel to the Match lab (MTCH4-05), at order 30 under the result (after
 * MTCH3's Aftermath at 20), for matches only. Imported once by the lab's lazily loaded view, so the
 * panel ships in the lab's chunk.
 */
import { createElement } from 'react';
import { registerLabPanel } from '../labPanelRegistry';
import { PhysicalPanel } from './PhysicalPanel';

export const PHYSICAL_PANEL_ID = 'match.physical';

export const PHYSICAL_PANEL_TITLE = 'Physical';

registerLabPanel({
  id: PHYSICAL_PANEL_ID,
  title: PHYSICAL_PANEL_TITLE,
  order: 30,
  visible: ({ setup }) => setup.kind === 'match',
  render: ({ simulation, batch }) => createElement(PhysicalPanel, { simulation, batch }),
});
