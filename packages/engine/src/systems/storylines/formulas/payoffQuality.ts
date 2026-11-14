/**
 * Storyline payoff quality (CRTV4-03): how well a storyline paid off when it ended, from -1 (a
 * cold story that costs its members) to 1 (a hot one at full size), times the finale bonus for a
 * gain whose finale match was played.
 *
 * - **Eligibility:** the storyline needs at least `storylines.payoff.minSegments` counted segments
 *   (its all-time `progressTotals.segments`). Fewer pays nothing: "No payoff (needs 4 linked
 *   segments, has 3)".
 * - **Quality:** `(heat − neutralHeat) ÷ heatSpan`, kept within -1..1.
 * - **Finale:** a positive quality is multiplied by `storylines.payoff.finaleFactor` when the
 *   finale was played. A negative one is never made worse by a finale.
 *
 * No rolls. Design: docs/design/storylines.md#payoff.
 */

import { startCalc } from '../../../core/trace/calc';
import { startDecision } from '../../../core/trace/decision';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';

export const PAYOFF_DOC_REF = 'docs/design/storylines.md#payoff';

/** The two outcomes of ending a storyline: it pays off, or it has too few counted segments. */
export const PAYOFF_OUTCOMES = ['pay', 'noPayoff'] as const;
export type PayoffOutcome = (typeof PAYOFF_OUTCOMES)[number];

export interface PayoffEligibleInputs {
  /** Linked segments that counted for the storyline, all time (`progressTotals.segments`). */
  readonly countedSegments: number;
  readonly storylineName: string;
}

export interface PayoffQualityInputs extends PayoffEligibleInputs {
  /** The storyline's heat when it ends, 0–100. */
  readonly heat: number;
  /** True when the storyline's finale match was played. */
  readonly finalePlayed: boolean;
}

/** "No payoff (needs 4 linked segments, has 3)". */
export function noPayoffText(minSegments: number, countedSegments: number): string {
  const segments = minSegments === 1 ? 'segment' : 'segments';
  return `No payoff (needs ${String(minSegments)} linked ${segments}, has ${String(countedSegments)})`;
}

/** Whether ending the storyline pays off at all: enough counted segments, or none needed. */
export function payoffEligible(
  inputs: PayoffEligibleInputs,
  deps: { tunables: EngineTunables },
): Traced<PayoffOutcome> {
  const decision = startDecision<PayoffOutcome>(`Does '${inputs.storylineName}' pay off?`, {
    docRef: PAYOFF_DOC_REF,
  });
  const minSegments = decision.tunable(
    deps.tunables,
    'storylines.payoff.minSegments',
    'Linked segments needed',
  );
  const enough = inputs.countedSegments >= minSegments;
  decision.rule(
    `At least ${String(minSegments)} counted linked segments (has ${String(inputs.countedSegments)})`,
    enough,
  );
  return enough
    ? decision.choose('pay', `${String(inputs.countedSegments)} linked segments counted`)
    : decision.choose('noPayoff', noPayoffText(minSegments, inputs.countedSegments));
}

/**
 * The payoff's quality: 0 below the segment threshold, else `(heat − neutralHeat) ÷ heatSpan`
 * within -1..1, a gain times `finaleFactor` when the finale was played.
 */
export function payoffQuality(
  inputs: PayoffQualityInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const minSegments = tunables.get('storylines.payoff.minSegments');
  if (inputs.countedSegments < minSegments) {
    const none = startCalc('Payoff strength', 0, {
      unit: 'ratio',
      docRef: PAYOFF_DOC_REF,
      startLabel: 'No payoff',
    }).note(`Storyline: ${inputs.storylineName}`);
    none.tunable(tunables, 'storylines.payoff.minSegments', 'Linked segments needed');
    none.branch(noPayoffText(minSegments, inputs.countedSegments), true);
    return none.done();
  }

  const calc = startCalc('Payoff strength', inputs.heat, {
    unit: 'ratio',
    docRef: PAYOFF_DOC_REF,
    startLabel: 'Heat when it ended',
  }).note(`Storyline: ${inputs.storylineName}`);
  calc.subtract(
    'Neutral heat',
    calc.tunable(tunables, 'storylines.payoff.neutralHeat', 'Heat that pays nothing either way'),
  );
  calc.divide(
    'Heat for a full payoff',
    calc.tunable(
      tunables,
      'storylines.payoff.heatSpan',
      'Heat above or below neutral for full size',
    ),
  );
  calc.clamp(-1, 1, 'Full payoff either way');
  const gain = calc.current > 0;
  calc.branch('Paid off with a finale', inputs.finalePlayed && gain);
  if (inputs.finalePlayed && gain) {
    calc.multiply(
      'Paid off with a finale',
      calc.tunable(tunables, 'storylines.payoff.finaleFactor', 'Finale bonus on a gain'),
    );
  } else if (inputs.finalePlayed) {
    calc.note('A finale never makes a cold payoff worse');
  }
  return calc.done();
}
