/**
 * Adds the Aftermath panel to the Match lab (MTCH3-04), at order 20 under the result, for matches
 * only. Imported once by the lab's lazily loaded view, so the panel ships in the lab's chunk.
 */
import { createElement } from 'react';
import { registerLabPanel } from '../labPanelRegistry';
import { AftermathPanel } from './AftermathPanel';

export const AFTERMATH_PANEL_ID = 'match.aftermath';

export const AFTERMATH_PANEL_TITLE = 'Aftermath';

registerLabPanel({
  id: AFTERMATH_PANEL_ID,
  title: AFTERMATH_PANEL_TITLE,
  order: 20,
  visible: ({ setup }) => setup.kind === 'match',
  render: ({ simulation }) => createElement(AftermathPanel, { simulation }),
});
