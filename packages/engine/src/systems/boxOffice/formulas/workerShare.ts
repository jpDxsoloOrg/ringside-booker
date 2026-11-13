/**
 * What workers are owed from a show's ticket or merch money, in cents: each worker whose contract
 * gives them a share of the gate (`terms.shares.gateBp`) or the merch (`merchBp`) gets that many
 * basis points of the gross, and all the shares together are capped at a part of the gross.
 *
 * The cap means shares can never turn takings negative (the reference had no gate cap): net
 * takings go low or negative only through rent. Workers with no share are checked but add no line.
 * Design: docs/design/box-office.md#worker-shares.
 */

import { BASIS_POINTS_PER_WHOLE } from '../../../core/money';
import { constantOf, inputOf, startCalc, type Traced } from '../../../core/trace';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';

export const WORKER_SHARE_DOC_REF = 'box-office.md#worker-shares';

export type WorkerShareSource = 'Gate' | 'Merch';

export interface WorkerShareInputs {
  /** The gross takings the shares are a part of, in cents. */
  readonly gross: number;
  readonly label: WorkerShareSource;
  /** One entry per worker on the show with a contract: ring name and share in basis points. */
  readonly shares: readonly { readonly name: string; readonly bp: number }[];
}

const SOURCE_WORDS: Readonly<Record<WorkerShareSource, string>> = {
  Gate: 'the gate',
  Merch: 'the merch',
};

const CAP_KEYS = {
  Gate: 'boxOffice.gate.workerShareCap',
  Merch: 'boxOffice.merch.workerShareCap',
} as const satisfies Readonly<Record<WorkerShareSource, NumberTunableKey>>;

/** The total owed to workers in whole cents, from 0 up to the cap. Deterministic: no rolls. */
export function computeWorkerShare(
  inputs: WorkerShareInputs,
  deps: { readonly tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const words = SOURCE_WORDS[inputs.label];
  const calc = startCalc(
    `Worker shares of ${words}`,
    constantOf('No shares', 0, 'Nothing is owed until a worker has a share'),
    { unit: 'money', docRef: WORKER_SHARE_DOC_REF },
  );
  for (const share of inputs.shares) {
    if (share.bp <= 0) {
      calc.branch(`${share.name} has a share of ${words}`, false);
      continue;
    }
    const percent = formatNumber(share.bp / (BASIS_POINTS_PER_WHOLE / 100));
    calc.add(
      `${share.name} ${percent}% of ${words}`,
      (inputs.gross * share.bp) / BASIS_POINTS_PER_WHOLE,
    );
  }
  const cap = startCalc(
    'Share cap',
    inputOf(`${inputs.label} takings`, inputs.gross, undefined, 'money'),
    { unit: 'money' },
  );
  cap.multiply(
    'Most shares can take',
    cap.tunable(tunables, CAP_KEYS[inputs.label], 'Most shares can take'),
  );
  calc.min('Share cap', cap.done());
  calc.max('Never below 0', constantOf('Nothing', 0, 'Workers never owe the company here'));
  calc.round('floor', 'Rounded down to whole cents');
  return calc.done();
}
