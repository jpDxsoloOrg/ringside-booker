/**
 * The contract terms the box office honours (ECO5-03): EVT6-05's settlement pays every worker on
 * the card their share of the gate and of the merch (`formulas/workerShare.ts`), so those two
 * shares count in a worker's contract value. A share of TV money waits for ECO2.
 *
 * Design: docs/design/negotiation.md#enforced-terms and box-office.md#worker-shares.
 */

import { registerEnforcedTerm } from '../negotiation/registries';

registerEnforcedTerm({
  term: 'share.gateBp',
  label: 'Share of the gate',
  enforcedBy: 'Box office',
});

registerEnforcedTerm({
  term: 'share.merchBp',
  label: 'Share of merch',
  enforcedBy: 'Box office',
});
