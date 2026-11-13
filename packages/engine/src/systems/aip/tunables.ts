/**
 * The rival desk's balance numbers. Each later rival feature (AIP1-03 onwards) adds its keys here.
 * See docs/design/rival-desk.md.
 */

import { defineTunables } from '../../core/tunables/define';
import { cardValueTunables } from './cardValueTunables';
import { needsTunables } from './needsTunables';
import { styleTasteTunables } from './tasteTunables';

const AIP_CATEGORY = 'Rival desk';

export const aipTunables = defineTunables({
  'aip.decisionLogRetentionDays': {
    kind: 'integer',
    default: 365,
    min: 0,
    max: 3650,
    unit: 'days',
    category: AIP_CATEGORY,
    description: 'How long rival decisions stay in the log. 0 keeps none.',
    docRef: 'rival-desk.md#decision-log',
  },
  ...styleTasteTunables(),
  ...cardValueTunables,
  ...needsTunables,
});
