/**
 * Finish effects as rating modifiers (MTCH2-02): one line on the work rate stage and one on the
 * crowd stage of a resolved match, such as "Disqualification finish −4".
 *
 * They apply only when the rating input carries a `resolution` (Simulate, a show night). The lab's
 * Run rates an unresolved match (`resolution` left out or null), so its results do not change.
 * Both sit at `RATING_ORDER.normal`; `runStage` applies every modifier before the stage's soft
 * compression, so the order only places them among other modifiers.
 *
 * `registerFinishModifiers` is called with the built-in raters (`rating/builtins.ts`), so
 * `resetMatchRegistriesForTests` restores them too.
 *
 * Design: docs/design/match-finishes.md#finish-effects.
 */

import type { Calc } from '../../../core/trace';
import { finishOf } from '../../../model/catalogs';
import { finishEffect, finishEffectLabel, type FinishEffectTarget } from '../formulas/finishEffect';
import type { RatingContext } from '../rating/context';
import { RATING_ORDER, registerRatingModifier, type RatingModifier } from '../rating/registry';

export const FINISH_WORK_RATE_MODIFIER_ID = 'match.finishWorkRate';
export const FINISH_CROWD_MODIFIER_ID = 'match.finishCrowd';

/** The note left when the resolution names a finish the catalogs do not hold. */
export function unknownFinishNote(finishKey: string): string {
  return `Finish ${finishKey} is not in the finish catalog: no finish effect`;
}

function appliesToResolvedMatch(ctx: RatingContext): boolean {
  return ctx.segmentKind === 'match' && ctx.input.resolution != null;
}

function applyFinishEffect(calc: Calc, ctx: RatingContext, target: FinishEffectTarget): void {
  const resolution = ctx.input.resolution;
  if (resolution == null) {
    return;
  }
  const finish = finishOf(ctx.read, resolution.finishKey);
  if (finish === undefined) {
    calc.note(unknownFinishNote(resolution.finishKey));
    return;
  }
  const effect = finishEffect(
    {
      target,
      finishName: finish.name,
      catalogPoints: finish.effects[target],
      outcomeKind: resolution.outcome.kind,
    },
    { tunables: ctx.tunables },
  );
  calc.add(finishEffectLabel(finish.name), effect);
}

/** The work rate line. */
export const finishWorkRateModifier: RatingModifier = {
  id: FINISH_WORK_RATE_MODIFIER_ID,
  stage: 'workRate',
  order: RATING_ORDER.normal,
  applies: appliesToResolvedMatch,
  apply: (calc, ctx) => {
    applyFinishEffect(calc, ctx, 'workRate');
  },
};

/** The crowd line. */
export const finishCrowdModifier: RatingModifier = {
  id: FINISH_CROWD_MODIFIER_ID,
  stage: 'crowd',
  order: RATING_ORDER.normal,
  applies: appliesToResolvedMatch,
  apply: (calc, ctx) => {
    applyFinishEffect(calc, ctx, 'crowd');
  },
};

/** Registers both finish modifiers. Returns a function that removes them again. */
export function registerFinishModifiers(): () => void {
  const removers = [finishWorkRateModifier, finishCrowdModifier].map((modifier) =>
    registerRatingModifier(modifier),
  );
  return () => {
    for (const remove of removers) {
      remove();
    }
  };
}
