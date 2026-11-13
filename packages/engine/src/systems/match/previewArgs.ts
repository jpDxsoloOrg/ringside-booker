/**
 * The arguments every rating preview takes (`match.preview`, `match.previewBatch`, and later EVT4's
 * live forecast, AIP4's rival booker and POL2's balance lab), and the step that turns them into a
 * `SegmentRatingInput`. Keep the schema additive: those callers build these arguments.
 *
 * Design: docs/design/match-rating.md#previews.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import { INVALID_ARGS, refuseQuery } from '../../core/api/result';
import type { ContentKey } from '../../core/content-key';
import type { GameDate } from '../../core/date';
import type { PersonId, PromotionId, RegionId } from '../../core/ids';
import { zEventImportance, type EventImportance } from '../../model/entities/event-definition';
import { MAX_SIDE } from '../../model/entities/participant';
import { zContentKey, zId } from '../../model/primitives';
import type { GameWorldView } from '../../model/tables';
import type { SegmentKind, SegmentRatingInput } from './rating/types';
import { SLOT_ROLES, type SlotRole } from './slots';
import { zPreviewExtensionArgs, type PreviewExtensionArgs } from './previewExtensions';

/** The most people one side of a preview may hold. */
export const PREVIEW_MAX_SIDE_SIZE = 6;

/** The largest preview seed: seeds are whole numbers from 0 to 2^31 − 1. */
export const PREVIEW_SEED_MAX = 2 ** 31 - 1;

/** What a preview rates. */
export interface PreviewArgs {
  kind: SegmentKind;
  /** The match type (`match.*`) or angle type (`angle.*`). */
  typeKey: ContentKey;
  /** One entry per side; the array index is the stored 0-based side number. */
  sides: PersonId[][];
  slotRole: SlotRole;
  importance: EventImportance;
  regionId: RegionId;
  televised: boolean;
  /** The promotion running the show; left out, the viewer's first promotion. */
  promotionId?: PromotionId | undefined;
  /** Whole number, 0 to 2^31 − 1: the same seed always gives the same night. */
  previewSeed: number;
  /**
   * The segment's crew (MTCH4-05; MTCH8's Crew section fills the same field). Left out, no
   * producer. Only the physical toll reads it so far.
   */
  crew?: { producerId: PersonId | null } | undefined;
  /**
   * Preview extensions to run alongside (MTCH4-05, `previewExtensions.ts`), each with its own
   * arguments; an unknown id is refused. Left out, none run and the answer has no `extensions`.
   */
  extensions?: PreviewExtensionArgs | undefined;
}

const previewArgsShape = {
  kind: z.enum(['match', 'angle']),
  typeKey: zContentKey,
  sides: z
    .array(z.array(zId('person')).max(PREVIEW_MAX_SIDE_SIZE))
    .min(1)
    .max(MAX_SIDE + 1),
  slotRole: z.enum(SLOT_ROLES),
  importance: zEventImportance,
  regionId: zId('region'),
  televised: z.boolean(),
  promotionId: zId('promotion').optional(),
  previewSeed: z.number().int().min(0).max(PREVIEW_SEED_MAX),
  crew: z.strictObject({ producerId: zId('person').nullable() }).optional(),
  extensions: zPreviewExtensionArgs.optional(),
};

/** Zod schema for {@link PreviewArgs} (strict: unknown keys are refused). */
export const PreviewArgsSchema = z.strictObject(previewArgsShape);

/** The most runs one `match.previewBatch` call makes. */
export const PREVIEW_BATCH_MAX_RUNS = 500;

/** `match.previewBatch`: the preview arguments plus how many nights to run. */
export interface PreviewBatchArgs extends PreviewArgs {
  /** 1 to 500. Run `i` rolls with seed `previewSeed + i`. */
  runs: number;
}

/** Zod schema for {@link PreviewBatchArgs}. */
export const PreviewBatchArgsSchema = z.strictObject({
  ...previewArgsShape,
  runs: z.number().int().min(1).max(PREVIEW_BATCH_MAX_RUNS),
});

/**
 * The promotion a lab query runs for: `promotionId` when given (refused as `invalidArgs` when the
 * world has no such promotion), else the viewer's first promotion. A viewer who runs no promotion
 * (the all-seeing viewer) must name one.
 */
export function labPromotionOf(
  read: GameWorldView,
  viewer: Viewer,
  promotionId: PromotionId | undefined,
): PromotionId {
  if (promotionId !== undefined) {
    if (!read.tables.promotions.has(promotionId)) {
      return refuseQuery({
        code: INVALID_ARGS,
        message: `promotionId: there is no promotion ${promotionId}`,
        field: 'promotionId',
      });
    }
    return promotionId;
  }
  const [first] = viewerPromotionIds(read, viewer);
  if (first === undefined) {
    return refuseQuery({
      code: INVALID_ARGS,
      message: 'promotionId: pick the promotion running the show; this viewer runs none',
      field: 'promotionId',
    });
  }
  return first;
}

/** Refuses a region the world does not have. */
export function requireRegion(read: GameWorldView, regionId: RegionId): void {
  if (!read.tables.regions.has(regionId)) {
    refuseQuery({
      code: INVALID_ARGS,
      message: `regionId: there is no region ${regionId}`,
      field: 'regionId',
    });
  }
}

/** The rating input for a preview on `date`: the slot role is given outright, as the lab does. */
export function previewInputOf(
  args: PreviewArgs,
  promotionId: PromotionId,
  date: GameDate,
): SegmentRatingInput {
  return {
    kind: args.kind,
    typeKey: args.typeKey,
    sides: args.sides.map((personIds, side) => ({ side, personIds: [...personIds] })),
    slot: { role: args.slotRole },
    event: {
      importance: args.importance,
      regionId: args.regionId,
      televised: args.televised,
      date,
    },
    promotionId,
  };
}
