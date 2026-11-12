/**
 * Finish effect: what the way a match ended does to its work rate or its crowd (MTCH2-02).
 *
 * ```
 * effect = catalogPoints × match.finish.effectScale
 * crowd only, draws only: effect −= match.finish.drawCrowdPenalty
 * ```
 *
 * `catalogPoints` is the finish's own `effects.workRate` or `effects.crowd` (whole steps, −10..10,
 * from the catalog, so packs can add finishes). Nothing is clamped here: the work rate and crowd
 * stages keep their own finish (soft compression) after every modifier.
 *
 * Design: docs/design/match-finishes.md#finish-effects.
 */

import { startCalc, traced, type Traced } from '../../../core/trace';
import type { FinishOutcomeKind } from '../../../model/catalogs';
import type { EngineTunables } from '../../tunables';

export const FINISH_EFFECTS_DOC_REF = 'match-finishes.md#finish-effects';

/** The step the draw penalty is recorded as. */
export const DRAW_CROWD_PENALTY_LABEL = 'Draw: the crowd wanted a winner';

/** Which part of the rating the effect moves. */
export type FinishEffectTarget = 'workRate' | 'crowd';

export interface FinishEffectInputs {
  readonly target: FinishEffectTarget;
  /** The finish's name, such as "Disqualification". */
  readonly finishName: string;
  /** The finish's catalog effect on `target`. */
  readonly catalogPoints: number;
  readonly outcomeKind: FinishOutcomeKind;
}

const FINISH_SUFFIX = /\bfinish$/i;

/**
 * "Disqualification" → "Disqualification finish": the label of the effect's first step, of its
 * result and of the stage line. A name that already ends in "finish" ("Clean finish") is kept.
 */
export function finishEffectLabel(finishName: string): string {
  return FINISH_SUFFIX.test(finishName) ? finishName : `${finishName} finish`;
}

/**
 * The finish's effect on `target`, in points: the catalog points times the effect scale, less the
 * draw penalty when the target is the crowd and nobody won by a draw.
 */
export function finishEffect(
  inputs: FinishEffectInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const label = finishEffectLabel(inputs.finishName);
  const calc = startCalc(
    label,
    traced(inputs.catalogPoints, {
      kind: 'input',
      label,
      value: inputs.catalogPoints,
      unit: 'points',
      docRef: FINISH_EFFECTS_DOC_REF,
    }),
    { unit: 'points', docRef: FINISH_EFFECTS_DOC_REF },
  );
  calc.multiply(
    'Finish effect scale',
    calc.tunable(deps.tunables, 'match.finish.effectScale', 'Finish effect scale'),
  );
  if (inputs.target === 'crowd' && inputs.outcomeKind === 'draw') {
    calc.subtract(
      DRAW_CROWD_PENALTY_LABEL,
      calc.tunable(deps.tunables, 'match.finish.drawCrowdPenalty', 'Draw crowd penalty'),
    );
  }
  return calc.done();
}
