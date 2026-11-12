/**
 * The rating seams: segment raters and rating modifiers (MTCH1-05).
 *
 * A **rater** turns a rating context into a result, one per segment kind. MTCH1 registers `match`
 * and a simple `angle` rater; MTCH5 swaps in a beat-based angle rater with `{ replace: true }`.
 *
 * A **rating modifier** adds one labelled effect to one stage of the pipeline: finishes (MTCH2),
 * chemistry (MTCH6), stipulations (MTCH7), stakes and heat (MTCH8), morale (SOC3), gimmicks and
 * managers (CRTV7). Modifiers run lowest `order` first, equal orders by id, so packs built in
 * parallel never collide. They can only add calc steps; they never replace the value.
 *
 * Registries are module-level, like `registerSetupStep`: a feature registers from its system
 * module. Tests that register extras call `resetMatchRegistriesForTests()` in `afterEach`.
 *
 * Design: docs/design/match-rating.md#pipeline-and-seams.
 */

import { RegistryError } from '../../../core/errors';
import { PHASE_ID_PATTERN } from '../../../core/pipeline/phase';
import type { Calc } from '../../../core/trace';
import type { RatingContext } from './context';
import {
  RATING_STAGES,
  type RatingStage,
  type RatingSubject,
  type SegmentKind,
  type SegmentRatingResult,
} from './types';

/** Rates one segment. Never writes. */
export type SegmentRater = (ctx: RatingContext) => SegmentRatingResult;

/** Named places in the order range, so features place themselves without guessing. */
export const RATING_ORDER = Object.freeze({ early: 10, normal: 50, late: 90 });

/** Modifier orders run from 1 to 99. */
export const RATING_ORDER_MIN = 1;
export const RATING_ORDER_MAX = 99;

/** One rating effect on one stage. */
export interface RatingModifier {
  /** `system.camelName`, such as `mtch2.finishEffects`. Unique. */
  readonly id: string;
  readonly stage: RatingStage;
  /** 1..99; equal orders run in id order. See `RATING_ORDER`. */
  readonly order: number;
  /**
   * A booking detail the rival shortcut (`policy.simpleInputs`) may skip. Left out: never skipped.
   */
  readonly detail?: boolean;
  /** Whether the effect applies to this segment (and, on `performance` and `side`, this subject). */
  readonly applies: (ctx: RatingContext, subject?: RatingSubject) => boolean;
  /** Adds the effect's steps to the stage's calc. One labelled line is the norm. */
  readonly apply: (calc: Calc, ctx: RatingContext, subject?: RatingSubject) => void;
}

const raters = new Map<SegmentKind, SegmentRater>();
const modifiers = new Map<string, RatingModifier>();

function isSegmentKind(kind: string): kind is SegmentKind {
  return kind === 'match' || kind === 'angle';
}

/**
 * Registers the rater for a segment kind. Replacing a registered kind needs `{ replace: true }`.
 * Returns a function that undoes the registration, restoring the rater it replaced.
 *
 * @throws RegistryError for an unknown kind, or a kind that already has a rater without `replace`.
 */
export function registerSegmentRater(
  kind: SegmentKind,
  rater: SegmentRater,
  options: { replace?: boolean } = {},
): () => void {
  if (!isSegmentKind(kind)) {
    throw new RegistryError(`Segment rater: unknown segment kind "${String(kind)}"`, {
      kind: String(kind),
    });
  }
  const previous = raters.get(kind);
  if (previous !== undefined && options.replace !== true) {
    throw new RegistryError(
      `Segment rater "${kind}": a rater is already registered; pass { replace: true } to swap it`,
      { kind },
    );
  }
  raters.set(kind, rater);
  return () => {
    if (raters.get(kind) !== rater) {
      return;
    }
    if (previous === undefined) {
      raters.delete(kind);
    } else {
      raters.set(kind, previous);
    }
  };
}

/** The rater for a segment kind, or undefined when none is registered. */
export function segmentRaterFor(kind: SegmentKind): SegmentRater | undefined {
  return raters.get(kind);
}

/**
 * Adds a rating modifier. Returns a function that removes it again.
 *
 * @throws RegistryError for a malformed id, an unknown stage, an order outside 1..99, or an id that
 *   is already registered.
 */
export function registerRatingModifier(modifier: RatingModifier): () => void {
  const fail = (message: string): never => {
    throw new RegistryError(`Rating modifier "${modifier.id}": ${message}`, {
      modifier: modifier.id,
    });
  };
  if (!PHASE_ID_PATTERN.test(modifier.id)) {
    fail('the id must look like "system.camelName", for example "mtch2.finishEffects"');
  }
  if (!RATING_STAGES.includes(modifier.stage)) {
    fail(`unknown stage "${modifier.stage}"; it must be one of ${RATING_STAGES.join(', ')}`);
  }
  if (
    !Number.isInteger(modifier.order) ||
    modifier.order < RATING_ORDER_MIN ||
    modifier.order > RATING_ORDER_MAX
  ) {
    fail(
      `the order must be a whole number from ${String(RATING_ORDER_MIN)} to ${String(RATING_ORDER_MAX)}`,
    );
  }
  if (modifiers.has(modifier.id)) {
    fail('a modifier with this id is already registered');
  }
  const stored: RatingModifier = { ...modifier };
  modifiers.set(modifier.id, stored);
  return () => {
    if (modifiers.get(modifier.id) === stored) {
      modifiers.delete(modifier.id);
    }
  };
}

function compareModifiers(left: RatingModifier, right: RatingModifier): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  if (left.id === right.id) {
    return 0;
  }
  return left.id < right.id ? -1 : 1;
}

/** The modifiers of one stage, in the order they run: by order, then by id. */
export function ratingModifiersFor(stage: RatingStage): RatingModifier[] {
  return [...modifiers.values()]
    .filter((modifier) => modifier.stage === stage)
    .sort(compareModifiers);
}

/** Empties both registries. For `resetMatchRegistriesForTests`, which then restores the built-ins. */
export function clearRatingRegistries(): void {
  raters.clear();
  modifiers.clear();
}
