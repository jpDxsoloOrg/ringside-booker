/**
 * Headline popularity: the one number the Office and the top bar show as "the promotion's
 * popularity" (DAY2-02).
 *
 * Popularity is stored per region and rolled up by population (D-03), so a promotion has a value
 * for its home region, its home country, its home continent and the world. The headline is one of
 * those levels, picked by `office.popularity.headlineScope` (the home country by default). There is
 * no other arithmetic: the headline IS that roll-up, so it never disagrees with the Fan base sheet,
 * and its Why? nests the roll-up's own trace (each region with its value and population share).
 * Two notes give the other context (worldwide and the home region), then any lines other features
 * add through the trace sections seam.
 *
 * Not to be confused with ECO1's reach (`finances.md#reach-and-size`), a weighted blend of all
 * four levels that sizes the company. Reach answers "how far does the name carry"; the headline
 * answers "how popular are we", in a number the player can find again on the map.
 *
 * Design: docs/design/office.md#headline-popularity.
 */

import { inputOf, startCalc, type Traced } from '../../../core/trace';
import { fitTraceNode, TRACE_MAX_NODES } from '../../../core/trace/limits';
import type { EngineTunables } from '../../tunables';
import type { HeadlineScope } from '../tunables';

export const HEADLINE_POPULARITY_DOC_REF = 'office.md#headline-popularity';

/** Popularity is a 0..100 scale (a weighted mean can drift past the ends by rounding). */
export const POPULARITY_MIN = 0;
export const POPULARITY_MAX = 100;

/**
 * Trace nodes left for the steps after the main line (the scope, the two notes, the section lines
 * and the clamp). The rest of the 400-node budget goes to the roll-up, so on the shipped map a
 * country's regions always fit and a long world roll-up ends with "N more steps not shown".
 */
export const HEADLINE_TRAIL_NODES = 60;

/** The level the main line sits at: the root, then the main line. */
const MAIN_LINE_DEPTH = 2;

/** A place on the map and the subject's roll-up there, with its trace. */
export interface HeadlinePlace<Id extends string> {
  readonly id: Id;
  readonly name: string;
  readonly rollup: Traced<number>;
}

/** The plain inputs of {@link headlinePopularity}. */
export interface HeadlinePopularityInputs {
  readonly promotionName: string;
  /** The stored value in the home region, 0 when none is stored. */
  readonly homeRegion: { readonly id: string; readonly name: string; readonly value: number };
  readonly homeCountry: HeadlinePlace<string>;
  readonly homeContinent: HeadlinePlace<string>;
  /** The world roll-up, with its trace. */
  readonly world: Traced<number>;
  /** Extra Why? lines (from the trace sections seam), each recorded as a note after the context. */
  readonly sectionLines?: readonly string[];
}

/** A popularity figure as the Why? prints it: one decimal at most ("24.1", "75"). */
export function formatPopularity(value: number): string {
  return String(Math.round(value * 10) / 10);
}

const SCOPE_LABELS: Readonly<Record<HeadlineScope, string>> = {
  homeRegion: 'home region',
  homeCountry: 'home country',
  homeContinent: 'home continent',
  world: 'whole world',
};

/** The chosen level's figure, labelled with its place, ready to be the main line. */
function mainLine(inputs: HeadlinePopularityInputs, scope: HeadlineScope): Traced<number> {
  switch (scope) {
    case 'homeRegion':
      return inputOf(
        `Popularity in ${inputs.homeRegion.name}`,
        inputs.homeRegion.value,
        undefined,
        'points',
      );
    case 'homeCountry':
      return inputs.homeCountry.rollup;
    case 'homeContinent':
      return inputs.homeContinent.rollup;
    case 'world':
      return inputs.world;
  }
}

/** The main line with its trace shortened to fit, the value untouched. */
function fitted(line: Traced<number>): Traced<number> {
  const maxNodes = TRACE_MAX_NODES - HEADLINE_TRAIL_NODES;
  return { value: line.value, trace: fitTraceNode(line.trace, MAIN_LINE_DEPTH, maxNodes).node };
}

/**
 * The promotion's headline popularity: the roll-up level `office.popularity.headlineScope` names,
 * kept within 0..100.
 */
export function headlinePopularity(
  inputs: HeadlinePopularityInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  // Picking the level needs the scope before the calculation starts; the same read is recorded
  // below so the Why? names the tunable.
  const chosen = deps.tunables.get('office.popularity.headlineScope');
  const calc = startCalc(`${inputs.promotionName} popularity`, fitted(mainLine(inputs, chosen)), {
    unit: 'points',
    docRef: HEADLINE_POPULARITY_DOC_REF,
  });
  const scope = calc.tunable(
    deps.tunables,
    'office.popularity.headlineScope',
    'Which popularity the Office shows',
  );
  calc.branch(`Shows popularity in the ${SCOPE_LABELS[scope]}`, true);

  if (scope !== 'world') {
    calc.note(`Worldwide ${formatPopularity(inputs.world.value)}`);
  }
  if (scope !== 'homeRegion') {
    calc.note(`Home region ${inputs.homeRegion.name} ${formatPopularity(inputs.homeRegion.value)}`);
  }
  for (const line of inputs.sectionLines ?? []) {
    calc.note(line);
  }
  return calc.clamp(POPULARITY_MIN, POPULARITY_MAX).done();
}
