/**
 * Promotion reach: how far a company's name carries, as one smooth number from 0 to 100.
 *
 * Reach is a weighted mean of the promotion's popularity at four levels: its home region, its home
 * country, its home continent and the whole world. The country, continent and world figures come
 * from WRK1's single roll-up (`popularityRollup`), so their traces nest under each line and the
 * Why? drills down to the regions. Reach has no steps: a small popularity move gives a small reach
 * move, so no formula downstream jumps when a company crosses a size threshold.
 *
 * Design: docs/design/finances.md#reach-and-size.
 */

import { inputOf, startCalc, type Traced } from '../../../core/trace';
import { fitTraceNode } from '../../../core/trace/limits';
import type { EngineTunables } from '../../tunables';

export const REACH_DOC_REF = 'finances.md#reach-and-size';

/** The ends of the reach scale. */
export const REACH_MIN = 0;
export const REACH_MAX = 100;

/** The note a reach trace carries when every weight is tuned to 0. */
export const ALL_REACH_WEIGHTS_ZERO_NOTE = 'Every reach weight is 0';

/** One promotion's popularity at the four levels reach is built from. */
export interface PromotionReachInputs {
  /** The stored popularity in the home region, 0 to 100. */
  readonly homeRegion: number;
  /** The roll-up's home country figure, with its trace. */
  readonly homeCountry: Traced<number>;
  /** The roll-up's home continent figure, with its trace. */
  readonly homeContinent: Traced<number>;
  /** The roll-up's world figure, with its trace. */
  readonly world: Traced<number>;
  readonly homeRegionName: string;
  readonly homeCountryName: string;
  readonly homeContinentName: string;
}

/**
 * The most trace nodes each roll-up line may keep. A trace holds at most 400 nodes, and on the
 * shipped map the three roll-up traces together run past that (the world's alone lists every
 * continent and country). Without a share each, the steps after them (the division and the clamp)
 * would be cut from the Why?. A line that does not fit keeps its first steps and ends with an
 * "N more steps not shown" note; the home country's regions always fit.
 */
export const REACH_LEVEL_TRACE_NODES = {
  homeCountry: 80,
  homeContinent: 120,
  world: 150,
} as const;

/** The level a roll-up trace sits at: root, then the level's line, then the roll-up. */
const LEVEL_TRACE_DEPTH = 3;

/** A roll-up figure with its trace shortened to `maxNodes`, the value untouched. */
function fitLevel(level: Traced<number>, maxNodes: number): Traced<number> {
  return { value: level.value, trace: fitTraceNode(level.trace, LEVEL_TRACE_DEPTH, maxNodes).node };
}

type ReachWeightKey =
  | 'finance.reach.weight.homeRegion'
  | 'finance.reach.weight.homeCountry'
  | 'finance.reach.weight.homeContinent'
  | 'finance.reach.weight.world';

interface ReachLevel {
  readonly label: string;
  readonly weightLabel: string;
  readonly popularity: Traced<number>;
  readonly weightKey: ReachWeightKey;
}

/**
 * Reach = (wRegion × home region + wCountry × home country + wContinent × home continent
 * + wWorld × world) ÷ (wRegion + wCountry + wContinent + wWorld), kept within 0..100.
 *
 * The value is exact; screens round it to one decimal. When every weight is 0 the result is 0 with
 * the note {@link ALL_REACH_WEIGHTS_ZERO_NOTE}, never a division by zero.
 */
export function promotionReach(
  inputs: PromotionReachInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const levels: readonly ReachLevel[] = [
    {
      label: `Popularity in ${inputs.homeRegionName}`,
      weightLabel: 'Home region weight',
      popularity: inputOf(
        `Popularity in ${inputs.homeRegionName}`,
        inputs.homeRegion,
        undefined,
        'points',
      ),
      weightKey: 'finance.reach.weight.homeRegion',
    },
    {
      label: `Popularity in ${inputs.homeCountryName}`,
      weightLabel: 'Home country weight',
      popularity: fitLevel(inputs.homeCountry, REACH_LEVEL_TRACE_NODES.homeCountry),
      weightKey: 'finance.reach.weight.homeCountry',
    },
    {
      label: `Popularity in ${inputs.homeContinentName}`,
      weightLabel: 'Home continent weight',
      popularity: fitLevel(inputs.homeContinent, REACH_LEVEL_TRACE_NODES.homeContinent),
      weightKey: 'finance.reach.weight.homeContinent',
    },
    {
      label: 'Popularity worldwide',
      weightLabel: 'World weight',
      popularity: fitLevel(inputs.world, REACH_LEVEL_TRACE_NODES.world),
      weightKey: 'finance.reach.weight.world',
    },
  ];

  const calc = startCalc('Reach', 0, {
    unit: 'points',
    docRef: REACH_DOC_REF,
    startLabel: 'Start',
  });
  const totalWeight = startCalc('Total of the weights', 0, {
    unit: 'ratio',
    startLabel: 'Start',
  });
  for (const level of levels) {
    const part = startCalc(level.label, level.popularity, { unit: 'points' });
    const weight = part.tunable(deps.tunables, level.weightKey, level.weightLabel);
    calc.add(level.label, part.multiply(level.weightLabel, weight).done());
    totalWeight.add(level.weightLabel, weight);
  }

  const total = totalWeight.done();
  if (total.value === 0) {
    // Every part above is 0 × something, so the running value is already 0.
    calc.note(ALL_REACH_WEIGHTS_ZERO_NOTE);
  } else {
    calc.divide('Divided by the total of the weights', total);
  }
  return calc.clamp(REACH_MIN, REACH_MAX).done();
}
