/**
 * Segment drafts: what a booker hands the card writer for one segment.
 *
 * A draft is a segment without its place on the card (instance, section, slot), its id or its
 * rating, plus its participants. The editor sections that belong to later tickets (storylines,
 * crew, stipulations, titles, the planned finish) default, so the first editor can leave them out.
 * Drafts are checked against the world by `structuralProblems` in `writer.ts`.
 *
 * Design notes: docs/design/booking.md#the-card-writer.
 */

import { z } from 'zod';
import type { SegmentId } from '../../core/ids';
import { EntityNotFoundError } from '../../core/errors';
import { compareIds } from '../../model/table';
import { MAX_SIDE, PARTICIPANT_ROLES } from '../../model/entities/participant';
import {
  AngleDetailsSchema,
  MatchDetailsSchema,
  MatchOutcomeSchema,
  MatchSegmentSchema,
  ResultPlanSchema,
  SegmentCrewSchema,
  type MatchOutcome,
  type ResultPlan,
  type SegmentCrew,
} from '../../model/entities/segment';
import { zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';

/** The crew a draft gets when it does not name one. */
export function emptyCrew(): SegmentCrew {
  return { refereeId: null, producerId: null, announcerIds: [] };
}

/** One person in a draft: who, on which side, in what role, for which team. */
export const ParticipantDraftSchema = z.strictObject({
  personId: zId('person'),
  side: z.number().int().min(0).max(MAX_SIDE),
  role: z.enum(PARTICIPANT_ROLES),
  teamId: zId('team').nullable(),
});

const draftBaseShape = {
  label: MatchSegmentSchema.shape.label,
  storylineIds: MatchSegmentSchema.shape.storylineIds.default([]),
  crew: SegmentCrewSchema.default(emptyCrew),
  participants: z.array(ParticipantDraftSchema),
};

/** A match's details with the parts later editor sections own defaulted. */
export const MatchDetailsDraftSchema = MatchDetailsSchema.extend({
  stipulationKeys: MatchDetailsSchema.shape.stipulationKeys.default([]),
  titleIds: MatchDetailsSchema.shape.titleIds.default([]),
  finishKey: MatchDetailsSchema.shape.finishKey.default(null),
});

export const MatchDraftSchema = z.strictObject({
  kind: z.literal('match'),
  ...draftBaseShape,
  match: MatchDetailsDraftSchema,
  /** The planned result, or null to decide it on the night. */
  outcome: MatchOutcomeSchema.nullable(),
});

/** An angle's details; without `beats` the writer gives it its type's default beat. */
export const AngleDetailsDraftSchema = z.strictObject({
  angleTypeKey: AngleDetailsSchema.shape.angleTypeKey,
  beats: AngleDetailsSchema.shape.beats.optional(),
});

export const AngleDraftSchema = z.strictObject({
  kind: z.literal('angle'),
  ...draftBaseShape,
  angle: AngleDetailsDraftSchema,
});

export const SegmentDraftSchema = z.discriminatedUnion('kind', [
  MatchDraftSchema,
  AngleDraftSchema,
]);

export type ParticipantDraft = z.output<typeof ParticipantDraftSchema>;
export type MatchDraft = z.output<typeof MatchDraftSchema>;
export type AngleDraft = z.output<typeof AngleDraftSchema>;
/** A draft with every default filled in, as the writer takes it. */
export type SegmentDraft = z.output<typeof SegmentDraftSchema>;
/** A draft as a caller may write it, before the defaults are filled in. */
export type SegmentDraftInput = z.input<typeof SegmentDraftSchema>;

/**
 * What the booker picked in a match's Result list (MTCH2-08): a planned outcome (a side, a Draw or
 * a No contest), Auto or Random (decided on the night), or null when nothing is picked yet.
 */
export const PlannedResultSchema = z.union([MatchOutcomeSchema, ResultPlanSchema]).nullable();
export type PlannedResult = MatchOutcome | ResultPlan | null;

/** The Result-list choice a match draft (or a match segment) holds. */
export function plannedResultOf(match: {
  readonly outcome: DeepReadonly<MatchOutcome> | null;
  readonly match: { readonly resultPlan?: ResultPlan | undefined };
}): PlannedResult {
  if (match.outcome !== null) {
    return { ...match.outcome };
  }
  return match.match.resultPlan ?? null;
}

/**
 * The match draft with `result` as its Result-list choice: Auto and Random set
 * `match.resultPlan` with no outcome; anything else sets the outcome and drops `resultPlan`.
 */
export function withPlannedResult(draft: MatchDraft, result: PlannedResult): MatchDraft {
  const match = { ...draft.match };
  delete match.resultPlan;
  if (result === 'auto' || result === 'random') {
    return { ...draft, match: { ...match, resultPlan: result }, outcome: null };
  }
  return { ...draft, match, outcome: result === null ? null : { ...result } };
}

/**
 * The draft of a segment already on a card: the editor's starting point. Participants come in
 * side order, then by person id. Writing the draft back unchanged leaves the segment as it is
 * (apart from its rating, which the writer always clears).
 *
 * @throws EntityNotFoundError when there is no such segment.
 */
export function draftFromSegment(read: GameWorldView, segmentId: SegmentId): SegmentDraft {
  const segment = read.tables.segments.get(segmentId);
  if (segment === undefined) {
    throw new EntityNotFoundError('segments', segmentId);
  }
  const participants = read.tables.participants
    .lookup('bySegment', segmentId)
    .map((participant) => ({
      personId: participant.personId,
      side: participant.side,
      role: participant.role,
      teamId: participant.teamId,
    }))
    .sort((left, right) => left.side - right.side || compareIds(left.personId, right.personId));
  const base = {
    label: segment.label,
    storylineIds: [...segment.storylineIds],
    crew: { ...segment.crew, announcerIds: [...segment.crew.announcerIds] },
    participants,
  };
  if (segment.kind === 'match') {
    return {
      kind: 'match',
      ...base,
      match: {
        ...segment.match,
        stipulationKeys: [...segment.match.stipulationKeys],
        titleIds: [...segment.match.titleIds],
      },
      outcome: segment.outcome === null ? null : { ...segment.outcome },
    };
  }
  return {
    kind: 'angle',
    ...base,
    angle: {
      angleTypeKey: segment.angle.angleTypeKey,
      beats: segment.angle.beats.map((beat) => ({
        beatKey: beat.beatKey,
        personIds: [...beat.personIds],
      })),
    },
  };
}
