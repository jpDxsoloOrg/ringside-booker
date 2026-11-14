/**
 * `match.previewAngle` (MTCH5-03): rate an angle built from beats without it happening.
 *
 * The Match lab (MTCH5-05) and later booking previews send the beats with their groups; the answer
 * is the beat rater's result with every trace inline: the score, stars, delivered, expected, crowd
 * and each beat, each person with the stat they were scored on, the slot's beat limit and the
 * warnings. It goes through the same `rateSegment` and beat rater as a show.
 *
 * A preview never writes and never moves the world's RNG: every roll comes from
 * `detachedStream(meta.seed, 'match.angle', String(previewSeed))`. Viewer scoping: morale and
 * momentum count only for people under contract with one of the viewer's promotions; everyone
 * else is treated as neutral, with a note.
 *
 * Design: docs/design/angle-rating.md#previewing-an-angle.
 */

import { z } from 'zod';
import { viewerPromotionIds } from '../../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../../core/api/query';
import { refuseQuery, type Reason } from '../../../core/api/result';
import type { ContentKey } from '../../../core/content-key';
import type { PersonId, PromotionId, RegionId } from '../../../core/ids';
import type { Traced } from '../../../core/trace';
import { angleTypeOf, beatOf, hasBeatCatalog, isBeatAllowed } from '../../../model/catalogs';
import { zEventImportance, type EventImportance } from '../../../model/entities/event-definition';
import { MAX_SIDE } from '../../../model/entities/participant';
import { MAX_ANGLE_BEATS, MIN_ANGLE_BEATS } from '../../../model/entities/segment';
import { zContentKey, zId } from '../../../model/primitives';
import { PREVIEW_SEED_MAX, labPromotionOf, requireRegion } from '../previewArgs';
import { rateSegment } from '../rating/rateSegment';
import type {
  RatingPolicySummary,
  SegmentAngleBeat,
  SegmentRatingInput,
  SegmentRatingSide,
  SegmentRatingSlot,
  SegmentWarning,
} from '../rating/types';
import {
  SLOT_ROLES,
  durationClassOf,
  slotRoleOf,
  type DurationClass,
  type SlotRole,
} from '../slots';
import { assignAngleSides } from './beatGroups';
import { beatLimitMessage, beatLimitOf } from './beatLimit';
import type { BeatResult } from './rateAngle';
import { anglePreviewStream } from './streams';

/** The most people one group of a previewed beat may hold (the catalog allows at most 6). */
export const PREVIEW_ANGLE_GROUP_MAX = 6;
/** The most beat keys `earlierBeatKeysOnCard` may list. */
export const PREVIEW_EARLIER_BEATS_MAX = 64;

/** `match.previewAngle`'s refusal codes besides `invalidArgs` and `rateSegment`'s. */
export const PREVIEW_ANGLE_REASON_CODES = {
  noBeatCatalog: 'noBeatCatalog',
  tooManyBeats: 'tooManyBeats',
  beatNotAllowed: 'beatNotAllowed',
  unknownBeat: 'unknownBeat',
  emptyGroup: 'emptyGroup',
  notAManager: 'notAManager',
} as const;

export const NO_BEAT_CATALOG_MESSAGE =
  'This save was started before beats existed. Start a new game to build angles from beats.';

/** Where the angle sits: a role chosen outright, or a slot on a card. */
export interface PreviewAngleSlotPosition {
  slot: number;
  slots: number;
  preShow: boolean;
}

export interface PreviewAngleBeatArgs {
  beatKey: ContentKey;
  groupOne: PersonId[];
  groupTwo: PersonId[];
}

/** What `match.previewAngle` rates. */
export interface PreviewAngleArgs {
  importance: EventImportance;
  regionId: RegionId;
  televised: boolean;
  /** The slot's role; give this or `slot`. */
  slotRole?: SlotRole | undefined;
  /** The slot on a card; give this or `slotRole`. */
  slot?: PreviewAngleSlotPosition | undefined;
  /** The promotion running the show; left out, the viewer's first promotion. */
  promotionId?: PromotionId | undefined;
  angleTypeKey: ContentKey;
  beats: PreviewAngleBeatArgs[];
  /** A manager who talks for a person instead of their contract's manager; null for none. */
  managerOverrides?: Record<PersonId, PersonId | null> | undefined;
  /** Beat keys of the talking segments earlier on the card, for repetition. */
  earlierBeatKeysOnCard?: ContentKey[] | undefined;
  /** Whole number, 0 to 2^31 − 1: the same seed always gives the same night. */
  previewSeed: number;
}

const groupSchema = z.array(zId('person')).max(PREVIEW_ANGLE_GROUP_MAX);

