/**
 * Storylines: the feuds and angles that tie segments together across shows.
 *
 * Segments link to storylines through `segment.storylineIds`; a storyline's heat feeds the live
 * crowd and, per design decision D-09, shields its members' morale when they lose inside it.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons", and
 * docs/design/storylines.md (CRTV3).
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import type { IntegrityIssue } from '../integrity';
import { defineTable } from '../table-def';
import { zGameDate, zId, zStat } from '../primitives';
import { tableOf, type WorldView } from '../world';
import { hasDuplicates, isPresentIff, zName } from './entity-refinements';
import { segmentsTable } from './segment';

export const STORYLINE_STATUSES = ['active', 'ended'] as const;
export type StorylineStatus = (typeof STORYLINE_STATUSES)[number];

/** Which side of the story a member is on. Not their overall alignment, which is on employment. */
export const STORYLINE_SIDES = ['face', 'heel', 'neutral'] as const;
export type StorylineSide = (typeof STORYLINE_SIDES)[number];

export const MIN_STORYLINE_MEMBERS = 1;
export const MAX_STORYLINE_MEMBERS = 12;
export const MAX_STORYLINE_SUMMARY_LENGTH = 500;
/** The most progress entries a storyline keeps; writers drop the oldest first (CRTV4). */
export const MAX_STORYLINE_PROGRESS = 200;

export const StorylineMemberSchema = z.strictObject({
  personId: zId('person'),
  side: z.enum(STORYLINE_SIDES),
});

/**
 * One linked segment that moved the story on (CRTV4-02 writes these after a show): the heat before
 * and after, and the trace that explains the change. Oldest first.
 */
export const StorylineProgressSchema = z.strictObject({
  segmentId: zId('segment'),
  eventInstanceId: zId('eventInstance'),
  date: zGameDate,
  heatBefore: zStat,
  heatAfter: zStat,
  /** Ref key of the heat trace, or null when none was kept. */
  traceId: z.string().nullable(),
});

/** How one member came out of the payoff. `skipped`: no longer around to be paid off. */
export const StorylinePayoffMemberSchema = z.strictObject({
  personId: zId('person'),
  popularityDelta: z.number(),
  momentumDelta: z.number(),
  skipped: z.boolean(),
});

/** What happened when the storyline ended (CRTV4-03 writes it): paid off or not, and to whom. */
export const StorylinePayoffSchema = z.strictObject({
  paid: z.boolean(),
  on: zGameDate,
  /** The linked segments that counted for the story, all time. */
  countedSegments: z.number().int().min(0),
  /** Heat when the story ended. */
  heat: zStat,
  members: z.array(StorylinePayoffMemberSchema).max(MAX_STORYLINE_MEMBERS),
  traceId: z.string().nullable(),
});

