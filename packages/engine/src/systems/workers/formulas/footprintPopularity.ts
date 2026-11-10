/**
 * Footprint popularity: how well known someone is among one promotion's fans.
 *
 * A promotion's fan base is the regions it is known in, each counting by how many of its people
 * follow the promotion (`population × the promotion's popularity there ÷ 100`). The footprint
 * popularity of a subject (a person, or the promotion itself) is the mean of the subject's
 * regional popularity over that fan base. A wrestler who is a star at home and unknown where a
 * promotion runs has a low footprint popularity there, whatever their world figure says.
 *
 * This is the one place a footprint is worked out. Expected push reads it twice (the worker and
 * the promotion itself), and roster columns, fit and morale read the same helper.
 *
 * Design: docs/design/workers.md#expected-push.
 */

import type { RegionId } from '../../../core/ids';
import { startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

/** Popularity per region as people and promotions store it: sparse, a missing region reads as 0. */
export type FootprintRegionalPop = Readonly<Partial<Record<RegionId, number>>>;

/** What the formula reads from a region. */
export interface FootprintRegion {
  readonly id: RegionId;
  readonly name: string;
  readonly population: number;
}

export interface FootprintPopularityInputs {
  /** Whose popularity is being measured: a person's, or the promotion's own. */
  subjectPop: FootprintRegionalPop;
  /** The promotion whose fan base it is measured over. */
  promotionPop: FootprintRegionalPop;
  promotionName: string;
  regions: readonly FootprintRegion[];
}

export const EXPECTED_PUSH_DOC_REF = 'workers.md#expected-push';

/** How many regions a trace lists one by one before the rest are added as a single line. */
export const FOOTPRINT_TRACE_TOP_REGIONS = 5;

export const NO_FANS_NOTE = 'The promotion has no fans yet';

/** One region of a fan base. */
export interface FanBaseRegion {
  readonly region: FootprintRegion;
  /** The promotion's popularity in the region. */
  readonly promotionPop: number;
  /** How much the region counts: `population × promotionPop ÷ 100`. */
  readonly weight: number;
}

/** A promotion's fan base, heaviest region first. */
export interface FanBase {
  readonly members: readonly FanBaseRegion[];
  /** True when no region reached the usual minimum, so every region with any popularity counts. */
  readonly widened: boolean;
}

function compareRegionIds(left: RegionId, right: RegionId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The regions that make up a promotion's fan base: those where its popularity is at least
 * `minPop`, or, when none are, every region where it has any popularity at all. A region nobody
 * lives in has no fans and is left out. The list is empty when the promotion has no fans anywhere.
 * Regions come back heaviest first (ties by ID), so every sum over them runs in one fixed order.
 */
export function fanBaseOf(
  promotionPop: FootprintRegionalPop,
  regions: readonly FootprintRegion[],
  minPop: number,
): FanBase {
  const known: FanBaseRegion[] = [];
  for (const region of regions) {
    const popularity = promotionPop[region.id] ?? 0;
    const weight = (region.population * popularity) / 100;
    if (popularity > 0 && weight > 0) {
      known.push({ region, promotionPop: popularity, weight });
    }
  }
  const qualifying = known.filter((member) => member.promotionPop >= minPop);
  const widened = qualifying.length === 0;
  const members = (widened ? known : qualifying).sort(
    (left, right) =>
      right.weight - left.weight || compareRegionIds(left.region.id, right.region.id),
  );
  return { members, widened };
}

/** The pieces of the weighted mean, summed in the order both the traced and plain paths use. */
interface FootprintSums {
  readonly listed: readonly { readonly member: FanBaseRegion; readonly popularity: number }[];
  readonly restCount: number;
  /** `Σ weight × popularity` of the regions not listed one by one. */
  readonly restWeighted: number;
  readonly totalWeight: number;
}

function footprintSums(subjectPop: FootprintRegionalPop, fanBase: FanBase): FootprintSums {
  const listed = fanBase.members.slice(0, FOOTPRINT_TRACE_TOP_REGIONS).map((member) => ({
    member,
    popularity: subjectPop[member.region.id] ?? 0,
  }));
  const rest = fanBase.members.slice(FOOTPRINT_TRACE_TOP_REGIONS);
  let restWeighted = 0;
  for (const member of rest) {
    restWeighted += member.weight * (subjectPop[member.region.id] ?? 0);
  }
  let totalWeight = 0;
  for (const member of fanBase.members) {
    totalWeight += member.weight;
  }
  return { listed, restCount: rest.length, restWeighted, totalWeight };
}

/** Fans in thousands or millions, for a trace line: "1.2 million", "340 thousand". */
function formatFans(weight: number): string {
  if (weight >= 1_000_000) {
    return `${formatNumber(weight / 1_000_000)} million`;
  }
  if (weight >= 1_000) {
    return `${formatNumber(weight / 1_000)} thousand`;
  }
  return formatNumber(weight);
}

function otherRegionsLabel(count: number): string {
  return count === 1 ? '1 other region' : `${String(count)} other regions`;
}

/**
 * The subject's popularity among the promotion's fans: `Σ weight × subject popularity ÷ Σ weight`
 * over the promotion's fan base ({@link fanBaseOf}). The trace lists the heaviest regions one by
 * one and adds the rest as a single line. A promotion with no fans gives 0, with a note.
 */
export function footprintPopularity(
  inputs: FootprintPopularityInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const calc = startCalc(`Popularity where ${inputs.promotionName} draws`, 0, {
    unit: 'points',
    docRef: EXPECTED_PUSH_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  const minPop = calc.tunable(
    deps.tunables,
    'workers.expectedPush.footprintMinPop',
    'Popularity a region needs to count',
  );
  const fanBase = fanBaseOf(inputs.promotionPop, inputs.regions, minPop);
  if (fanBase.members.length === 0) {
    return calc.note(NO_FANS_NOTE).done();
  }
  const regionCount = fanBase.members.length;
  const regionWord = regionCount === 1 ? 'region' : 'regions';
  calc.note(
    fanBase.widened
      ? `${inputs.promotionName} has not reached ${formatNumber(minPop)} popularity anywhere, so all ${String(regionCount)} ${regionWord} it is known in count`
      : `Fan base: ${String(regionCount)} ${regionWord} where ${inputs.promotionName} has at least ${formatNumber(minPop)} popularity`,
  );
  const sums = footprintSums(inputs.subjectPop, fanBase);
  for (const { member, popularity } of sums.listed) {
    calc.add(
      `${member.region.name}: popularity ${formatNumber(popularity)} × ${formatFans(member.weight)} fans`,
      member.weight * popularity,
    );
  }
  if (sums.restCount > 0) {
    calc.add(otherRegionsLabel(sums.restCount), sums.restWeighted);
  }
  return calc.divide(`All fans: ${formatFans(sums.totalWeight)}`, sums.totalWeight).done();
}

/**
 * {@link footprintPopularity} with no trace, for lists that work it out for a whole roster. The
 * number is the same, added up in the same order.
 */
export function footprintPopularityValue(
  inputs: FootprintPopularityInputs,
  deps: { tunables: EngineTunables },
): number {
  const fanBase = fanBaseOf(
    inputs.promotionPop,
    inputs.regions,
    deps.tunables.get('workers.expectedPush.footprintMinPop'),
  );
  if (fanBase.members.length === 0) {
    return 0;
  }
  const sums = footprintSums(inputs.subjectPop, fanBase);
  let weighted = 0;
  for (const { member, popularity } of sums.listed) {
    weighted += member.weight * popularity;
  }
  if (sums.restCount > 0) {
    weighted += sums.restWeighted;
  }
  return weighted / sums.totalWeight;
}
