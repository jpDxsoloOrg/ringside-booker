/**
 * The Match lab's physical preview (MTCH4-05): the `physical` preview extension. After Simulate the
 * lab shows, for every competitor, the fatigue gain, fatigue after, body wear, ring learning and
 * injury chance of the drafted match, with whether this run's roll hurt them; Run x100 counts the
 * injuries over every run.
 *
 * It is `computePhysicalToll` (MTCH4-04) on a spec built from the lab draft, with the `match.wear`
 * and `match.injury` draws on detached streams keyed by the run's seed: nothing is written, the
 * world RNG never moves, and the same seed always gives the same toll. A "Fatigue going in" what-if
 * per worker (`fatigueOverrides`) replaces the stored fatigue for this preview only; the injury
 * chance trace then starts from "Fatigue going in (lab what-if)".
 *
 * Rules the lab draft follows: everyone on a side is a competitor; the entrance order is the order
 * the worker was added to their side; the duration class comes from the chosen slot role and match
 * type (`durationClassOf`); the draft is on no card, so every worker is on their first match of the
 * night; the injury rules are those of the promotion running the show (`injuryPolicyFor`, the
 * viewer's own promotion unless the lab rates as another); a worker already hurt keeps the load but
 * is not rolled again.
 *
 * Design: docs/design/physical-toll.md#match-lab.
 */

import { z } from 'zod';
import { INVALID_ARGS, refuseQuery } from '../../../core/api/result';
import type { PersonId } from '../../../core/ids';
import { matchTypeOf } from '../../../model/catalogs';
import { zId } from '../../../model/primitives';
import type { Traced } from '../../../core/trace';
import { registerPreviewExtension, type PreviewExtensionContext } from '../previewExtensions';
import { durationClassOf, type DurationClass } from '../slots';
import { conditionLostTrace } from './apply';
import { injuryPolicyFor } from './injuries';
import type { PhysicalParticipant, PhysicalSegmentSpec } from './inputs';
import { INJURY_STREAM, WEAR_STREAM } from './streams';
import { computePhysicalToll, type AlreadyInjured, type WorkerPhysicalToll } from './toll';

/** The extension's id: `extensions.physical` in the preview arguments and answers. */
export const PHYSICAL_PREVIEW_ID = 'physical';

/** Fatigue is on a 0..100 scale. */
const FATIGUE_TOP = 100;

/** The player-worded reason for a what-if outside 0..100. */
export const FATIGUE_OVERRIDE_RANGE_MESSAGE =
  'Fatigue going in must be a whole number from 0 to 100';

/** `extensions.physical`: the lab's what-ifs. */
export interface PhysicalPreviewArgs {
  /** Fatigue going in per worker, 0..100, in place of their stored fatigue. */
  fatigueOverrides?: Record<PersonId, number> | undefined;
}

const zFatigue = z
  .number({ error: FATIGUE_OVERRIDE_RANGE_MESSAGE })
  .int(FATIGUE_OVERRIDE_RANGE_MESSAGE)
  .min(0, FATIGUE_OVERRIDE_RANGE_MESSAGE)
  .max(FATIGUE_TOP, FATIGUE_OVERRIDE_RANGE_MESSAGE);

/** Zod schema for {@link PhysicalPreviewArgs}. */
export const PhysicalPreviewArgsSchema = z.strictObject({
  fatigueOverrides: z.record(zId('person'), zFatigue).optional(),
});

/** One competitor's physical toll in the lab. */
export interface PhysicalPreviewWorker extends WorkerPhysicalToll {
  /** Their stored fatigue today, whatever the what-if says ("As now (n)"). */
  readonly fatigueNow: number;
  /** True when `fatigueBefore` is the lab's what-if. */
  readonly fatigueWhatIf: boolean;
  /** "Condition lost in this match": the wear load times the body part weights added up. */
  readonly wearTotal: Traced<number>;
}

/** `extensions.physical` of a single preview. */
export interface PhysicalPreviewResult {
  /** The draft's duration class, as the formulas read it. */
  readonly durationClass: DurationClass;
  /** The most injuries one segment can have (`match.injury.maxPerSegment`). */
  readonly maxInjuriesPerSegment: number;
  /** In roll order: side, then the order the worker was added. Empty for a talking segment. */
  readonly workers: readonly PhysicalPreviewWorker[];
}

/** One competitor over a batch. */
export interface PhysicalPreviewPersonSummary {
  readonly personId: PersonId;
  readonly name: string;
  /** Stored 0-based side. */
  readonly side: number;
  /** Runs this worker was injured in. */
  readonly injuries: number;
  /** Rounded to 0.1. */
  readonly meanFatigueGain: number;
  /** Rounded to 0.1. */
  readonly meanWearTotal: number;
  /** Rounded to 0.01. */
  readonly meanLearning: number;
}

/** `extensionSummaries.physical` of a batch. */
export interface PhysicalPreviewSummary {
  readonly runs: number;
  /** Runs in which at least one worker was injured. */
  readonly injuredSegments: number;
  /** Injuries (every worker hurt counts) per 100 runs, rounded to 0.1. */
  readonly injuriesPer100: number;
  /** Side by side, then the order each worker was added. */
  readonly byPerson: readonly PhysicalPreviewPersonSummary[];
}

