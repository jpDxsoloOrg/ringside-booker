/**
 * Deal targets and the ratings bonus (ECO8-10): the lines a deal is judged by, in viewers, and what
 * a network pays on top when a deal beats what it expects.
 *
 * - **Targets:** what the network expects, times `broadcast.health.warnBelow` (stay above it to stay
 *   safe), `broadcast.health.cancelBelow` (below it the network may cancel) and
 *   `broadcast.bonus.above` (beat it for a ratings bonus). They are part of the deal the player
 *   signs: the same tunables judge it after every airing.
 * - **Bonus share:** when recent viewers reach the bonus line, each airing pays `broadcast.bonus.atLine`
 *   of the fee, rising in a straight line to `broadcast.bonus.max` at `broadcast.bonus.fullAt` of
 *   what the network expects, and no higher. Pay-per-view pays it on the per-buy money instead.
 * - **Renewal uplift:** a deal that is Exceeding when it is renewed gets
 *   `broadcast.bonus.renewalUplift` more on its fee (its per-buy rate on pay-per-view).
 *
 * Pure: no randomness, no reads of the world.
 *
 * Design: docs/design/broadcast.md#ratings-bonus.
 */

import { constantOf, startCalc, type Traced } from '../../../core/trace';
import type { NetworkKind } from '../../../model/entities/network';
import type { EngineTunables } from '../../tunables';

export const BONUS_DOC_REF = 'broadcast.md#ratings-bonus';

/** The ledger memo (and the Why?'s headline) of a ratings bonus: "Ratings bonus: NSN". */
export function ratingsBonusMemo(networkName: string): string {
  return `Ratings bonus: ${networkName}`;
}

/** One line a deal is judged by: a number of viewers (or buys) and the share of expected it is. */
export interface DealTarget {
  /** Whole viewers (or buys), with its Why?. */
  readonly viewers: Traced<number>;
  /** The share of what the network expects, e.g. 0.75. */
  readonly share: number;
}

/** The three lines a deal is judged by, in viewers. Plain JSON. */
export interface DealTargets {
  /** What the network expects a show in this slot to draw. */
  readonly expected: number;
  /** Stay above this to stay safe (below it the deal is At risk). */
  readonly safe: DealTarget;
  /** Below this the network may cancel at each airing. */
  readonly cancel: DealTarget;
  /** Beat this (recent viewers on average) for a ratings bonus on every airing. */
  readonly bonus: DealTarget;
}

function percentText(share: number): string {
  return `${String(Math.round(share * 100))}%`;
}

/**
 * The deal's targets from what the network expects. `noun` is "viewers" or "buys". Each target is
 * rounded up to a whole viewer, so reaching it exactly is always enough.
 */
export function dealTargets(
  expected: Traced<number>,
  context: { readonly networkName: string; readonly noun: string },
  deps: { readonly tunables: EngineTunables },
): DealTargets {
  const { tunables } = deps;
  const { networkName, noun } = context;
  const line = (
    label: string,
    key: 'broadcast.health.warnBelow' | 'broadcast.health.cancelBelow' | 'broadcast.bonus.above',
  ): DealTarget => {
    const calc = startCalc(label, expected, {
      unit: 'count',
      docRef: BONUS_DOC_REF,
      startLabel: `What ${networkName} expects`,
    });
    const share = calc.tunable(tunables, key);
    calc.multiply(`${percentText(share)} of it`, share).round('ceil', `Whole ${noun}`);
    return { viewers: calc.done(), share };
  };
  return {
    expected: expected.value,
    safe: line('Stay above this to stay safe', 'broadcast.health.warnBelow'),
    cancel: line(`Below this ${networkName} may cancel`, 'broadcast.health.cancelBelow'),
    bonus: line('Beat this for a ratings bonus', 'broadcast.bonus.above'),
  };
}

/**
 * The ratings bonus as a share of the fee (of the per-buy money on pay-per-view), from recent
 * viewers over what the network expects; null when below the bonus line or the bonus is off.
 */
export function ratingsBonusShare(
  ratio: Traced<number>,
  context: { readonly networkName: string },
  deps: { readonly tunables: EngineTunables },
): Traced<number> | null {
  const { tunables } = deps;
  const above = tunables.get('broadcast.bonus.above');
  const max = tunables.get('broadcast.bonus.max');
  if (ratio.value < above || max <= 0) {
    return null;
  }
  const fullAt = tunables.get('broadcast.bonus.fullAt');
  const atLine = Math.min(tunables.get('broadcast.bonus.atLine'), max);
  const span = fullAt - above;

  let climb: Traced<number>;
  if (span > 0) {
    const climbCalc = startCalc('How far past the bonus line', ratio, {
      unit: 'ratio',
      docRef: BONUS_DOC_REF,
      startLabel: `Viewers against what ${context.networkName} expects`,
    });
    climbCalc
      .subtract('The bonus line', climbCalc.tunable(tunables, 'broadcast.bonus.above'))
      .divide(
        `From the line to the cap at ${percentText(fullAt)}`,
        span,
        'The bonus climbs in a straight line to its cap',
      )
      .min('No further than the cap', 1);
    climb = climbCalc.done();
  } else {
    climb = constantOf('How far past the bonus line', 1, 'The cap is reached at the bonus line');
  }

  const calc = startCalc(`Ratings bonus from ${context.networkName}`, atLine, {
    unit: 'ratio',
    docRef: BONUS_DOC_REF,
    startLabel: 'Bonus at the line',
  });
  calc
    .add(
      'Bonus for beating it by more',
      startCalc('Bonus for beating it by more', climb, { unit: 'ratio', docRef: BONUS_DOC_REF })
        .multiply('From the bonus at the line to the cap', max - atLine)
        .done(),
    )
    .min('The cap', calc.tunable(tunables, 'broadcast.bonus.max'));
  return calc.done();
}

/** What a ratings bonus is paid on: the fee, or the per-buy money on pay-per-view. */
export function bonusBaseLabel(kind: NetworkKind): string {
  return kind === 'ppv' ? 'Paid for the buys tonight' : 'Fee per show';
}
