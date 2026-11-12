/**
 * Auto-winner score: how strongly a side is favoured to win when nobody booked the winner
 * (MTCH2-03). Rival matches until AIP5 books them, and every match on your shows in Random winners
 * mode, are decided by comparing these scores (`finishes/autoWinner.ts`).
 *
 * ```
 * score = match.autoWinner.popularityWeight × mean(popularityInRegion)
 *       + mean(match.autoWinner.push.<push>)
 *       + match.autoWinner.momentumWeight × mean(momentum ?? 0)
 *       + mean(match.autoWinner.alignment.<alignment>)        (null alignment counts 0)
 * ```
 *
 * Means are over the side's competitors. Nothing is clamped. A side with no competitors scores 0;
 * the decision never lets such a side win.
 *
 * Design: docs/design/match-finishes.md#auto-winner.
 */

import type { PersonId } from '../../../core/ids';
import { startCalc, type Calc, type Traced } from '../../../core/trace';
import type { Alignment, Push } from '../../../model/entities/employment';
import type { EngineTunables } from '../../tunables';
import { PUSH_LABELS } from '../../workers/formulas/expectedPush';

export const AUTO_WINNER_DOC_REF = 'match-finishes.md#auto-winner';

export const AUTO_WINNER_PUSH_LABEL = 'Push';
export const AUTO_WINNER_MOMENTUM_LABEL = 'Momentum';
export const AUTO_WINNER_ALIGNMENT_LABEL = 'Alignment';
export const NO_MOMENTUM_COUNTS_ZERO_NOTE = 'No momentum yet (counts as 0)';
export const NOT_EMPLOYED_HERE_NOTE = 'Not employed here';
export const NO_COMPETITORS_NOTE = 'Nobody on this side competes';

/** "Popularity in Great Lakes". */
export function autoWinnerPopularityLabel(regionName: string): string {
  return `Popularity in ${regionName}`;
}

/** One competitor on a side, as the auto-winner reads them. */
export interface AutoWinnerCompetitor {
  readonly personId: PersonId;
  /** The ring name with the promotion running the show, else the default ring name. */
  readonly name: string;
  /** `regionalPop[regionId]` for the show's region, 0..100; 0 when absent. */
  readonly popularityInRegion: number;
  /** Push with the promotion running the show; `none` when not employed there. */
  readonly push: Push;
  /** Momentum with the promotion; null before a first appearance or when not employed there. */
  readonly momentum: number | null;
  /** Alignment with the promotion; null when not employed there. */
  readonly alignment: Alignment | null;
}

export interface AutoWinnerScoreInputs {
  /** "Side 1". */
  readonly sideLabel: string;
  /** The show's region as the player reads it. */
  readonly regionName: string;
  readonly competitors: readonly AutoWinnerCompetitor[];
}

type PushKey = `match.autoWinner.push.${Push}`;
type AlignmentKey = `match.autoWinner.alignment.${Alignment}`;

function pushKey(push: Push): PushKey {
  return `match.autoWinner.push.${push}`;
}

function alignmentKey(alignment: Alignment): AlignmentKey {
  return `match.autoWinner.alignment.${alignment}`;
}

/**
 * The mean of one value over the side's competitors: each competitor added as a step, then the
 * sum divided by the count. `add` records the competitor's step (and any note before it).
 */
function meanOf(
  label: string,
  competitors: readonly AutoWinnerCompetitor[],
  add: (calc: Calc, competitor: AutoWinnerCompetitor) => void,
): Traced<number> {
  const calc = startCalc(label, 0, {
    startLabel: 'Sum',
    unit: 'points',
    docRef: AUTO_WINNER_DOC_REF,
  });
  for (const competitor of competitors) {
    add(calc, competitor);
  }
  const count = competitors.length;
  calc.divide(`Mean over ${String(count)} ${count === 1 ? 'competitor' : 'competitors'}`, count);
  return calc.done();
}

/**
 * A side's auto-winner score (see the module comment). Each term is one labelled step: "Popularity
 * in <region>", "Push", "Momentum" and "Alignment".
 */
export function autoWinnerScore(
  inputs: AutoWinnerScoreInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const { competitors, regionName } = inputs;
  const score = startCalc(`${inputs.sideLabel} score`, 0, {
    startLabel: 'Starting value',
    unit: 'points',
    docRef: AUTO_WINNER_DOC_REF,
  });
  if (competitors.length === 0) {
    return score.note(NO_COMPETITORS_NOTE).done();
  }

  const popularityLabel = autoWinnerPopularityLabel(regionName);
  const popularity = meanOf(`Mean popularity in ${regionName}`, competitors, (calc, competitor) => {
    calc.add(competitor.name, competitor.popularityInRegion);
  });
  const popularityTerm = startCalc(popularityLabel, popularity, {
    unit: 'points',
    docRef: AUTO_WINNER_DOC_REF,
  });
  popularityTerm.multiply(
    'Popularity weight',
    popularityTerm.tunable(tunables, 'match.autoWinner.popularityWeight', 'Popularity weight'),
  );
  score.add(popularityLabel, popularityTerm.done());

  const push = meanOf('Mean push points', competitors, (calc, competitor) => {
    calc.add(
      `${competitor.name} (${PUSH_LABELS[competitor.push].toLowerCase()})`,
      calc.tunable(tunables, pushKey(competitor.push)),
    );
  });
  score.add(AUTO_WINNER_PUSH_LABEL, push);

  const momentum = meanOf('Mean momentum', competitors, (calc, competitor) => {
    if (competitor.momentum === null) {
      calc.note(`${competitor.name}: ${NO_MOMENTUM_COUNTS_ZERO_NOTE}`);
    }
    calc.add(competitor.name, competitor.momentum ?? 0);
  });
  const momentumTerm = startCalc(AUTO_WINNER_MOMENTUM_LABEL, momentum, {
    unit: 'points',
    docRef: AUTO_WINNER_DOC_REF,
  });
  momentumTerm.multiply(
    'Momentum weight',
    momentumTerm.tunable(tunables, 'match.autoWinner.momentumWeight', 'Momentum weight'),
  );
  score.add(AUTO_WINNER_MOMENTUM_LABEL, momentumTerm.done());

  const alignment = meanOf('Mean alignment points', competitors, (calc, competitor) => {
    if (competitor.alignment === null) {
      calc.note(`${competitor.name}: ${NOT_EMPLOYED_HERE_NOTE}`);
      calc.add(competitor.name, 0);
      return;
    }
    calc.add(
      `${competitor.name} (${competitor.alignment})`,
      calc.tunable(tunables, alignmentKey(competitor.alignment)),
    );
  });
  score.add(AUTO_WINNER_ALIGNMENT_LABEL, alignment);

  return score.done();
}
