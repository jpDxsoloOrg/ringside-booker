/**
 * Momentum gain: how much one match result moves one competitor's momentum (MTCH3-02).
 *
 * ```
 * win:   + winBase
 *        + winGapPerPoint × max(0, hottest beaten opponent − own)
 *        + multiSideWinPerExtraSide × (sides − 2)            (more than two sides)
 *        then at most winMax
 * loss:  − lossBase
 *        − lossGapPerPoint × max(0, own − coldest winner)
 *        then at least −lossMax
 *        × max(multiSideLossShare, 2 ÷ sides)                 (more than two sides)
 * draw:  − draw
 * no contest: 0, and nothing else applies
 * then:  + greatMatchBonus when the segment score ≥ greatMatchFrom
 *        kept within ±maxPerSegment
 * ```
 *
 * Momentum is per contract: `momentum` and every opponent's momentum are the ones with the show's
 * promotion. An opponent with no contract there is passed in as 0 ({@link noContractMomentum}).
 * The result is the delta WRK1's `applyMomentumChange` takes; the door starts an empty momentum
 * and keeps the total within −100..100. Decay toward 0 is WRK5's. Morale is never touched here.
 *
 * Design: docs/design/match-aftermath.md#momentum-gain.
 */

import { constantOf, startCalc, type Calc, type Traced } from '../../../../core/trace';
import { formatNumber } from '../../../world/people/labels';
import type { EngineTunables } from '../../../tunables';
import type { MatchResultForSide } from '../history';
// Shared with the popularity gain so both per-match limits read the same in a Why?.
import { PER_MATCH_LIMIT_LABEL } from './popularityGain';

export const MOMENTUM_GAIN_DOC_REF = 'docs/design/match-aftermath.md#momentum-gain';

export const MOMENTUM_GAIN_LABEL = 'Momentum change from this match';
export const NO_CONTEST_MOMENTUM_NOTE = 'A no contest changes nothing';
export const NO_CONTRACT_MOMENTUM_REASON = 'No contract with this promotion: counts as 0';

/** One competitor on another side. */
export interface MomentumOpponent {
  readonly name: string;
  /** Momentum with the show's promotion; {@link noContractMomentum} when there is no contract. */
  readonly momentum: Traced<number>;
  /** True when this opponent's side won the match. Only winners count for a loss's gap. */
  readonly won: boolean;
}

export interface MomentumGainInputs {
  readonly outcome: MatchResultForSide;
  /** Own momentum with the show's promotion, already started when it was empty. */
  readonly momentum: Traced<number>;
  /** The competitors on every other side. */
  readonly opponents: readonly MomentumOpponent[];
  /** How many sides the match had (2 for a singles or tag match). */
  readonly sides: number;
  /** The segment's score (0..100), or null when it was not rated. */
  readonly segmentScore: number | null;
}

/** An opponent's momentum when they have no contract with the show's promotion. */
export function noContractMomentum(name: string): Traced<number> {
  return constantOf(`${name}'s momentum`, 0, NO_CONTRACT_MOMENTUM_REASON);
}

function pickBy(
  opponents: readonly MomentumOpponent[],
  better: (candidate: number, best: number) => boolean,
): MomentumOpponent | null {
  let picked: MomentumOpponent | null = null;
  for (const opponent of opponents) {
    if (picked === null || better(opponent.momentum.value, picked.momentum.value)) {
      picked = opponent;
    }
  }
  return picked;
}

/** `max(0, from − to)` as its own small traced sum, so the Why? shows both momenta. */
function momentumGap(
  label: string,
  from: Traced<number>,
  subtractLabel: string,
  to: Traced<number>,
): Traced<number> {
  return startCalc(label, from, { unit: 'points' })
    .subtract(subtractLabel, to)
    .max(
      'A gap is never below 0',
      constantOf('No gap', 0, 'Only a hotter winner or a colder loser opens a gap'),
    )
    .done();
}