/** Zod schema for {@link PreviewAngleArgs} (strict). */
export const PreviewAngleArgsSchema = z
  .strictObject({
    importance: zEventImportance,
    regionId: zId('region'),
    televised: z.boolean(),
    slotRole: z.enum(SLOT_ROLES).optional(),
    slot: z
      .strictObject({
        slot: z.number().int().min(1),
        slots: z.number().int().min(1),
        preShow: z.boolean(),
      })
      .optional(),
    promotionId: zId('promotion').optional(),
    angleTypeKey: zContentKey,
    beats: z
      .array(z.strictObject({ beatKey: zContentKey, groupOne: groupSchema, groupTwo: groupSchema }))
      .min(MIN_ANGLE_BEATS)
      .max(MAX_ANGLE_BEATS),
    managerOverrides: z.record(zId('person'), zId('person').nullable()).optional(),
    earlierBeatKeysOnCard: z.array(zContentKey).max(PREVIEW_EARLIER_BEATS_MAX).optional(),
    previewSeed: z.number().int().min(0).max(PREVIEW_SEED_MAX),
  })
  .refine((args) => (args.slotRole === undefined) !== (args.slot === undefined), {
    message: 'give either slotRole or slot',
    path: ['slotRole'],
  });

/** One person of a previewed beat. */
export type PreviewAngleBeat = BeatResult;

/** `match.previewAngle`'s answer. Every number carries its trace inline. */
export interface PreviewAngleResult {
  readonly previewSeed: number;
  /** 0..100, whole. */
  readonly score: Traced<number>;
  /** 0..5 in quarter stars. */
  readonly stars: Traced<number>;
  readonly delivered: Traced<number>;
  readonly expected: Traced<number>;
  readonly crowd: Traced<number>;
  readonly starPower: Traced<number>;
  readonly beats: readonly PreviewAngleBeat[];
  readonly durationClass: DurationClass;
  readonly beatLimit: { readonly max: number; readonly message: string };
  readonly warnings: readonly SegmentWarning[];
  readonly policy: RatingPolicySummary;
}

declare module '../../../core/api/maps' {
  interface QueryMap {
    'match.previewAngle': { args: PreviewAngleArgs; result: PreviewAngleResult };
  }
}

function slotOf(args: PreviewAngleArgs): SegmentRatingSlot {
  if (args.slot !== undefined) {
    return { ...args.slot };
  }
  return { role: args.slotRole ?? 'midcard' };
}

/** The slot's role, or a reason when the slot is not on the card. */
function roleOf(ctx: QueryContext, slot: SegmentRatingSlot): SlotRole {
  if ('role' in slot) {
    return slot.role;
  }
  try {
    return slotRoleOf(slot, { tunables: ctx.tunables }).value;
  } catch (error) {
    if (error instanceof RangeError) {
      return refuseQuery({ code: 'invalidSlot', message: error.message, field: 'slot' });
    }
    throw error;
  }
}

/** The refusals a rating cannot make itself: unknown or disallowed beats, empty groups, the limit. */
function beatReasons(ctx: QueryContext, args: PreviewAngleArgs, role: SlotRole): Reason[] {
  const { read, tunables } = ctx;
  const reasons: Reason[] = [];
  const angleType = angleTypeOf(read, args.angleTypeKey);
  if (angleType === undefined) {
    return [
      {
        code: 'unknownType',
        message: `There is no talking segment type ${args.angleTypeKey}.`,
        field: 'angleTypeKey',
      },
    ];
  }
  const durationClass = durationClassOf({ role, matchType: null }, { tunables }).value;
  const limit = beatLimitOf(durationClass, tunables).value;
  if (args.beats.length > limit) {
    reasons.push({
      code: PREVIEW_ANGLE_REASON_CODES.tooManyBeats,
      message: beatLimitMessage(durationClass, limit),
      field: 'beats',
    });
  }
  for (const [index, beat] of args.beats.entries()) {
    const field = `beats[${String(index)}]`;
    const catalogBeat = beatOf(read, beat.beatKey);
    if (catalogBeat === undefined) {
      reasons.push({
        code: PREVIEW_ANGLE_REASON_CODES.unknownBeat,
        message: `There is no beat ${beat.beatKey}.`,
        field: `${field}.beatKey`,
      });
      continue;
    }
    if (!isBeatAllowed(angleType, beat.beatKey)) {
      reasons.push({
        code: PREVIEW_ANGLE_REASON_CODES.beatNotAllowed,
        message: `${catalogBeat.name} is not part of ${angleType.name}.`,
        field: `${field}.beatKey`,
      });
    }
    const groups = [beat.groupOne, beat.groupTwo];
    for (const [groupIndex, people] of groups.entries()) {
      for (const [position, personId] of people.entries()) {
        if (!read.tables.people.has(personId)) {
          reasons.push({
            code: 'unknownPerson',
            message: `There is no person ${personId}.`,
            field: `${field}.${groupIndex === 0 ? 'groupOne' : 'groupTwo'}[${String(position)}]`,
            subject: { kind: 'person', id: personId },
          });
        }
      }
    }
    for (const [groupIndex, group] of catalogBeat.groups.entries()) {
      const people =
        catalogBeat.groups.length === 1
          ? beat.groupOne.length + beat.groupTwo.length
          : (groups[groupIndex]?.length ?? 0);
      if (people === 0 && !group.optional) {
        reasons.push({
          code: PREVIEW_ANGLE_REASON_CODES.emptyGroup,
          message: `Beat ${String(index + 1)}: ${catalogBeat.name} needs someone in ${group.label}.`,
          field: `${field}.${groupIndex === 0 ? 'groupOne' : 'groupTwo'}`,
        });
      }
    }
  }
  return reasons;
}

