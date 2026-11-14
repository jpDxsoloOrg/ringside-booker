/**
 * A counter-offer's money (ECO5-03): the worker meets you part of the way, a little less each
 * round.
 *
 * Concession `c` = (`contracts.counter.concession` + a roll from 0 to
 * `contracts.counter.concessionSpread`) × max(0, 1 − `contracts.counter.roundDecay` × (round − 1)).
 * The counter is their ask − (ask − your offer) × c, rounded to $100 ($10 for a fee), never above
 * the ask and never below your offer.
 *
 * One counter-offer rolls once (`counterConcession`) and moves the wage, the fee and the signing
 * bonus by the same share, so the counter hangs together.
 *
 * Design: docs/design/negotiation.md#counter.
 */

import type { RngStream } from '../../../core/rng/registry';
import { rollFloat } from '../../../core/rng/rolls';
import { startCalc } from '../../../core/trace/calc';
import { constantOf, inputOf } from '../../../core/trace/helpers';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';
import { HUNDREDS_REASON } from './askingWage';
import { TENS_REASON } from './askingFee';
import { COUNTER_DOC_REF, moneyText, percentText } from './shared';

export interface CounterWageInputs {
  /** What you offered, in cents. */
  readonly offered: number;
  /** What they ask, in cents. */
  readonly asked: number;
  /** The round being answered, 1 for the first offer. */
  readonly round: number;
  /** What the amount is, for the Why?. Left out: "Monthly wage". */
  readonly label?: string;
  /** `tens` for a fee per appearance; else hundreds. */
  readonly quotedIn?: 'hundreds' | 'tens';
  /** The counter-offer's shared concession; left out, one is rolled. */
  readonly concession?: Traced<number>;
}

export interface CounterDeps {
  readonly tunables: EngineTunables;
  readonly rng: RngStream;
}

/** "Meets you 38% of the way". */
export function meetsYouLabel(concession: number): string {
  return `Meets you ${percentText(concession)} of the way`;
}

/** The share of the gap a counter-offer gives up, with its one roll. */
export function counterConcession(round: number, deps: CounterDeps): Traced<number> {
  const { tunables, rng } = deps;
  const base = tunables.get('contracts.counter.concession');
  const spread = tunables.get('contracts.counter.concessionSpread');
  const decay = tunables.get('contracts.counter.roundDecay');
  const roundsIn = Math.max(0, round - 1);
  const roll = rollFloat(rng, 0, spread, 'How far they give way today');
  const expected = (base + roll.value) * Math.max(0, 1 - decay * roundsIn);

  const later = startCalc('Each round gives less', 1, {
    unit: 'multiplier',
    docRef: COUNTER_DOC_REF,
    startLabel: 'First round',
  });
  if (roundsIn > 0) {
    const lost = startCalc(
      'Given up for later rounds',
      inputOf('Rounds before this one', roundsIn, undefined, 'count'),
      { unit: 'ratio' },
    );
    lost.multiply('Less each round', lost.tunable(tunables, 'contracts.counter.roundDecay'));
    later.subtract(`Round ${String(round)}`, lost.done());
    later.max('Never less than nothing', 0);
  }

  const calc = startCalc(meetsYouLabel(expected), 0, {
    unit: 'ratio',
    docRef: COUNTER_DOC_REF,
    startLabel: 'Nothing yet',
  });
  calc.add('Usual give', calc.tunable(tunables, 'contracts.counter.concession'));
  calc.roll(roll.roll);
  calc.add('How far they give way today', roll.value);
  calc.multiply('Each round gives less', later.done());
  return calc.done();
}

const HUNDRED = constantOf('$100', 10_000, HUNDREDS_REASON);
const TEN = constantOf('$10', 1_000, TENS_REASON);

/** One amount of a counter-offer, in whole cents, every step traced. */
export function counterWage(inputs: CounterWageInputs, deps: CounterDeps): Traced<number> {
  const concession = inputs.concession ?? counterConcession(inputs.round, deps);
  const label = inputs.label ?? 'Monthly wage';
  const asked = inputOf(`Their ask: ${moneyText(inputs.asked)}`, inputs.asked, undefined, 'money');
  const offered = inputOf(
    `Your offer: ${moneyText(inputs.offered)}`,
    inputs.offered,
    undefined,
    'money',
  );
  const gap = startCalc('Gap to their ask', asked, { unit: 'money' })
    .subtract('Your offer', offered)
    .done();
  const given = startCalc(concession.trace.label, gap, { unit: 'money' })
    .multiply('Share they give up', concession)
    .done();

  const step = inputs.quotedIn === 'tens' ? TEN : HUNDRED;
  const reason = inputs.quotedIn === 'tens' ? TENS_REASON : HUNDREDS_REASON;
  const calc = startCalc(`Counter-offer: ${label}`, asked, {
    unit: 'money',
    docRef: COUNTER_DOC_REF,
  });
  calc.subtract(concession.trace.label, given);
  calc.divide(step.trace.label, step).round('round', reason).multiply('Back to cents', step);
  calc.min('Never more than their ask', asked);
  calc.max('Never less than your offer', offered);
  return calc.done();
}
