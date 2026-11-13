/**
 * The rival results' decision kinds (AIP5), in the rival desk's registry: `winner` for the
 * winners of a rival show and `title` for a title kept or moved. The Decision log filters by them
 * with the chips "Winners" and "Titles". See docs/design/rival-desk.md#decision-log.
 */

import { registerDecisionKind } from '../decisionKinds';

/** A rival show's planned winners. */
export const WINNER_DECISION_KIND = 'winner';
/** A rival title kept or moved. */
export const TITLE_DECISION_KIND = 'title';

registerDecisionKind({ kind: WINNER_DECISION_KIND, chip: 'Winners' });
registerDecisionKind({ kind: TITLE_DECISION_KIND, chip: 'Titles' });