/** A manager override must name someone with the manager role. */
function managerReasons(ctx: QueryContext, args: PreviewAngleArgs): Reason[] {
  const reasons: Reason[] = [];
  for (const [personId, managerId] of Object.entries(args.managerOverrides ?? {})) {
    if (managerId === null) {
      continue;
    }
    const manager = ctx.read.tables.people.get(managerId);
    if (manager?.roles.includes('manager') !== true) {
      reasons.push({
        code: PREVIEW_ANGLE_REASON_CODES.notAManager,
        message:
          manager === undefined
            ? `There is no person ${managerId}.`
            : `${manager.defaultRingName} is not a manager.`,
        field: `managerOverrides[${personId}]`,
        subject: { kind: 'person', id: managerId },
      });
    }
  }
  return reasons;
}

/**
 * The participant sides the beats imply (`assignAngleSides`). When no sides fit, everyone goes on
 * one side: the beats still rate, and the `angle.sidesConflict` warning says what is wrong.
 */
function sidesOf(
  beats: readonly SegmentAngleBeat[],
  read: QueryContext['read'],
): SegmentRatingSide[] {
  const result = assignAngleSides(
    beats.map((beat) => ({
      groupOne: beat.groupOne,
      groupTwo: beat.groupTwo,
      twoGroups: (beatOf(read, beat.beatKey)?.groups.length ?? 1) > 1,
    })),
  );
  const order: PersonId[] = [];
  for (const beat of beats) {
    for (const personId of [...beat.groupOne, ...beat.groupTwo]) {
      if (!order.includes(personId)) {
        order.push(personId);
      }
    }
  }
  const bySide = new Map<number, PersonId[]>();
  for (const personId of order) {
    const side = 'sides' in result ? Math.min(result.sides[personId] ?? 0, MAX_SIDE) : 0;
    bySide.set(side, [...(bySide.get(side) ?? []), personId]);
  }
  return [...bySide.entries()]
    .sort(([left], [right]) => left - right)
    .map(([side, personIds]) => ({ side, personIds }));
}

/** `match.previewAngle`. See the file comment. */
export const previewAngleQuery: QueryDefinition<'match.previewAngle'> = defineQuery(
  'match.previewAngle',
  {
    args: PreviewAngleArgsSchema,
    run: (ctx, args) => {
      const { read } = ctx;
      if (!hasBeatCatalog(read)) {
        return refuseQuery({
          code: PREVIEW_ANGLE_REASON_CODES.noBeatCatalog,
          message: NO_BEAT_CATALOG_MESSAGE,
        });
      }
      const promotionId = labPromotionOf(read, ctx.viewer, args.promotionId);
      requireRegion(read, args.regionId);
      const slot = slotOf(args);
      const role = roleOf(ctx, slot);
      const reasons = [...beatReasons(ctx, args, role), ...managerReasons(ctx, args)];
      if (reasons.length > 0) {
        return refuseQuery(reasons);
      }

      const beats: SegmentAngleBeat[] = args.beats.map((beat) => ({
        beatKey: beat.beatKey,
        groupOne: [...beat.groupOne],
        groupTwo: [...beat.groupTwo],
      }));
      const input: SegmentRatingInput = {
        kind: 'angle',
        typeKey: args.angleTypeKey,
        sides: sidesOf(beats, read),
        slot,
        event: {
          importance: args.importance,
          regionId: args.regionId,
          televised: args.televised,
          date: ctx.date,
        },
        promotionId,
        angle: {
          beats,
          earlierBeatKeysOnCard: [...(args.earlierBeatKeysOnCard ?? [])],
          managerOverrides: { ...(args.managerOverrides ?? {}) },
          viewerPromotionIds: viewerPromotionIds(read, ctx.viewer),
        },
      };
      const rated = rateSegment(input, {
        read,
        tunables: ctx.tunables,
        mode: 'preview',
        seed: read.meta.seed,
        rng: anglePreviewStream(read.meta.seed, args.previewSeed),
      });
      if (!rated.ok) {
        return refuseQuery(rated.reasons);
      }
      const { angle } = rated.data;
      if (angle === undefined) {
        return refuseQuery({
          code: PREVIEW_ANGLE_REASON_CODES.noBeatCatalog,
          message: NO_BEAT_CATALOG_MESSAGE,
        });
      }
      return {
        previewSeed: args.previewSeed,
        score: rated.data.score,
        stars: rated.data.stars,
        delivered: angle.delivered,
        expected: rated.data.expectation,
        crowd: rated.data.crowd,
        starPower: rated.data.starPower,
        beats: angle.beats,
        durationClass: rated.data.slot.durationClass,
        beatLimit: { max: angle.beatLimit.max, message: angle.beatLimit.message },
        warnings: rated.data.warnings,
        policy: rated.data.policy,
      };
    },
  },
);

export const angleQueries: readonly QueryDefinition[] = [previewAngleQuery];
