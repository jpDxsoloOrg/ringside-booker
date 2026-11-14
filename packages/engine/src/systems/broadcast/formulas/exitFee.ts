/**
 * The exit fee (ECO8-05): what a promotion owes a network for walking away from a deal early.
 * `broadcast.deal.exitFeeShows` shows' worth of what the network pays: the fee per show plus the
 * per-thousand rate on the last airing's viewers (the projected viewers when nothing has aired).
 *
 * Design: docs/design/broadcast.md#commands.
 */

import { inputOf, startCalc, type Traced } from '../../../core/trace';
import type { NetworkKind } from '../../../model/entities/network';
import type { EngineTunables } from '../../tunables';
import { formatViewers } from './audience';

export const EXIT_FEE_DOC_REF = 'broadcast.md#commands';

/** What the exit fee reads. Money in whole cents. */
export interface ExitFeeInputs {
  readonly networkName: string;
  readonly kind: NetworkKind;
  readonly feePerShow: number;
  readonly perThousandViewers: number;
  /** The last airing's viewers (buys on pay-per-view), or the projected ones. */
  readonly viewers: number;
  /** Where `viewers` came from. */
  readonly viewersFrom: 'lastAiring' | 'projected';
}

/** The exit fee in whole cents (0 or more), with its Why?. */
export function exitFee(
  inputs: ExitFeeInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const noun = inputs.kind === 'ppv' ? 'buys' : 'viewers';
  const viewersLabel =
    inputs.viewersFrom === 'lastAiring'
      ? `${formatViewers(inputs.viewers)} ${noun} at the last airing`
      : `${formatViewers(inputs.viewers)} ${noun} expected (nothing has aired yet)`;
  const perThousand = startCalc(
    'Paid for the audience',
    inputOf(viewersLabel, inputs.viewers, undefined, 'count'),
    { unit: 'money', docRef: EXIT_FEE_DOC_REF },
  )
    .divide('Counted in thousands', 1_000)
    .multiply(`Paid per thousand ${noun}`, inputs.perThousandViewers)
    .round('floor', 'Rounded down to the cent')
    .done();
  const calc = startCalc(`Early exit: ${inputs.networkName}`, inputs.feePerShow, {
    unit: 'money',
    docRef: EXIT_FEE_DOC_REF,
    startLabel: 'Fee per show',
  }).add('Paid for the audience', perThousand);
  return calc
    .multiply("Shows' worth owed", calc.tunable(tunables, 'broadcast.deal.exitFeeShows'))
    .round('floor', 'Rounded down to the cent')
    .done();
}