function addWin(calc: Calc, inputs: MomentumGainInputs, tunables: EngineTunables): void {
  calc.add('Win', calc.tunable(tunables, 'match.momentum.winBase', 'Win'));
  const hottest = pickBy(inputs.opponents, (candidate, best) => candidate > best);
  const gap =
    hottest === null
      ? null
      : momentumGap(
          `Momentum gap to ${hottest.name}`,
          hottest.momentum,
          'Own momentum',
          inputs.momentum,
        );
  if (gap === null || gap.value === 0) {
    calc.note('No hotter opponent beaten');
  } else {
    const bonus = startCalc(`Beat a hotter opponent (gap ${formatNumber(gap.value)})`, gap, {
      unit: 'points',
    });
    bonus.multiply(
      'Per point of gap',
      bonus.tunable(tunables, 'match.momentum.winGapPerPoint', 'Per point of gap'),
    );
    calc.add(`Beat a hotter opponent (gap ${formatNumber(gap.value)})`, bonus.done());
  }
  if (inputs.sides > 2) {
    const label = `Won a ${String(inputs.sides)}-way match`;
    const extra = startCalc(
      label,
      constantOf('Sides beyond two', inputs.sides - 2, 'A singles or tag match has two sides'),
      { unit: 'points' },
    );
    extra.multiply(
      'Per extra side',
      extra.tunable(tunables, 'match.momentum.multiSideWinPerExtraSide', 'Per extra side'),
    );
    calc.add(label, extra.done());
  }
  calc.min(
    'Most one win can give',
    calc.tunable(tunables, 'match.momentum.winMax', 'Most one win can give'),
  );
}

function addLoss(calc: Calc, inputs: MomentumGainInputs, tunables: EngineTunables): void {
  calc.subtract('Loss', calc.tunable(tunables, 'match.momentum.lossBase', 'Loss'));
  const winners = inputs.opponents.filter((opponent) => opponent.won);
  const coldest = pickBy(winners, (candidate, best) => candidate < best);
  const gap =
    coldest === null
      ? null
      : momentumGap(
          `Momentum gap to ${coldest.name}`,
          inputs.momentum,
          `${coldest.name}'s momentum`,
          coldest.momentum,
        );
  if (gap === null || gap.value === 0) {
    calc.note('No colder opponent lost to');
  } else {
    const label = `Lost to a colder opponent (gap ${formatNumber(gap.value)})`;
    const penalty = startCalc(label, gap, { unit: 'points' });
    penalty.multiply(
      'Per point of gap',
      penalty.tunable(tunables, 'match.momentum.lossGapPerPoint', 'Per point of gap'),
    );
    calc.subtract(label, penalty.done());
  }
  calc.max(
    'Most one loss can cost',
    -calc.tunable(tunables, 'match.momentum.lossMax', 'Most one loss can cost'),
  );
  if (inputs.sides > 2) {
    const label = `Lost a ${String(inputs.sides)}-way match`;
    const share = startCalc(
      label,
      constantOf(
        'Two sides out of all of them',
        2 / inputs.sides,
        'A loss counts in full in a two-sided match',
      ),
      { unit: 'ratio' },
    );
    share.max(
      'Smallest share of a loss kept',
      share.tunable(tunables, 'match.momentum.multiSideLossShare', 'Smallest share of a loss kept'),
    );
    calc.multiply(label, share.done());
  }
}

function addGreatMatch(calc: Calc, score: number | null, tunables: EngineTunables): void {
  if (score === null) {
    calc.note('Not rated: no great match bonus');
    return;
  }
  const from = calc.tunable(tunables, 'match.momentum.greatMatchFrom', 'Great match from');
  const great = score >= from;
  calc.branch(
    `Match score ${formatNumber(score)} reaches a great match (${formatNumber(from)})`,
    great,
  );
  if (great) {
    calc.add(
      'Great match bonus',
      calc.tunable(tunables, 'match.momentum.greatMatchBonus', 'Great match bonus'),
    );
  }
}

/**
 * The momentum change one match result gives one competitor, in points. Pure: reads only its
 * inputs and the tunables.
 */
export function momentumGain(
  inputs: MomentumGainInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const calc = startCalc(MOMENTUM_GAIN_LABEL, 0, {
    unit: 'points',
    docRef: MOMENTUM_GAIN_DOC_REF,
    startLabel: 'No change yet',
  });
  switch (inputs.outcome) {
    case 'noContest':
      return calc.note(NO_CONTEST_MOMENTUM_NOTE).done();
    case 'win':
      addWin(calc, inputs, tunables);
      break;
    case 'loss':
      addLoss(calc, inputs, tunables);
      break;
    case 'draw':
      calc.subtract('Draw', calc.tunable(tunables, 'match.momentum.draw', 'Draw'));
      break;
  }
  addGreatMatch(calc, inputs.segmentScore, tunables);
  const limit = calc.tunable(tunables, 'match.momentum.maxPerSegment', PER_MATCH_LIMIT_LABEL);
  return calc.clamp(-limit, limit, PER_MATCH_LIMIT_LABEL).done();
}
