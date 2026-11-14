/**
 * Segments: the matches and angles on a show's card.
 *
 * A segment is a discriminated union on `kind`, so it is impossible to build one without saying
 * whether it is a match or an angle, and TypeScript makes every reader handle both. Each segment
 * sits in a numbered slot of one card section (the main card or the pre-show). Per design decision
 * D-10 that slot is all the card stores: the slot role (opener, midcard, semi-main, main event) and
 * the duration class (short, standard, long) are derived by MTCH from the slot position, the
 * section and the match type. No segment field holds minutes, a length or a role.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons".
 */

import { z } from 'zod';
import type { IntegrityIssue } from '../integrity';
import { zContentKey, zId, zNonNegativeInt, zStat } from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type DeepReadonly, type WorldView } from '../world';
import { hasDuplicates, zName } from './entity-refinements';
import { eventInstancesTable } from './event-instance';
import { ANGLE_SETTINGS, DEFAULT_ANGLE_SETTING, type AngleSetting } from './angle-setting';
import { MAX_SIDE, participantsTable } from './participant';
import { titlesTable } from './title';

export const SEGMENT_KINDS = ['match', 'angle'] as const;
export type SegmentKind = (typeof SEGMENT_KINDS)[number];

/** Most announcers on one segment's commentary team. */
export const MAX_ANNOUNCERS = 4;
/** Fewest and most beats in an angle. */
export const MIN_ANGLE_BEATS = 1;
export const MAX_ANGLE_BEATS = 8;
/** Star ratings are 0-5 in quarter stars. */
export const MAX_STARS = 5;
export const STAR_STEP = 0.25;

function uniqueArray<T extends z.ZodType<string>>(element: T, fieldName: string) {
  return z
    .array(element)
    .refine((values) => !hasDuplicates(values), { message: `${fieldName} must be unique` });
}

/** The people working a segment who are not in it. */
export const SegmentCrewSchema = z.strictObject({
  refereeId: zId('person').nullable(),
  producerId: zId('person').nullable(),
  announcerIds: uniqueArray(zId('person'), 'announcerIds').max(MAX_ANNOUNCERS),
});

/**
 * A segment's rating, written by EVT3's `shows.runShows` when the show is completed. `score` and
 * `stars` are the rater's result; `workRate`, `crowd` and `expectation` are its components, each
 * null only when the segment's rater produces no such component (a talking segment has no work
 * rate). `traceId` holds the ref key (`refKey(ref)` from `core/trace/store.ts`) of the rating's
 * trace in the recent-traces store kept in the save for the Why? panel, or null when none was kept.
 */
export const SegmentRatingSchema = z.strictObject({
  score: zStat,
  stars: z.number().min(0).max(MAX_STARS).multipleOf(STAR_STEP),
  workRate: zStat.nullable(),
  crowd: zStat.nullable(),
  expectation: zStat.nullable(),
  traceId: z.string().min(1).nullable(),
});

/** Fields every segment has, whatever its kind. */
const segmentBaseShape = {
  id: zId('segment'),
  eventInstanceId: zId('eventInstance'),
  /**
   * Position within its card section, counted from 0, below the format's slot count for the
   * section. Open slots are simply absent: a card may have gaps while it is being booked.
   */
  slot: zNonNegativeInt,
  /** True for the pre-show section, false for the main card. Each section numbers from 0. */
  preShow: z.boolean(),
  /** An optional billing line such as "Number one contender's match". */
  label: zName(80).nullable(),
  storylineIds: uniqueArray(zId('storyline'), 'storylineIds'),
  crew: SegmentCrewSchema,
  /** Set only once the show is completed. */
  rating: SegmentRatingSchema.nullable(),
};

/**
 * A result the booker leaves to the night (MTCH2-08): `auto` lets the match decide from who is in
 * it (the auto-winner), `random` is a coin flip with an equal chance for every side.
 */
export const RESULT_PLANS = ['auto', 'random'] as const;
export const ResultPlanSchema = z.enum(RESULT_PLANS);
export type ResultPlan = z.infer<typeof ResultPlanSchema>;

