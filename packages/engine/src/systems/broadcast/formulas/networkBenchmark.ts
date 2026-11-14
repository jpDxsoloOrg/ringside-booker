/**
 * Network benchmark: what a network expects a show to draw. It is the audience formula run for an
 * imaginary typical promotion for the network's reach tier: the same popularity in every region it
 * covers (`broadcast.benchmark.popularity.tier<N>`), a middling marketing level, taped, no hype,
 * neutral quality and no swing.
 *
 * There is no second formula: valuation compares a promotion's projected audience to this, and
 * deal health compares an airing's real viewers to it, so both sides of every comparison are worked
 * out the same way. Never rolls.
 *
 * Design: docs/design/broadcast.md#benchmark.
 */

import { InvalidArgumentError } from '../../../core/errors';
import { startCalc, type Traced } from '../../../core/trace';
import type { DealTimeslot } from '../../../model/entities/deal';
import type { EventImportance } from '../../../model/entities/event-definition';
import { NETWORK_REACH_TIER_MAX, type NetworkKind } from '../../../model/entities/network';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { audience, type RegionAudienceInput } from './audience';

export const BENCHMARK_DOC_REF = 'broadcast.md#benchmark';

/** A region as the benchmark sees it: its people and interest; the popularity is the reference. */
export type BenchmarkRegionInput = Omit<RegionAudienceInput, 'popularity'>;

export interface NetworkBenchmarkInputs {
  readonly regions: readonly BenchmarkRegionInput[];
  readonly networkName: string;
  /** The network's reach tier, 0 (local) to 4 (global). */
  readonly reachTier: number;
  readonly kind: NetworkKind;
  readonly timeslot: DealTimeslot;
  readonly importance: EventImportance;
}

const REFERENCE_POPULARITY_KEYS = [
  'broadcast.benchmark.popularity.tier0',
  'broadcast.benchmark.popularity.tier1',
  'broadcast.benchmark.popularity.tier2',
  'broadcast.benchmark.popularity.tier3',
  'broadcast.benchmark.popularity.tier4',
] as const satisfies readonly NumberTunableKey[];

/** "What Kestrel Sports expects from a typical promotion for a tier-3 network". */
export function benchmarkLabel(networkName: string, reachTier: number): string {
  return `What ${networkName} expects from a typical promotion for a tier-${String(reachTier)} network`;
}

/** The viewers (or buys) the network expects, a whole number, 0 or more. Deterministic. */
export function networkBenchmark(
  inputs: NetworkBenchmarkInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const popularityKey = Number.isInteger(inputs.reachTier)
    ? REFERENCE_POPULARITY_KEYS[inputs.reachTier]
    : undefined;
  if (popularityKey === undefined) {
    throw new InvalidArgumentError(
      'networkBenchmark',
      'reachTier',
      inputs.reachTier,
      `a whole number from 0 to ${String(NETWORK_REACH_TIER_MAX)}`,
    );
  }
  const popularity = tunables.get(popularityKey);
  const expected = audience(
    {
      regions: inputs.regions.map((region) => ({ ...region, popularity })),
      networkName: inputs.networkName,
      reachTier: inputs.reachTier,
      kind: inputs.kind,
      timeslot: inputs.timeslot,
      live: false,
      importance: inputs.importance,
      marketingLevel: tunables.get('broadcast.benchmark.marketingLevel'),
      hype: null,
      quality: null,
      swing: false,
    },
    { tunables },
  );
  const calc = startCalc(benchmarkLabel(inputs.networkName, inputs.reachTier), expected, {
    unit: 'count',
    docRef: BENCHMARK_DOC_REF,
  });
  // The reference promotion's numbers, read above, recorded as lines so the Why? names them.
  calc.tunable(tunables, popularityKey, 'Popularity of a typical promotion, in every region');
  calc.tunable(
    tunables,
    'broadcast.benchmark.marketingLevel',
    'Marketing level of a typical promotion',
  );
  return calc.done();
}