export const StorylineSchema = z
  .strictObject({
    id: zId('storyline'),
    promotionId: zId('promotion'),
    brandId: zId('brand').nullable(),
    name: zName(80),
    status: z.enum(STORYLINE_STATUSES),
    startedOn: zGameDate,
    /** Set exactly when the storyline has ended. */
    endedOn: zGameDate.nullable(),
    /** How hot the story is with the crowd, 0-100. */
    heat: zStat,
    members: z
      .array(StorylineMemberSchema)
      .min(MIN_STORYLINE_MEMBERS)
      .max(MAX_STORYLINE_MEMBERS)
      .refine((members) => !hasDuplicates(members.map((member) => member.personId)), {
        message: 'a person can be a member only once',
      }),
    summary: z.string().max(MAX_STORYLINE_SUMMARY_LENGTH),
    /**
     * The last day a linked segment moved the story on; null = never, so cooling counts from
     * `startedOn`. Written by CRTV4 (heat after segments); CRTV3 only stores and reads it. The
     * default keeps saves from before CRTV3-01 loading.
     */
    lastProgressOn: zGameDate.nullable().default(null),
    /**
     * The linked segment booked as the story's final match, or null. Written by CRTV4 when a
     * finale is flagged; it must be a match linking this storyline (`finaleIsLinkedMatch`). The default keeps saves
     * from before CRTV3-01 loading.
     */
    finaleSegmentId: zId('segment').nullable().default(null),
    /**
     * Linked segments that moved the story on, oldest first, at most `MAX_STORYLINE_PROGRESS`
     * (CRTV4-01 schema, CRTV4-02 writes). The default keeps older saves loading.
     */
    progress: z.array(StorylineProgressSchema).max(MAX_STORYLINE_PROGRESS).default([]),
    /** The ending's payoff record; null while the story is active (CRTV4-03 writes it). */
    payoff: StorylinePayoffSchema.nullable().default(null),
  })
  .refine((storyline) => isPresentIff(storyline.endedOn, storyline.status === 'ended'), {
    message: 'endedOn is set exactly when status is ended',
    path: ['endedOn'],
  })
  .refine(
    (storyline) =>
      storyline.endedOn === null || compareDates(storyline.endedOn, storyline.startedOn) >= 0,
    { message: 'endedOn must not be before startedOn', path: ['endedOn'] },
  )
  .refine(
    (storyline) =>
      storyline.lastProgressOn === null ||
      compareDates(storyline.lastProgressOn, storyline.startedOn) >= 0,
    { message: 'lastProgressOn must not be before startedOn', path: ['lastProgressOn'] },
  )
  .refine((storyline) => storyline.payoff === null || storyline.status !== 'active', {
    message: 'payoff is null while the storyline is active',
    path: ['payoff'],
  })
  .refine(
    (storyline) =>
      storyline.progress.every(
        (entry, index) =>
          index === 0 || compareDates(storyline.progress[index - 1]!.date, entry.date) <= 0,
      ),
    { message: 'progress dates must not go backwards', path: ['progress'] },
  );

export type StorylineMember = z.infer<typeof StorylineMemberSchema>;
export type Storyline = z.infer<typeof StorylineSchema>;
export type StorylineProgress = z.infer<typeof StorylineProgressSchema>;
export type StorylinePayoffMember = z.infer<typeof StorylinePayoffMemberSchema>;
/** Named `…Record` because `StorylinePayoff` is the detail screen's payoff state (CRTV3-01). */
export type StorylinePayoffRecord = z.infer<typeof StorylinePayoffSchema>;

/**
 * `finaleIsLinkedMatch` (CRTV3-01, tightened by CRTV4-01): a storyline's finale segment exists, is
 * a match, and lists the storyline in its `storylineIds`, so the finale is always one of the
 * story's own matches. Booking clears a finale before the segment goes or stops being a match.
 */
function checkFinaleIsLinkedMatch(view: WorldView): IntegrityIssue[] {
  const segments = tableOf(view, segmentsTable);
  const issues: IntegrityIssue[] = [];
  for (const storyline of tableOf(view, storylinesTable).values()) {
    if (storyline.finaleSegmentId === null) {
      continue;
    }
    const segment = segments.get(storyline.finaleSegmentId);
    let problem: string | null = null;
    if (segment === undefined) {
      problem = 'does not exist';
    } else if (segment.kind !== 'match') {
      problem = 'is not a match';
    } else if (!segment.storylineIds.includes(storyline.id)) {
      problem = 'does not link this storyline';
    }
    if (problem === null) {
      continue;
    }
    issues.push({
      code: 'storylines.finaleIsLinkedMatch',
      table: 'storylines',
      id: storyline.id,
      path: 'finaleSegmentId',
      message: `storylines ${storyline.id}: finale segment ${storyline.finaleSegmentId} ${problem}`,
    });
  }
  return issues;
}

export const storylinesTable = defineTable({
  kind: 'storyline',
  name: 'storylines',
  schema: StorylineSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'brandId', target: 'brand', nullable: true },
    { path: 'members[].personId', target: 'person', nullable: false },
    { path: 'finaleSegmentId', target: 'segment', nullable: true },
    { path: 'progress[].segmentId', target: 'segment', nullable: false },
    { path: 'progress[].eventInstanceId', target: 'eventInstance', nullable: false },
    { path: 'payoff.members[].personId', target: 'person', nullable: false },
  ],
  indexes: [
    { name: 'byPromotion', key: (storyline) => storyline.promotionId },
    { name: 'byMember', key: (storyline) => storyline.members.map((member) => member.personId) },
  ],
  invariants: [{ name: 'finaleIsLinkedMatch', check: checkFinaleIsLinkedMatch }],
});