/** What kind of match it is. Content keys point at data-pack catalogs owned by MTCH and WLD. */
export const MatchDetailsSchema = z.strictObject({
  matchTypeKey: zContentKey,
  stipulationKeys: uniqueArray(zContentKey, 'stipulationKeys'),
  /** Titles on the line; empty for a non-title match. */
  titleIds: uniqueArray(zId('title'), 'titleIds'),
  /** The planned finish, or null to let the match decide. */
  finishKey: zContentKey.nullable(),
  /**
   * Set when the booker left the result to the night as Auto or Random (MTCH2-08); absent when the
   * segment's `outcome` is the plan (or nothing is planned yet). While the show has not run, a match
   * with a `resultPlan` has a null `outcome`; once it is completed `outcome` is the result and
   * `resultPlan` stays as the record of how it was decided.
   */
  resultPlan: ResultPlanSchema.optional(),
});

export const MatchOutcomeSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('win'),
    /** The winning participants' `side`. */
    winningSide: z.number().int().min(0).max(MAX_SIDE),
    methodKey: zContentKey,
  }),
  z.strictObject({ kind: z.literal('draw') }),
  z.strictObject({ kind: z.literal('noContest') }),
]);

/** One step of an angle, in order. Angles have no minutes either. */
export const AngleBeatSchema = z.strictObject({
  beatKey: zContentKey,
  personIds: uniqueArray(zId('person'), 'personIds'),
});

export const AngleSettingSchema = z.enum(ANGLE_SETTINGS);

export const AngleDetailsSchema = z.strictObject({
  angleTypeKey: zContentKey,
  beats: z.array(AngleBeatSchema).min(MIN_ANGLE_BEATS).max(MAX_ANGLE_BEATS),
  /**
   * MTCH5-08: where it happens: in the ring, backstage or pre-taped. Absent = `ring` (saves from
   * before MTCH5-08 and every angle booked in the ring).
   */
  setting: AngleSettingSchema.optional(),
});

/**
 * A match on the card. Its `outcome` holds the booker's planned result before the show runs and
 * the result that happened afterwards: one field, so every reader has one source of truth.
 */
export const MatchSegmentSchema = z.strictObject({
  ...segmentBaseShape,
  kind: z.literal('match'),
  match: MatchDetailsSchema,
  /**
   * The planned result while the show is scheduled or booked; the result that happened once it is
   * completed (written by EVT3). Null when nothing is planned (decided on the night).
   */
  outcome: MatchOutcomeSchema.nullable(),
});

export const AngleSegmentSchema = z.strictObject({
  ...segmentBaseShape,
  kind: z.literal('angle'),
  angle: AngleDetailsSchema,
});

export const SegmentSchema = z.discriminatedUnion('kind', [MatchSegmentSchema, AngleSegmentSchema]);

export type SegmentCrew = z.infer<typeof SegmentCrewSchema>;
export type SegmentRating = z.infer<typeof SegmentRatingSchema>;
export type MatchDetails = z.infer<typeof MatchDetailsSchema>;
export type MatchOutcome = z.infer<typeof MatchOutcomeSchema>;
export type AngleBeat = z.infer<typeof AngleBeatSchema>;
export type AngleDetails = z.infer<typeof AngleDetailsSchema>;
export type MatchSegment = z.infer<typeof MatchSegmentSchema>;
export type AngleSegment = z.infer<typeof AngleSegmentSchema>;
export type Segment = z.infer<typeof SegmentSchema>;

/** Narrows a segment (or a read-only one from a `WorldView`) to a match. */
export function isMatch<S extends { readonly kind: SegmentKind }>(
  segment: S,
): segment is Extract<S, { readonly kind: 'match' }> {
  return segment.kind === 'match';
}

/** Narrows a segment (or a read-only one from a `WorldView`) to an angle. */
export function isAngle<S extends { readonly kind: SegmentKind }>(
  segment: S,
): segment is Extract<S, { readonly kind: 'angle' }> {
  return segment.kind === 'angle';
}

