/**
 * One stage of the rating pipeline: a formula's result, then every rating modifier registered for
 * the stage, then the stage's finish.
 *
 * The stage continues the formula's own trace instead of wrapping it, so a trace already near the
 * depth limit (work rate) loses no level and the Why? panel reads one list: the formula's lines,
 * then one line per modifier, then the finish. Work rate, talk and crowd always go through soft
 * compression. The expectation (0..100), the score (rounded, 0..100), a performance (0..100) and the
 * stars (to their cap, in quarter steps) are already finished by their formulas, so they are only
 * finished again when a modifier ran: an untouched trace gains no lines.
 *
 * Design: docs/design/match-rating.md#pipeline-and-seams.
 */

import { startCalc, traced, type Calc, type Traced } from '../../../core/trace';
import type { NumberTunableKey } from '../../tunables';
import { formatNumber } from '../../world/people/labels';
import { softCompression } from '../formulas/softCompression';
import type { DurationClass } from '../slots';
import type { RatingContext } from './context';
import { ratingModifiersFor } from './registry';
import type { RatingStage, RatingSubject } from './types';

export const PIPELINE_DOC_REF = 'match-rating.md#pipeline-and-seams';

/** The titles the stages give their results. `performance` and `side` keep the formula's own. */
export const RATING_STAGE_LABELS: Readonly<Record<RatingStage, string>> = {
  performance: 'Performance',
  side: 'Side',
  workRate: 'Work rate',
  talk: 'Talk',
  expectation: 'Expected',
  crowd: 'Crowd',
  score: 'Segment score',
  stars: 'Stars',
};

/** The note a `detail` modifier leaves when the rival shortcut skips it. */
export function skippedDetailNote(modifierId: string): string {
  return `Rival shortcut: simple booking inputs, ${modifierId} skipped`;
}

const SCALE_MIN = 0;
const SCALE_MAX = 100;
const QUARTERS_PER_STAR = 4;

const STAR_CAP_KEYS = {
  short: 'match.stars.cap.short',
  standard: 'match.stars.cap.standard',
  long: 'match.stars.cap.long',
} as const satisfies Readonly<Record<DurationClass, NumberTunableKey>>;

/** Stages that keep the formula's title. */
function stageLabel(stage: RatingStage, base: Traced<number>): string {
  if (stage === 'performance' || stage === 'side' || stage === 'talk') {
    return base.trace.label;
  }
  return RATING_STAGE_LABELS[stage];
}

/** Runs every applicable modifier of `stage`. Returns how many added steps. */
function applyModifiers(
  calc: Calc,
  stage: RatingStage,
  ctx: RatingContext,
  subject: RatingSubject | undefined,
): number {
  let applied = 0;
  for (const modifier of ratingModifiersFor(stage)) {
    if (!modifier.applies(ctx, subject)) {
      continue;
    }
    if (modifier.detail === true && ctx.policy.simpleInputs) {
      calc.note(skippedDetailNote(modifier.id));
      continue;
    }
    modifier.apply(calc, ctx, subject);
    applied += 1;
  }
  return applied;
}

/**
 * The finish inside the calc: the expectation and a performance kept between 0 and 100, the score
 * rounded and kept between 0 and 100, the stars kept to their cap in quarter steps. The formulas
 * already finish their own values this way, so it only runs when a modifier added a step.
 */
function finishInCalc(calc: Calc, stage: RatingStage, ctx: RatingContext): void {
  switch (stage) {
    case 'expectation':
    case 'performance':
      calc.clamp(SCALE_MIN, SCALE_MAX);
      return;
    case 'score':
      calc.round('round', 'Rounded to a whole number').clamp(SCALE_MIN, SCALE_MAX);
      return;
    case 'stars': {
      const capKey =
        ctx.segmentKind === 'match' ? STAR_CAP_KEYS[ctx.durationClass] : 'match.stars.cap.angle';
      const cap = calc.tunable(ctx.tunables, capKey, 'Star cap');
      calc
        .clamp(0, cap, `At most ${formatNumber(cap)} stars`)
        .multiply('In quarter stars', QUARTERS_PER_STAR)
        .round('round', 'Nearest quarter star')
        .divide('Back to stars', QUARTERS_PER_STAR);
      return;
    }
    case 'side':
    case 'workRate':
    case 'talk':
    case 'crowd':
      return;
  }
}

/**
 * `staged`'s steps appended to `base`'s own formula under `label`, so the stage adds no trace level.
 * When the stage added nothing, `base` comes back unchanged.
 */
function continueFormula(
  base: Traced<number>,
  staged: Traced<number>,
  label: string,
): Traced<number> {
  const added = staged.trace.kind === 'formula' ? staged.trace.children.slice(1) : [];
  const source = base.trace;
  if (added.length === 0 && source.label === label) {
    return base;
  }
  if (source.kind !== 'formula' || source.children.length === 0) {
    return staged;
  }
  return traced(staged.value, {
    ...source,
    label,
    value: staged.value,
    children: [...source.children, ...added],
  });
}

export interface RunStageOptions {
  /**
   * False skips the soft compression the work rate, talk and crowd stages end with: the beat
   * rater's delivered (MTCH5-03) is a mean of 0-100 beats and its angle score compresses once, at
   * the end. Defaults to true.
   */
  readonly compress?: boolean;
}

/**
 * Runs one stage on `base`: every modifier whose `applies` is true, in order (a `detail` modifier
 * is skipped with a note when the policy asks for simple inputs), then the stage's finish.
 * `subject` is the worker (`performance`) or side (`side`) the stage is about.
 */
export function runStage(
  stage: RatingStage,
  base: Traced<number>,
  ctx: RatingContext,
  subject?: RatingSubject,
  options: RunStageOptions = {},
): Traced<number> {
  const label = stageLabel(stage, base);
  const calc = startCalc(label, base, {
    unit: base.trace.unit ?? 'points',
    docRef: PIPELINE_DOC_REF,
  });
  if (applyModifiers(calc, stage, ctx, subject) > 0) {
    finishInCalc(calc, stage, ctx);
  }
  const staged = continueFormula(base, calc.done(), label);
  const compress = options.compress ?? true;
  if (compress && (stage === 'workRate' || stage === 'talk' || stage === 'crowd')) {
    return softCompression({ value: staged, label }, { tunables: ctx.tunables });
  }
  return staged;
}
