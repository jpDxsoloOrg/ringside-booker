/**
 * Popularity gain: how much popularity one competitor gains or loses from one match result, in the
 * show's region (MTCH3-01).
 *
 * ```
 * base      win:  winBase + winGapPerPoint × gap        (gap = strongest beaten − own, gap ≥ 0)
 *                 winBase + winDownGapPerPoint × gap    (gap < 0), never below 0
 *           loss: −(lossBase + lossGapPerPoint × max(0, own − least popular winner))
 *           draw: drawGapPerPoint × (mean opponent − own), within ±drawMax
 *           no contest: 0, and nothing else applies
 * × event size (gain or loss multiplier) × pre-show × finish factor × crowded share
 * → per-match limit → great match (+ classic) → limit → win streak → limit
 * → momentum (gains only) → limit
 * ```
 *
 * The result is the `delta` WRK1's popularity door (`applyPopularityChange`) takes: the door spreads
 * it, tapers gains above the charisma anchor, keeps popularity within 0..100 and rounds. None of
 * that happens here, and nothing here touches morale.
 *
 * Design: docs/design/match-aftermath.md#popularity-gain.
 */

import { constantOf, startCalc, type Calc, type Traced } from '../../../../core/trace';
import type { EventImportance } from '../../../../model/entities/event-definition';
import type { EngineTunables } from '../../../tunables';
import { formatNumber } from '../../../world/people/labels';
import { EVENT_IMPORTANCE_LABELS } from '../../formulas/crowdExpectation';

export const POPULARITY_GAIN_DOC_REF = 'docs/design/match-aftermath.md#popularity-gain';

export const POPULARITY_GAIN_LABEL = 'Popularity change from this match';
export const PER_MATCH_LIMIT_LABEL = 'Per-match limit';
export const WIN_FLOOR_LABEL = 'A win never costs popularity';
export const NO_CONTEST_LABEL = 'No contest';
export const NO_CONTEST_REASON = 'A no contest changes nothing';
export const PRE_SHOW_LABEL = 'Pre-show';
export const NO_FINISH_LABEL = 'No finish chosen';
export const NO_SCORE_LABEL = 'No match score yet';
export const CLASSIC_MATCH_LABEL = 'Classic match';
export const NO_MOMENTUM_LABEL = 'No momentum yet: treated as neutral';
export const NO_OPPONENTS_NOTE = 'No opponents to compare against';

/** How the match ended for this competitor. */
export type PopularityOutcome = 'win' | 'loss' | 'draw' | 'noContest';

/** Another competitor this one is measured against. */
export interface PopularityOpponent {
  readonly name: string;
  /** Their popularity in the show's region, 0..100. */
  readonly popularity: Traced<number>;
}

/** The finish the match ended with, as its popularity factors read it. */
export interface PopularityFinish {
  readonly name: string;
  /** The catalog's winner gain factor (`gains.winner`), 0 or more. */
  readonly winnerFactor: number;
  /** The catalog's loser gain factor (`gains.loser`), 0 or more. */
  readonly loserFactor: number;
}

export interface PopularityGainInputs {
  readonly outcome: PopularityOutcome;
  /** This competitor's popularity in the show's region, 0..100. */
  readonly popularity: Traced<number>;
  /**
   * The other sides' competitors this result is measured against: everyone beaten for a win, the
   * winners for a loss, everyone else for a draw. Unused for a no contest.
   */
  readonly opponents: readonly PopularityOpponent[];
  readonly importance: EventImportance;
  /** The chosen finish, or null when none was chosen. */
  readonly finish: PopularityFinish | null;
  /** Everyone competing in the match, on every side. */
  readonly competitorCount: number;
  /** The segment score 0..100, or null when the match has not been scored. */
  readonly segmentScore: number | null;
  readonly preShow: boolean;
  /** Wins in a row before this match (MTCH3-02); this match is not counted. */
  readonly priorWinStreak: number;
  /** Momentum with the promotion, −100..100, or null before a first appearance. */
  readonly momentum: Traced<number> | null;
}

type ImportanceKey = `match.popularity.importance.${EventImportance}.${'gain' | 'loss'}`;

function importanceKey(importance: EventImportance, gain: boolean): ImportanceKey {
  return `match.popularity.importance.${importance}.${gain ? 'gain' : 'loss'}`;
}

function formulaOptions() {
  return { unit: 'points', docRef: POPULARITY_GAIN_DOC_REF } as const;
}

function pointsText(value: number): string {
  return formatNumber(Math.abs(value));
}