/**
 * Where a segment happens (MTCH5-08): an angle's stored setting, `ring` when it names none, and
 * always `ring` for a match.
 */
export function settingOf(segment: {
  readonly kind: SegmentKind;
  readonly angle?: { readonly setting?: AngleSetting | undefined } | undefined;
}): AngleSetting {
  return segment.kind === 'angle'
    ? (segment.angle?.setting ?? DEFAULT_ANGLE_SETTING)
    : DEFAULT_ANGLE_SETTING;
}

/** The key of the unique `bySlot` index: one segment per instance, section and slot. */
export function segmentSlotKey(
  segment: Pick<DeepReadonly<Segment>, 'eventInstanceId' | 'preShow' | 'slot'>,
): string {
  return `${segment.eventInstanceId}|${segment.preShow ? 'pre' : 'main'}|${String(segment.slot)}`;
}

// ---------------------------------------------------------------------------------------------
// Invariants

const TABLE = 'segments';

function sectionName(preShow: boolean): string {
  return preShow ? 'pre-show' : 'main card';
}

/** Segments grouped by instance and section, in ID order within each group. */
function segmentsBySection(view: WorldView): Map<string, DeepReadonly<Segment>[]> {
  const groups = new Map<string, DeepReadonly<Segment>[]>();
  for (const segment of tableOf(view, segmentsTable).values()) {
    const groupKey = `${segment.eventInstanceId}|${segment.preShow ? 'pre' : 'main'}`;
    const group = groups.get(groupKey) ?? [];
    group.push(segment);
    groups.set(groupKey, group);
  }
  return groups;
}

/**
 * Rules (3) and (4): every segment sits in a slot its instance's format has, and a section holds no
 * more segments than the format allows. Each section numbers from 0; open slots are simply absent,
 * so a card being booked can fill any slots in any order (D-10: a slot's role comes from its
 * position in the format, not from how many segments the card has). Two segments in one slot are
 * refused at write time by the unique `bySlot` index.
 */
function checkCardSlots(view: WorldView): IntegrityIssue[] {
  const instances = tableOf(view, eventInstancesTable);
  const issues: IntegrityIssue[] = [];
  for (const group of segmentsBySection(view).values()) {
    const [first] = group;
    if (first === undefined) {
      continue;
    }
    const instance = instances.get(first.eventInstanceId);
    if (instance === undefined) {
      continue;
    }
    const section = sectionName(first.preShow);
    const capacity = first.preShow ? instance.format.preShowSlots : instance.format.slots;
    const outside = group
      .map((segment) => segment.slot)
      .filter((slot) => slot >= capacity)
      .sort((left, right) => left - right);
    if (outside.length > 0) {
      issues.push({
        code: 'segments.slotOutsideFormat',
        table: eventInstancesTable.name,
        id: first.eventInstanceId,
        message: `eventInstances ${first.eventInstanceId}: ${section} slots ${outside.join(', ')} are outside the format's ${String(capacity)} ${section} slots (0..${String(capacity - 1)})`,
      });
    }
    if (group.length > capacity) {
      issues.push({
        code: first.preShow ? 'segments.tooManyPreShow' : 'segments.tooManyMainCard',
        table: eventInstancesTable.name,
        id: first.eventInstanceId,
        message: `eventInstances ${first.eventInstanceId}: ${String(group.length)} ${section} segments, but the format has ${String(capacity)} ${section} slots`,
      });
    }
  }
  return issues;
}

/**
 * Rules (5) and (8): a match has competitors on at least two sides, and a winning side is one of
 * them.
 */