declare module '../previewExtensions' {
  interface PreviewExtensionMap {
    physical: {
      args: PhysicalPreviewArgs;
      result: PhysicalPreviewResult;
      summary: PhysicalPreviewSummary;
    };
  }
}

function roundTo(value: number, places: number): number {
  const scale = 10 ** places;
  const rounded = Math.round(value * scale) / scale;
  return rounded === 0 ? 0 : rounded;
}

/** The draft as the physical toll reads it. Refuses a producer the world does not have. */
export function labSegmentSpec(
  ctx: PreviewExtensionContext,
  args: PhysicalPreviewArgs,
): PhysicalSegmentSpec {
  const { draft, read, tunables } = ctx;
  const producerId = draft.crew?.producerId ?? null;
  if (producerId !== null && !read.tables.people.has(producerId)) {
    return refuseQuery({
      code: INVALID_ARGS,
      message: `crew.producerId: there is no person ${producerId}`,
      field: 'crew.producerId',
    });
  }
  const matchType = draft.kind === 'match' ? (matchTypeOf(read, draft.typeKey) ?? null) : null;
  const sides = draft.sides.map((personIds) =>
    personIds.map((personId, index): PhysicalParticipant => ({
      personId,
      role: 'competitor',
      entranceOrder: index,
    })),
  );
  return {
    promotionId: ctx.promotionId,
    importance: draft.importance,
    kind: draft.kind,
    durationClass: durationClassOf({ role: draft.slotRole, matchType }, { tunables }).value,
    sides,
    crew: { producerId },
    keepItSafe: false,
    ...(args.fatigueOverrides === undefined ? {} : { fatigueOverrides: args.fatigueOverrides }),
  };
}

/** One run of the physical preview. */
export function runPhysicalPreview(
  ctx: PreviewExtensionContext,
  args: PhysicalPreviewArgs,
): PhysicalPreviewResult {
  const { read, tunables } = ctx;
  const spec = labSegmentSpec(ctx, args);
  const alreadyInjured = new Map<PersonId, AlreadyInjured>();
  for (const side of spec.sides) {
    for (const { personId } of side) {
      const injury = read.tables.people.get(personId)?.injury;
      if (injury !== undefined && injury !== null) {
        alreadyInjured.set(personId, 'before');
      }
    }
  }
  const toll = computePhysicalToll(read, spec, {
    tunables,
    policy: injuryPolicyFor(read, tunables, spec.promotionId),
    wearRng: ctx.rng(WEAR_STREAM),
    injuryRng: ctx.rng(INJURY_STREAM),
    alreadyInjured,
    // A batch keeps only the summary: the fast paths leave out traces nobody reads, with the same
    // values and draws.
    summaryOnly: ctx.batch,
  });
  return {
    durationClass: spec.durationClass,
    maxInjuriesPerSegment: tunables.get('match.injury.maxPerSegment'),
    workers: toll.workers.map((worker) => ({
      ...worker,
      fatigueNow: read.tables.people.require(worker.personId).fatigue,
      fatigueWhatIf: args.fatigueOverrides?.[worker.personId] !== undefined,
      wearTotal: conditionLostTrace(worker, tunables),
    })),
  };
}

/** The batch summary: injuries counted, means per worker. */
export function summarisePhysicalPreview(
  values: readonly PhysicalPreviewResult[],
): PhysicalPreviewSummary {
  const people = new Map<
    PersonId,
    {
      name: string;
      side: number;
      injuries: number;
      fatigueGain: number;
      wear: number;
      learning: number;
      runs: number;
    }
  >();
  let injuredSegments = 0;
  let injuries = 0;
  for (const value of values) {
    let hurt = 0;
    for (const worker of value.workers) {
      let entry = people.get(worker.personId);
      if (entry === undefined) {
        entry = {
          name: worker.name,
          side: worker.side,
          injuries: 0,
          fatigueGain: 0,
          wear: 0,
          learning: 0,
          runs: 0,
        };
        people.set(worker.personId, entry);
      }
      entry.runs += 1;
      entry.fatigueGain += worker.fatigueGain.value;
      entry.wear += worker.wearTotal.value;
      entry.learning += worker.learning.value;
      if (worker.injury.injured) {
        entry.injuries += 1;
        hurt += 1;
      }
    }
    injuries += hurt;
    if (hurt > 0) {
      injuredSegments += 1;
    }
  }
  const runs = values.length;
  return {
    runs,
    injuredSegments,
    injuriesPer100: runs === 0 ? 0 : roundTo((injuries / runs) * 100, 1),
    // Map order is the first run's roll order: side, then the order the worker was added.
    byPerson: [...people.entries()].map(([personId, entry]) => ({
      personId,
      name: entry.name,
      side: entry.side,
      injuries: entry.injuries,
      meanFatigueGain: roundTo(entry.fatigueGain / entry.runs, 1),
      meanWearTotal: roundTo(entry.wear / entry.runs, 1),
      meanLearning: roundTo(entry.learning / entry.runs, 2),
    })),
  };
}

registerPreviewExtension({
  id: PHYSICAL_PREVIEW_ID,
  args: PhysicalPreviewArgsSchema,
  run: runPhysicalPreview,
  summarise: summarisePhysicalPreview,
});