/** The popularity of `opponent` minus `own`, as a traced step. */
function gapTo(
  label: string,
  from: Traced<number>,
  fromLabel: string,
  to: Traced<number>,
  toLabel: string,
): Calc {
  return startCalc(label, from, formulaOptions()).subtract(toLabel, to, fromLabel);
}

/** The opponent with the highest (or lowest) popularity; the first one wins a tie. */
function extremeOpponent(
  opponents: readonly PopularityOpponent[],
  highest: boolean,
): PopularityOpponent | undefined {
  let chosen: PopularityOpponent | undefined;
  for (const opponent of opponents) {
    if (
      chosen === undefined ||
      (highest
        ? opponent.popularity.value > chosen.popularity.value
        : opponent.popularity.value < chosen.popularity.value)
    ) {
      chosen = opponent;
    }
  }
  return chosen;
}

function noOpponentGap(): Traced<number> {
  return constantOf(NO_OPPONENTS_NOTE, 0, 'With nobody to compare against there is no gap');
}

function winBase(inputs: PopularityGainInputs, tunables: EngineTunables): Traced<number> {
  const beaten = extremeOpponent(inputs.opponents, true);
  const gap =
    beaten === undefined
      ? noOpponentGap()
      : gapTo('Popularity gap', beaten.popularity, beaten.name, inputs.popularity, 'You').done();
  let label: string;
  if (beaten === undefined) {
    label = 'Win';
  } else if (gap.value === 0) {
    label = `Beat ${beaten.name}, equally popular`;
  } else {
    label = `Beat ${beaten.name}, ${pointsText(gap.value)} points ${gap.value > 0 ? 'more' : 'less'} popular`;
  }
  const base = startCalc(label, gap, formulaOptions());
  base.multiply(
    'Points per point of gap',
    gap.value >= 0
      ? base.tunable(tunables, 'match.popularity.winGapPerPoint', 'Points per point of gap')
      : base.tunable(
          tunables,
          'match.popularity.winDownGapPerPoint',
          'Points off per point of gap',
        ),
  );
  base.add('Win', base.tunable(tunables, 'match.popularity.winBase', 'A win'));
  return base.done();
}

function lossBase(inputs: PopularityGainInputs, tunables: EngineTunables): Traced<number> {
  const winner = extremeOpponent(inputs.opponents, false);
  const gapCalc =
    winner === undefined
      ? startCalc('Popularity gap', noOpponentGap(), formulaOptions())
      : gapTo('Popularity gap', inputs.popularity, 'You', winner.popularity, winner.name);
  const rawGap = gapCalc.current;
  gapCalc.max(
    'Only a less popular winner costs extra',
    constantOf('No extra cost', 0, 'Losing to a more popular opponent costs only the base'),
  );
  const gap = gapCalc.done();
  let label: string;
  if (winner === undefined) {
    label = 'Loss';
  } else if (rawGap > 0) {
    label = `Lost to ${winner.name}, ${pointsText(rawGap)} points less popular`;
  } else if (rawGap === 0) {
    label = `Lost to ${winner.name}, equally popular`;
  } else {
    label = 'Lost to a more popular opponent';
  }
  const cost = startCalc(label, gap, formulaOptions());
  cost.multiply(
    'Points per point of gap',
    cost.tunable(tunables, 'match.popularity.lossGapPerPoint', 'Points per point of gap'),
  );
  cost.add('Loss', cost.tunable(tunables, 'match.popularity.lossBase', 'A loss'));
  return cost.done();
}

function drawBase(inputs: PopularityGainInputs, tunables: EngineTunables): Traced<number> {
  const count = inputs.opponents.length;
  if (count === 0) {
    return startCalc('Draw', noOpponentGap(), formulaOptions()).done();
  }
  const mean = startCalc('Mean opponent popularity', 0, {
    ...formulaOptions(),
    startLabel: 'Sum',
  });
  for (const opponent of inputs.opponents) {
    mean.add(opponent.name, opponent.popularity);
  }
  mean.divide(`Mean over ${String(count)} ${count === 1 ? 'opponent' : 'opponents'}`, count);
  const meanValue = mean.current;
  const draw = startCalc(
    `Draw against opponents averaging ${formatNumber(meanValue)}`,
    mean.done(),
    formulaOptions(),
  );
  draw.subtract('You', inputs.popularity);
  draw.multiply(
    'Points per point of gap',
    draw.tunable(tunables, 'match.popularity.drawGapPerPoint', 'Points per point of gap'),
  );
  const drawMax = draw.tunable(tunables, 'match.popularity.drawMax', 'Most a draw can move');
  draw.min('Most a draw can gain', drawMax);
  draw.max(
    'Most a draw can cost',
    -draw.tunable(tunables, 'match.popularity.drawMax', 'Most a draw can move'),
  );
  return draw.done();
}

