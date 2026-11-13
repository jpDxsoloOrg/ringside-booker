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
 *       + match.autoWinner.skillWeight × mean(ring skill)     (MTCH2-09, below)
 *       + match.autoWinner.staminaWeight × match.autoWinner.staminaFactor.<duration class>
 *           × mean(stamina)
 *       − match.autoWinner.fatigueWeight × mean(fatigue)
 *       − match.autoWinner.conditionWeight × mean(wear)
 *       + match.autoWinner.heatWeight × side's storyline heat
 * ```
 *
 * Ring skill is a competitor's mean of `ringwork`, `psychology` and `athleticism`; wear is 100 minus
 * their mean body condition. Fatigue and body condition are read from the person as they stand (WRK6
 * and MTCH4 move them); the side's storyline heat is the hottest storyline linked to the match in
 * which one of the side's competitors is on the face side, the side the crowd is behind (0 with a
 * note when there is none).
 *
 * Means are over the side's competitors. Nothing is clamped. A side with no competitors scores 0;
 * the decision never lets such a side win.
 *
 * Design: docs/design/match-finishes.md#auto-winner.
 */

import type { PersonId } from '../../../core/ids';
import { startCalc, type Calc, type Traced } from '../../../core/trace';
import type { Alignment, Push } from '../../../model/entities/employment';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { DURATION_CLASS_LABELS, type DurationClass } from '../slots';
import { PUSH_LABELS } from '../../workers/formulas/expectedPush';

export const AUTO_WINNER_DOC_REF = 'match-finishes.md#auto-winner';

export const AUTO_WINNER_PUSH_LABEL = 'Push';
export const AUTO_WINNER_MOMENTUM_LABEL = 'Momentum';
export const AUTO_WINNER_ALIGNMENT_LABEL = 'Alignment';
export const NO_MOMENTUM_COUNTS_ZERO_NOTE = 'No momentum yet (counts as 0)';
export const NOT_EMPLOYED_HERE_NOTE = 'Not employed here';
export const NO_COMPETITORS_NOTE = 'Nobody on this side competes';
export const AUTO_WINNER_SKILL_LABEL = 'Ring skill';
export const AUTO_WINNER_STAMINA_LABEL = 'Stamina';
export const AUTO_WINNER_FATIGUE_LABEL = 'Fatigue';
export const AUTO_WINNER_CONDITION_LABEL = 'Body wear';
export const AUTO_WINNER_HEAT_LABEL = 'Storyline heat';
export const NO_STORYLINE_HEAT_NOTE = 'Not the crowd favourite in a storyline here (counts as 0)';

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
  /** In-ring attributes, 0..100 (MTCH2-09). */
  readonly ringwork: number;
  readonly psychology: number;
  readonly athleticism: number;
  readonly stamina: number;
  /** Current fatigue, 0..100. */
  readonly fatigue: number;
  /** Mean body condition over every body part, 0..100 (100 is perfect health). */
  readonly bodyCondition: number;
}

/** The storyline the side is the crowd favourite in, with its heat (MTCH2-09). */
export interface AutoWinnerStorylineHeat {
  readonly storylineName: string;
  /** 0..100. */
  readonly heat: number;
}

export interface AutoWinnerScoreInputs {
  /** "Side 1". */
  readonly sideLabel: string;
  /** The show's region as the player reads it. */
  readonly regionName: string;
  readonly competitors: readonly AutoWinnerCompetitor[];
  /** The match's duration class, for the stamina factor. */
  readonly durationClass: DurationClass;
  /** The side's storyline heat, or null when the side is not the crowd favourite in one. */
  readonly storylineHeat: AutoWinnerStorylineHeat | null;
}

type PushKey = `match.autoWinner.push.${Push}`;
type AlignmentKey = `match.autoWinner.alignment.${Alignment}`;

function pushKey(push: Push): PushKey {
  return `match.autoWinner.push.${push}`;
}

function alignmentKey(alignment: Alignment): AlignmentKey {
  return `match.autoWinner.alignment.${alignment}`;
}

type StaminaFactorKey = `match.autoWinner.staminaFactor.${DurationClass}`;

function staminaFactorKey(durationClass: DurationClass): StaminaFactorKey {
  return `match.autoWinner.staminaFactor.${durationClass}`;
}

/** A competitor's ring skill: the mean of ringwork, psychology and athleticism. */
export function ringSkillOf(
  competitor: Pick<AutoWinnerCompetitor, 'ringwork' | 'psychology' | 'athleticism'>,
): number {
  return (competitor.ringwork + competitor.psychology + competitor.athleticism) / 3;
}

function formatPoints(value: number): string {
  return String(Math.round(value * 10) / 10);
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

  addMatchTerms(score, inputs, tunables);
  return score.done();
}

/** A weighted mean term: `weight × mean`, as its own labelled calculation. */
function weighted(
  label: string,
  mean: Traced<number>,
  weight: { key: NumberTunableKey; label: string },
  tunables: EngineTunables,
): Calc {
  const term = startCalc(label, mean, { unit: 'points', docRef: AUTO_WINNER_DOC_REF });
  return term.multiply(weight.label, term.tunable(tunables, weight.key, weight.label));
}

/**
 * MTCH2-09's terms: how the match would actually go. Ring skill, stamina by the match's length,
 * fatigue, body wear and storyline heat, each one labelled step of the score.
 */
function addMatchTerms(score: Calc, inputs: AutoWinnerScoreInputs, tunables: EngineTunables): void {
  const { competitors, durationClass, storylineHeat } = inputs;

  const skill = meanOf('Mean ring skill', competitors, (calc, competitor) => {
    calc.add(
      `${competitor.name} (ringwork ${formatPoints(competitor.ringwork)}, psychology ${formatPoints(
        competitor.psychology,
      )}, athleticism ${formatPoints(competitor.athleticism)})`,
      ringSkillOf(competitor),
    );
  });
  score.add(
    AUTO_WINNER_SKILL_LABEL,
    weighted(
      AUTO_WINNER_SKILL_LABEL,
      skill,
      { key: 'match.autoWinner.skillWeight', label: 'Ring skill weight' },
      tunables,
    ).done(),
  );

  const stamina = meanOf('Mean stamina', competitors, (calc, competitor) => {
    calc.add(competitor.name, competitor.stamina);
  });
  const staminaTerm = weighted(
    AUTO_WINNER_STAMINA_LABEL,
    stamina,
    { key: 'match.autoWinner.staminaWeight', label: 'Stamina weight' },
    tunables,
  );
  const lengthLabel = `${DURATION_CLASS_LABELS[durationClass]} match`;
  staminaTerm.multiply(
    lengthLabel,
    staminaTerm.tunable(tunables, staminaFactorKey(durationClass), lengthLabel),
  );
  score.add(AUTO_WINNER_STAMINA_LABEL, staminaTerm.done());

  const fatigue = meanOf('Mean fatigue', competitors, (calc, competitor) => {
    calc.add(competitor.name, competitor.fatigue);
  });
  score.subtract(
    AUTO_WINNER_FATIGUE_LABEL,
    weighted(
      AUTO_WINNER_FATIGUE_LABEL,
      fatigue,
      { key: 'match.autoWinner.fatigueWeight', label: 'Fatigue weight' },
      tunables,
    ).done(),
  );

  const wear = meanOf('Mean body wear', competitors, (calc, competitor) => {
    calc.add(
      `${competitor.name} (condition ${formatPoints(competitor.bodyCondition)})`,
      100 - competitor.bodyCondition,
    );
  });
  score.subtract(
    AUTO_WINNER_CONDITION_LABEL,
    weighted(
      AUTO_WINNER_CONDITION_LABEL,
      wear,
      { key: 'match.autoWinner.conditionWeight', label: 'Body wear weight' },
      tunables,
    ).done(),
  );

  const heat = startCalc(
    storylineHeat === null ? 'Storyline heat' : `Heat of ${storylineHeat.storylineName}`,
    storylineHeat?.heat ?? 0,
    { unit: 'points', docRef: AUTO_WINNER_DOC_REF },
  );
  if (storylineHeat === null) {
    heat.note(NO_STORYLINE_HEAT_NOTE);
  }
  heat.multiply(
    'Storyline heat weight',
    heat.tunable(tunables, 'match.autoWinner.heatWeight', 'Storyline heat weight'),
  );
  score.add(AUTO_WINNER_HEAT_LABEL, heat.done());
}
