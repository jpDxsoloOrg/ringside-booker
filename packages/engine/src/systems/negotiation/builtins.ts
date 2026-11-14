/**
 * The built-in offer kinds and enforced terms (ECO5-01), registered at module load.
 *
 * - `written`: a monthly wage; needs a reach of `contracts.kind.writtenMinReach`.
 * - `perAppearance`: paid by the show; any promotion may offer it.
 * - `perk.travelCovered`: ECO1's show costs pay the worker's travel.
 * - `perk.ironClad`: ECO4's severance doubles and walk-outs are ruled out.
 *
 * Design: docs/design/negotiation.md#offer-kinds and #enforced-terms.
 */

import { writtenContractShortfall } from './formulas/reachGate';
import { registerEnforcedTerm, registerOfferKind } from './registries';

export const WRITTEN_OFFER_KIND_ORDER = 10;
export const PER_APPEARANCE_OFFER_KIND_ORDER = 20;

registerOfferKind({
  key: 'written',
  label: 'Written contract',
  order: WRITTEN_OFFER_KIND_ORDER,
  samePerWorker: true,
  available: (read, promotionId, _personId, _date, tunables) =>
    writtenContractShortfall(read, promotionId, tunables),
});

registerOfferKind({
  key: 'perAppearance',
  label: 'Per-appearance deal',
  order: PER_APPEARANCE_OFFER_KIND_ORDER,
  samePerWorker: true,
  available: () => [],
});

registerEnforcedTerm({
  term: 'perk.travelCovered',
  label: 'Travel covered',
  enforcedBy: 'Show costs',
});

registerEnforcedTerm({
  term: 'perk.ironClad',
  label: 'Iron-clad',
  enforcedBy: 'Severance and walk-outs',
});