function perMatchLimit(calc: Calc, tunables: EngineTunables): void {
  const maxLoss = calc.tunable(tunables, 'match.popularity.maxLoss', 'Most one match can cost');
  const maxGain = calc.tunable(tunables, 'match.popularity.maxGain', 'Most one match can give');
  calc.clamp(-maxLoss, maxGain, PER_MATCH_LIMIT_LABEL);
}

/** Momentum's factor on a gain; see the module comment. */
function momentumFactor(momentum: Traced<number>, tunables: EngineTunables): Traced<number> {
  const neutral = tunables.get('match.popularity.neutralMomentumAt');
  // A real minus sign, like every other signed label.
  const shown =
    momentum.value < 0 ? `−${pointsText(momentum.value)}` : formatNumber(momentum.value);
  const bottom = (): Traced<number> =>
    constantOf('Bottom of the momentum scale', -100, 'Momentum runs from −100 to +100');
  const top = (): Traced<number> =>
    constantOf('Top of the momentum scale', 100, 'Momentum runs from −100 to +100');

  if (momentum.value < neutral) {
    const span = startCalc('Neutral above the bottom', 0, formulaOptions());
    span.add('Neutral momentum', span.tunable(tunables, 'match.popularity.neutralMomentumAt'));
    span.subtract('Bottom of the momentum scale', bottom());
    const factor = startCalc(`Momentum ${shown}: gains dampened`, momentum, {
      docRef: POPULARITY_GAIN_DOC_REF,
      unit: 'multiplier',
    });
    factor.subtract('Bottom of the momentum scale', bottom());
    factor.divide('Neutral above the bottom', span.done());
    factor.clamp(0, 1, 'Kept between the bottom of the scale and neutral');
    const range = startCalc(
      'Dampening range',
      constantOf('No dampening', 1, 'A factor of 1 leaves the gain unchanged'),
      { unit: 'multiplier' },
    );
    factor.multiply(
      'Dampening range',
      range
        .subtract(
          'Gain at the lowest momentum',
          range.tunable(tunables, 'match.popularity.coldMomentumFactor'),
        )
        .done(),
    );
    factor.add(
      'Gain at the lowest momentum',
      factor.tunable(tunables, 'match.popularity.coldMomentumFactor'),
    );
    return factor.done();
  }

  const room = startCalc('Room above neutral', top(), formulaOptions());
  room.subtract('Neutral momentum', room.tunable(tunables, 'match.popularity.neutralMomentumAt'));
  const label =
    momentum.value === neutral ? `Momentum ${shown}: neutral` : `Momentum ${shown}: on a roll`;
  const factor = startCalc(label, momentum, {
    docRef: POPULARITY_GAIN_DOC_REF,
    unit: 'multiplier',
  });
  factor.subtract(
    'Neutral momentum',
    factor.tunable(tunables, 'match.popularity.neutralMomentumAt'),
  );
  factor.divide('Room above neutral', room.done());
  factor.multiply(
    'Extra gain at the highest momentum',
    factor.tunable(tunables, 'match.popularity.hotMomentumBonus'),
  );
  factor.add('No change', constantOf('No change', 1, 'A factor of 1 leaves the gain unchanged'));
  return factor.done();
}

/**
 * The popularity one competitor gains (positive) or loses (negative) from one match, in the show's
 * region, before WRK1's door spreads, tapers, clamps and rounds it. See the module comment.
 */
