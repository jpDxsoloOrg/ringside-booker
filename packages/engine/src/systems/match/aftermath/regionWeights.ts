/**
 * Which regions a match's popularity change reaches, and how much of it each gets (D-03, MTCH3-03).
 *
 * - The show's region gets the full change (weight 1): "Show region".
 * - Each of its neighbours (`regions.neighbourRegionIds`) gets `match.popularity.neighbourSpill`:
 *   "Neighbour of <show region>".
 * - Every registered reach provider (`reach.ts`) adds regions at its own weight, with its reason.
 *
 * A region reached from several sources takes the **largest** weight, never the sum: a TV audience
 * in the next region over is the same crowd, not a second one. Weights are kept within 0..1 and a
 * zero weight is dropped. Country and continent figures are never weighted here: they are
 * population-weighted roll-ups of the regions, worked out on read.
 *
 * Design: docs/design/match-aftermath.md#regional-spread.
 */

import type { RegionId } from '../../../core/ids';
import { formatNumber } from '../../world/people/labels';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import { listPopularityReach, type ReachContext } from './reach';

/**
 * Where a region's weight came from: `show`, `neighbour`, or a reach provider's id (always
 * `system.camelName`, so it never clashes with the first two).
 */
export type RegionWeightSource = string;

export const SHOW_REGION_REASON = 'Show region';

/** One region the change reaches, with the source that gave it its weight. */
export interface RegionWeightLine {
  readonly regionId: RegionId;
  readonly name: string;
  /** 0 < weight ≤ 1. */
  readonly weight: number;
  readonly source: RegionWeightSource;
  /** Plain words for the player. */
  readonly reason: string;
}

export interface SegmentRegionWeights {
  /** Region → weight, for the popularity door's `regionWeights`. */
  readonly weights: ReadonlyMap<RegionId, number>;
  /** One line per region in `weights`: the show region first, then by weight, then by name. */
  readonly lines: readonly RegionWeightLine[];
  /** What was adjusted on the way: weights clamped into 0..1, unknown regions left out. */
  readonly notes: readonly string[];
}

const WEIGHT_MIN = 0;
const WEIGHT_MAX = 1;

/** The region weights of one match. Reads only; providers must not write either. */
export function segmentRegionWeights(
  read: GameWorldView,
  ctx: ReachContext,
  tunables: EngineTunables,
): SegmentRegionWeights {
  const regions = read.tables.regions;
  const showRegion = regions.require(ctx.regionId);
  const best = new Map<RegionId, Omit<RegionWeightLine, 'name'>>();
  const notes: string[] = [];

  const offer = (line: Omit<RegionWeightLine, 'name'>): void => {
    if (line.weight <= WEIGHT_MIN) {
      return;
    }
    const current = best.get(line.regionId);
    // Larger weight wins; on a tie the earlier source (show, neighbours, then providers) stays.
    if (current === undefined || line.weight > current.weight) {
      best.set(line.regionId, line);
    }
  };

  offer({
    regionId: showRegion.id,
    weight: WEIGHT_MAX,
    source: 'show',
    reason: SHOW_REGION_REASON,
  });
  const spill = tunables.get('match.popularity.neighbourSpill');
  for (const neighbourId of showRegion.neighbourRegionIds) {
    offer({
      regionId: neighbourId,
      weight: Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, spill)),
      source: 'neighbour',
      reason: `Neighbour of ${showRegion.name}`,
    });
  }
  for (const provider of listPopularityReach()) {
    for (const reached of provider.regionsFor(read, ctx)) {
      if (!regions.has(reached.regionId)) {
        notes.push(`${reached.reason}: ${reached.regionId} is not a region on the map, left out`);
        continue;
      }
      let weight = reached.weight;
      if (!Number.isFinite(weight)) {
        notes.push(`${reached.reason}: a weight that is not a number counts as 0`);
        weight = WEIGHT_MIN;
      } else if (weight < WEIGHT_MIN || weight > WEIGHT_MAX) {
        const clamped = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, weight));
        notes.push(
          `${reached.reason}: a weight of ${formatNumber(weight)} is outside 0 to 1, so ${formatNumber(clamped)} is used`,
        );
        weight = clamped;
      }
      offer({ regionId: reached.regionId, weight, source: provider.id, reason: reached.reason });
    }
  }

  const lines = [...best.values()]
    .map((line): RegionWeightLine => ({ ...line, name: regions.require(line.regionId).name }))
    .sort(
      (left, right) =>
        Number(right.source === 'show') - Number(left.source === 'show') ||
        right.weight - left.weight ||
        (left.name < right.name ? -1 : left.name > right.name ? 1 : 0) ||
        (left.regionId < right.regionId ? -1 : left.regionId > right.regionId ? 1 : 0),
    );
  return {
    weights: new Map(lines.map((line) => [line.regionId, line.weight])),
    lines,
    notes,
  };
}
