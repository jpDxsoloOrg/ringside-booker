// Shared inputs for the promotion popularity formula tests. Design: docs/design/promotion-popularity.md
import { parseId, type DealId, type NetworkId, type RegionId } from '../../../src/core/ids';
import type { ReachRegionInput } from '../../../src/systems/promoPop';

export function regionId(suffix: string): RegionId {
  return parseId('region', `reg_${suffix.padEnd(10, '0')}`);
}

export function networkId(suffix: string): NetworkId {
  return parseId('network', `net_${suffix.padEnd(10, '0')}`);
}

export function dealId(suffix: string): DealId {
  return parseId('deal', `dea_${suffix.padEnd(10, '0')}`);
}

export function region(suffix: string, name: string): ReachRegionInput {
  return { id: regionId(suffix), name };
}