export function popularityGain(
  inputs: PopularityGainInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const { outcome } = inputs;

  if (outcome === 'noContest') {
    return startCalc(
      POPULARITY_GAIN_LABEL,
      constantOf(NO_CONTEST_LABEL, 0, NO_CONTEST_REASON),
      formulaOptions(),
    ).done();
  }

  let calc: Calc;
  if (outcome === 'win') {
    calc = startCalc(POPULARITY_GAIN_LABEL, winBase(inputs, tunables), formulaOptions());
    calc.max(WIN_FLOOR_LABEL, constantOf('No loss', 0, 'A win is never worth less than nothing'));
  } else if (outcome === 'loss') {
    calc = startCalc(POPULARITY_GAIN_LABEL, 0, { ...formulaOptions(), startLabel: 'No change' });
    const cost = lossBase(inputs, tunables);
    calc.subtract(cost.trace.label, cost);
  } else {
    calc = startCalc(POPULARITY_GAIN_LABEL, drawBase(inputs, tunables), formulaOptions());
  }

  // Event size: the gain multiplier for a gain (or nothing yet), the loss multiplier for a loss.
  calc.multiply(
    `Event size: ${EVENT_IMPORTANCE_LABELS[inputs.importance]}`,
    calc.tunable(tunables, importanceKey(inputs.importance, calc.current >= 0)),
  );

  if (inputs.preShow) {
    calc.multiply(PRE_SHOW_LABEL, calc.tunable(tunables, 'match.popularity.preShowFactor'));
  }

  if (outcome !== 'draw') {
    if (inputs.finish === null) {
      calc.branch(NO_FINISH_LABEL, true);
    } else {
      calc.multiply(
        `Finish: ${inputs.finish.name}`,
        outcome === 'win' ? inputs.finish.winnerFactor : inputs.finish.loserFactor,
      );
    }
  }

  const crowdedFrom = calc.tunable(tunables, 'match.popularity.crowdedFrom');
  const crowdedLabel = `Crowded match (${String(inputs.competitorCount)} competitors)`;
  if (inputs.competitorCount > crowdedFrom) {
    const share = startCalc('Share in a crowded match', 0, {
      unit: 'multiplier',
      docRef: POPULARITY_GAIN_DOC_REF,
    });
    share.add(
      'Competitors before a match is crowded',
      share.tunable(tunables, 'match.popularity.crowdedFrom'),
    );
    share.divide('Competitors in this match', inputs.competitorCount);
    calc.multiply(crowdedLabel, share.done());
  } else {
    calc.branch(crowdedLabel, false);
  }
  perMatchLimit(calc, tunables);

  // Bonuses, each followed by the per-match limit so no bonus can break it.
  if (inputs.segmentScore === null) {
    calc.branch(NO_SCORE_LABEL, true);
  } else {
    const score = inputs.segmentScore;
    const greatLabel = `Great match (score ${formatNumber(score)})`;
    const greatFrom = calc.tunable(tunables, 'match.popularity.greatMatchFrom');
    if (score >= greatFrom) {
      calc.add(greatLabel, calc.tunable(tunables, 'match.popularity.greatMatchBonus'));
      perMatchLimit(calc, tunables);
    } else {
      calc.branch(greatLabel, false);
    }
    const classicFrom = calc.tunable(tunables, 'match.popularity.classicFrom');
    if (score >= classicFrom) {
      calc.add(CLASSIC_MATCH_LABEL, calc.tunable(tunables, 'match.popularity.classicBonus'));
      perMatchLimit(calc, tunables);
    } else {
      calc.branch(CLASSIC_MATCH_LABEL, false);
    }
  }

  if (outcome === 'win') {
    const streak = inputs.priorWinStreak;
    const streakLabel = `Win streak (${String(streak)} straight before this)`;
    const needed = calc.tunable(tunables, 'match.popularity.streakPriorWins');
    if (streak >= needed) {
      // streakStep × (streak − needed + 1), written without a bare 1: step × (streak − needed) + step.
      const bonus = startCalc(streakLabel, streak, {
        ...formulaOptions(),
        startLabel: 'Wins in a row before this match',
      });
      bonus.subtract(
        'Wins needed for a streak',
        bonus.tunable(tunables, 'match.popularity.streakPriorWins'),
      );
      bonus.multiply(
        'Bonus per streak win',
        bonus.tunable(tunables, 'match.popularity.streakStep'),
      );
      bonus.add(
        'Bonus for reaching a streak',
        bonus.tunable(tunables, 'match.popularity.streakStep'),
      );
      bonus.min('Most a streak can add', bonus.tunable(tunables, 'match.popularity.streakMax'));
      calc.add(streakLabel, bonus.done());
      perMatchLimit(calc, tunables);
    } else {
      calc.branch(streakLabel, false);
    }
  }

  // Momentum shapes gains only. Every factor is 0 or more, so a gain can shrink to 0 but never flip.
  if (calc.current > 0) {
    if (inputs.momentum === null) {
      calc.note(NO_MOMENTUM_LABEL);
    } else {
      const factor = momentumFactor(inputs.momentum, tunables);
      calc.multiply(factor.trace.label, factor);
    }
    perMatchLimit(calc, tunables);
  }

  return calc.done();
}
