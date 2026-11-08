/**
 * Storylines: the feuds and angles that tie segments together across shows.
 *
 * Segments link to storylines through `segment.storylineIds`; a storyline's heat feeds the live
 * crowd and, per design decision D-09, shields its members' morale when they lose inside it.
 *
 * Design notes: docs/design/data-model.md, "Titles, events, storylines and seasons".
 */

import { z } from 'zod';
import { compareDates } from '../../core/date';
import { defineTable } from '../table-def';
import { zGameDate, zId, zStat } from '../primitives';
import { hasDuplicates, isPresentIff, zName } from './entity-refinements';

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
  })
  .refine((storyline) => isPresentIff(storyline.endedOn, storyline.status === 'ended'), {
    message: 'endedOn is set exactly when status is ended',
    path: ['endedOn'],
  })
  .refine(
    (storyline) =>
      storyline.endedOn === null || compareDates(storyline.endedOn, storyline.startedOn) >= 0,
    { message: 'endedOn must not be before startedOn', path: ['endedOn'] },
  );

export type StorylineMember = z.infer<typeof StorylineMemberSchema>;
export type Storyline = z.infer<typeof StorylineSchema>;

export const storylinesTable = defineTable({
  kind: 'storyline',
  name: 'storylines',
  schema: StorylineSchema,
  refs: [
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'brandId', target: 'brand', nullable: true },
    { path: 'members[].personId', target: 'person', nullable: false },
  ],
  indexes: [
    { name: 'byPromotion', key: (storyline) => storyline.promotionId },
    { name: 'byMember', key: (storyline) => storyline.members.map((member) => member.personId) },
  ],
});