function checkMatchSides(view: WorldView): IntegrityIssue[] {
  const participants = tableOf(view, participantsTable);
  const issues: IntegrityIssue[] = [];
  for (const segment of tableOf(view, segmentsTable).values()) {
    if (!isMatch(segment)) {
      continue;
    }
    const competitorSides = new Set(
      participants
        .lookup('bySegment', segment.id)
        .filter((participant) => participant.role === 'competitor')
        .map((participant) => participant.side),
    );
    if (competitorSides.size < 2) {
      issues.push({
        code: 'segments.tooFewSides',
        table: TABLE,
        id: segment.id,
        message: `segments ${segment.id}: a match needs competitors on at least two sides; found ${String(competitorSides.size)}`,
      });
    }
    const outcome = segment.outcome;
    if (outcome !== null && segment.match.resultPlan !== undefined) {
      const instance = tableOf(view, eventInstancesTable).get(segment.eventInstanceId);
      if (instance !== undefined && instance.status !== 'completed') {
        issues.push({
          code: 'segments.resultPlanWithOutcome',
          table: TABLE,
          id: segment.id,
          path: 'match.resultPlan',
          message: `segments ${segment.id}: planned as ${segment.match.resultPlan} but also has a planned outcome`,
        });
      }
    }
    if (outcome?.kind === 'win' && !competitorSides.has(outcome.winningSide)) {
      issues.push({
        code: 'segments.winningSideWithoutCompetitor',
        table: TABLE,
        id: segment.id,
        path: 'outcome.winningSide',
        message: `segments ${segment.id}: winningSide ${String(outcome.winningSide)} has no competitor`,
      });
    }
  }
  return issues;
}

/**
 * Rules (6) and (7): titles on the line belong to the show's promotion, and a rating exists only
 * once the show is completed. A match `outcome` on a show that has not run is the booker's planned
 * result, so it is allowed whatever the status.
 */
function checkAgainstInstance(view: WorldView): IntegrityIssue[] {
  const instances = tableOf(view, eventInstancesTable);
  const titles = tableOf(view, titlesTable);
  const issues: IntegrityIssue[] = [];
  for (const segment of tableOf(view, segmentsTable).values()) {
    const instance = instances.get(segment.eventInstanceId);
    if (instance === undefined) {
      continue;
    }
    if (segment.rating !== null && instance.status !== 'completed') {
      issues.push({
        code: 'segments.resultBeforeCompletion',
        table: TABLE,
        id: segment.id,
        message: `segments ${segment.id}: has a rating but ${instance.id} is ${instance.status}`,
      });
    }
    if (!isMatch(segment)) {
      continue;
    }
    segment.match.titleIds.forEach((titleId, index) => {
      const title = titles.get(titleId);
      if (title !== undefined && title.promotionId !== instance.promotionId) {
        issues.push({
          code: 'segments.titleFromOtherPromotion',
          table: TABLE,
          id: segment.id,
          path: `match.titleIds[${String(index)}]`,
          message: `segments ${segment.id}: title ${titleId} belongs to ${title.promotionId}, not ${instance.promotionId}`,
        });
      }
    });
  }
  return issues;
}

export const segmentsTable = defineTable<'segment', Segment>({
  kind: 'segment',
  name: 'segments',
  schema: SegmentSchema,
  refs: [
    { path: 'eventInstanceId', target: 'eventInstance', nullable: false },
    { path: 'storylineIds[]', target: 'storyline', nullable: false },
    { path: 'crew.refereeId', target: 'person', nullable: true },
    { path: 'crew.producerId', target: 'person', nullable: true },
    { path: 'crew.announcerIds[]', target: 'person', nullable: false },
    { path: 'match.titleIds[]', target: 'title', nullable: false },
    { path: 'angle.beats[].personIds[]', target: 'person', nullable: false },
  ],
  indexes: [
    { name: 'byEventInstance', key: (segment) => segment.eventInstanceId },
    {
      name: 'byStoryline',
      key: (segment) => (segment.storylineIds.length === 0 ? null : segment.storylineIds),
    },
    {
      name: 'byTitle',
      key: (segment) =>
        isMatch(segment) && segment.match.titleIds.length > 0 ? segment.match.titleIds : null,
    },
    { name: 'bySlot', key: segmentSlotKey, unique: true },
  ],
  invariants: [
    { name: 'cardSlotsWithinFormat', check: checkCardSlots },
    { name: 'matchSidesValid', check: checkMatchSides },
    { name: 'segmentMatchesItsInstance', check: checkAgainstInstance },
  ],
});
