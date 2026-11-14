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

export const StorylineMemberSchema = z.strictObject({
  personId: zId('person'),
  side: z.enum(STORYLINE_SIDES),
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
     * finale is flagged; it must link this storyline (`finaleIsLinked`). The default keeps saves
     * from before CRTV3-01 loading.
     */
    finaleSegmentId: zId('segment').nullable().default(null),
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
  );

export type StorylineMember = z.infer<typeof StorylineMemberSchema>;
export type Storyline = z.infer<typeof StorylineSchema>;

/**
 * `finaleIsLinked`: a storyline's finale segment lists the storyline in its `storylineIds`, so the
 * finale is always one of the story's own segments.
 */
function checkFinaleIsLinked(view: WorldView): IntegrityIssue[] {
  const segments = tableOf(view, segmentsTable);
  const issues: IntegrityIssue[] = [];
  for (const storyline of tableOf(view, storylinesTable).values()) {
    if (storyline.finaleSegmentId === null) {
      continue;
    }
    const segment = segments.get(storyline.finaleSegmentId);
    if (segment === undefined || segment.storylineIds.includes(storyline.id)) {
      // A missing segment is the ref check's problem, not this rule's.
      continue;
    }
    issues.push({
      code: 'storylines.finaleIsLinked',
      table: 'storylines',
      id: storyline.id,
      path: 'finaleSegmentId',
      message: `storylines ${storyline.id}: finale segment ${storyline.finaleSegmentId} does not link this storyline`,
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
  ],
  indexes: [
    { name: 'byPromotion', key: (storyline) => storyline.promotionId },
    { name: 'byMember', key: (storyline) => storyline.members.map((member) => member.personId) },
  ],
  invariants: [{ name: 'finaleIsLinked', check: checkFinaleIsLinked }],
});
