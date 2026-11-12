/**
 * Match and segment catalog records: the match types, angle types and win methods booking offers
 * and match rating reads (MTCH1).
 *
 * - A **match type** says how many sides a match has and how many people stand on each, whether
 *   the sides must be the same size, how it moves its slot's duration class (D-10: never minutes),
 *   how it scales work rate and crowd reaction, which ring styles suit it and whether titles can
 *   be on the line.
 * - An **angle type** is a kind of talking segment: the beat it starts with, how many speakers it
 *   takes and the stat mix of its simple speaker score.
 * - A **method** is how a match is won, and whether a win that way can move a title.
 * - A **finish** is how a match ends (MTCH2): its category and outcome kind, the methods a win
 *   that way uses, its work-rate and crowd effects, whether a title can change hands, the winner
 *   and loser gain factors and its automatic-pick weight. Unlike the other three it refers to
 *   other kinds: `methods[].methodKey` names a method and `matchTypes.only` / `except` name match
 *   types, as pack references the loader checks.
 *
 * These records never become entities. The loader snapshots the merged records into
 * `WorldMeta.catalogs` at new game, keyed by content key: pack key `singles` becomes
 * `match.singles`, `promo` becomes `angle.promo`, `pinfall` becomes `method.pinfall` and `clean`
 * becomes `finish.clean`.
 *
 * Format doc: docs/design/data-packs.md, "Match and segment catalogs".
 */

import { z } from 'zod';
import { parseContentKey, type ContentKey } from '../../../core/content-key';
import {
  ANGLE_TYPE_SPEAKERS_MAX,
  type Catalogs,
  ANGLE_TYPE_SPEAKERS_MIN,
  CATALOG_DESCRIPTION_MAX_LENGTH,
  CATALOG_NAME_MAX_LENGTH,
  CATALOG_ORDER_MAX,
  CATALOG_SHORT_NAME_MAX_LENGTH,
  DurationShiftSchema,
  intRangeSchema,
  MATCH_TYPE_SIDE_SIZE_MAX,
  MATCH_TYPE_SIDE_SIZE_MIN,
  MATCH_TYPE_SIDES_MAX,
  MATCH_TYPE_SIDES_MIN,
  matchTypeFactorSchema,
  speakerWeightsSchema,
  styleAffinitySchema,
  type AngleTypeDef,
  type MatchTypeDef,
  type MethodDef,
  FINISH_NAME_MAX_LENGTH,
  finishAutoWeightSchema,
  finishCategorySchema,
  finishEffectsSchema,
  finishGainsSchema,
  finishMethodWeightSchema,
  finishOutcomeKindSchema,
  finishSummarySchema,
  refineFinish,
  type FinishDef,
} from '../../../model/catalogs';
import { zContentKey } from '../../../model/primitives';
import { zName } from '../../../model/entities/entity-refinements';
import { defineRecordKind } from '../fields';
import {
  EACH_ELEMENT,
  keySchema,
  parseRef,
  refListSchema,
  refSchema,
  type PackKey,
  type PackRef,
  type RecordReference,
} from '../keys';
import type { MergedRecords } from '../merge';

/** The content-key namespace of each catalog. */
export const MATCH_TYPE_CONTENT_PREFIX = 'match';
export const ANGLE_TYPE_CONTENT_PREFIX = 'angle';
export const METHOD_CONTENT_PREFIX = 'method';
export const FINISH_CONTENT_PREFIX = 'finish';
/** The namespace an angle type's default beat must be in (MTCH5's beat catalog). */
export const BEAT_CONTENT_PREFIX = 'beat';

/** The content key a match type is stored under: `singles` → `match.singles`. */
export function matchTypeContentKey(packKey: PackKey | string): ContentKey {
  return parseContentKey(`${MATCH_TYPE_CONTENT_PREFIX}.${packKey}`);
}

/** The content key an angle type is stored under: `promo` → `angle.promo`. */
export function angleTypeContentKey(packKey: PackKey | string): ContentKey {
  return parseContentKey(`${ANGLE_TYPE_CONTENT_PREFIX}.${packKey}`);
}

/** The content key a method is stored under: `pinfall` → `method.pinfall`. */
export function methodContentKey(packKey: PackKey | string): ContentKey {
  return parseContentKey(`${METHOD_CONTENT_PREFIX}.${packKey}`);
}

/** The content key a finish is stored under: `clean` → `finish.clean`. */
export function finishContentKey(packKey: PackKey | string): ContentKey {
  return parseContentKey(`${FINISH_CONTENT_PREFIX}.${packKey}`);
}

const nameSchema = zName(CATALOG_NAME_MAX_LENGTH);
const shortNameSchema = zName(CATALOG_SHORT_NAME_MAX_LENGTH);
const orderSchema = z.number().int().min(0).max(CATALOG_ORDER_MAX);
const descriptionSchema = z.string().min(1).max(CATALOG_DESCRIPTION_MAX_LENGTH);

/** A default beat: a content key in the `beat.` namespace. MTCH5 checks that it resolves. */
const defaultBeatKeySchema = zContentKey.refine(
  (key) => key.startsWith(`${BEAT_CONTENT_PREFIX}.`),
  { message: `must be a beat content key starting with "${BEAT_CONTENT_PREFIX}."` },
);

export const matchTypeRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    name: nameSchema,
    shortName: shortNameSchema.optional(),
    /** Display order, 0-999; lower comes first, ties by key. */
    order: orderSchema,
    /** How many sides the match has. */
    sides: intRangeSchema(MATCH_TYPE_SIDES_MIN, MATCH_TYPE_SIDES_MAX, 'sides'),
    /** How many people stand on each side. */
    sideSize: intRangeSchema(MATCH_TYPE_SIDE_SIZE_MIN, MATCH_TYPE_SIDE_SIZE_MAX, 'sideSize'),
    /** Every side must have the same number of people. Left out = true. */
    equalSides: z.boolean().optional(),
    /** D-10: pushes the slot's duration class one step down (-1) or up (1). */
    durationShift: DurationShiftSchema,
    /** Multiplies the work-rate part of the rating, 0.5-1.5. Left out = 1. */
    workRateFactor: matchTypeFactorSchema.optional(),
    /** Multiplies the crowd part of the rating, 0.5-1.5. Left out = 1. */
    crowdFactor: matchTypeFactorSchema.optional(),
    /** Ring styles that suit the match type. May be empty. */
    styleAffinity: styleAffinitySchema,
    /** Titles may be on the line. Left out = true. */
    allowsTitles: z.boolean().optional(),
    /** Kept out of booking lists unless asked for. Left out = false. */
    hidden: z.boolean().optional(),
    description: descriptionSchema.optional(),
  }),
);

export const angleTypeRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    name: nameSchema,
    shortName: shortNameSchema.optional(),
    order: orderSchema,
    /** A content key (`beat.promo`), not a pack reference: MTCH5 owns the beat catalog. */
    defaultBeatKey: defaultBeatKeySchema,
    speakers: intRangeSchema(ANGLE_TYPE_SPEAKERS_MIN, ANGLE_TYPE_SPEAKERS_MAX, 'speakers'),
    /** The stat mix of the simple speaker score, each 0-1 and not all 0. */
    speakerWeights: speakerWeightsSchema,
    hidden: z.boolean().optional(),
    description: descriptionSchema.optional(),
  }),
);

export const methodRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    name: nameSchema,
    order: orderSchema,
    /** A win by this method can move a title. */
    changesTitles: z.boolean(),
    hidden: z.boolean().optional(),
    description: descriptionSchema.optional(),
  }),
);

export const finishRecord = defineRecordKind(
  z.strictObject({
    key: keySchema,
    name: zName(FINISH_NAME_MAX_LENGTH),
    /** Display order, 0-999; lower comes first, ties by key. */
    order: orderSchema,
    /** One line for the player, at most 140 characters. */
    summary: finishSummarySchema,
    category: finishCategorySchema,
    outcomeKind: finishOutcomeKindSchema,
    /** The methods a win this way uses, by method key, with pick weights 1-100. Empty unless a win. */
    methods: z.array(z.strictObject({ methodKey: refSchema, weight: finishMethodWeightSchema })),
    /** Whole-step effects on the rating's work-rate and crowd parts, -10 to 10. */
    effects: finishEffectsSchema,
    /** A title on the line may change hands. Never true for a draw or no contest. */
    allowsTitleChange: z.boolean(),
    /** Popularity gain factors, 0-3, for the winner and the loser. */
    gains: finishGainsSchema,
    /** Weight when a finish is picked automatically, 0-100; 0 = never. */
    autoWeight: finishAutoWeightSchema,
    /** Only for matches with exactly two sides. */
    requiresTwoSides: z.boolean(),
    /** Only these match types, or every type but these. Left out = every type. */
    matchTypes: z
      .strictObject({ only: refListSchema.optional(), except: refListSchema.optional() })
      .optional(),
  }),
  refineFinish,
);

export type MatchTypeRecord = z.output<typeof matchTypeRecord.full>;
export type AngleTypeRecord = z.output<typeof angleTypeRecord.full>;
export type MethodRecord = z.output<typeof methodRecord.full>;
export type FinishRecord = z.output<typeof finishRecord.full>;

// ---------------------------------------------------------------------------------------------
// Records to runtime entries, defaults filled in

/** A match type record as its runtime catalog entry. */
export function toMatchTypeDef(record: MatchTypeRecord): MatchTypeDef {
  return {
    key: matchTypeContentKey(record.key),
    name: record.name,
    ...(record.shortName === undefined ? {} : { shortName: record.shortName }),
    order: record.order,
    sides: { ...record.sides },
    sideSize: { ...record.sideSize },
    equalSides: record.equalSides ?? true,
    durationShift: record.durationShift,
    workRateFactor: record.workRateFactor ?? 1,
    crowdFactor: record.crowdFactor ?? 1,
    styleAffinity: [...record.styleAffinity],
    allowsTitles: record.allowsTitles ?? true,
    hidden: record.hidden ?? false,
    ...(record.description === undefined ? {} : { description: record.description }),
  };
}

/** An angle type record as its runtime catalog entry. */
export function toAngleTypeDef(record: AngleTypeRecord): AngleTypeDef {
  return {
    key: angleTypeContentKey(record.key),
    name: record.name,
    ...(record.shortName === undefined ? {} : { shortName: record.shortName }),
    order: record.order,
    defaultBeatKey: record.defaultBeatKey,
    speakers: { ...record.speakers },
    speakerWeights: { ...record.speakerWeights },
    hidden: record.hidden ?? false,
    ...(record.description === undefined ? {} : { description: record.description }),
  };
}

/** A method record as its runtime catalog entry. */
export function toMethodDef(record: MethodRecord): MethodDef {
  return {
    key: methodContentKey(record.key),
    name: record.name,
    order: record.order,
    changesTitles: record.changesTitles,
    hidden: record.hidden ?? false,
    ...(record.description === undefined ? {} : { description: record.description }),
  };
}

function keyOf(ref: PackRef): string {
  return parseRef(ref).key;
}

/** A finish record as its runtime catalog entry, its references turned into content keys. */
export function toFinishDef(record: FinishRecord): FinishDef {
  const { only, except } = record.matchTypes ?? {};
  return {
    key: finishContentKey(record.key),
    name: record.name,
    order: record.order,
    summary: record.summary,
    category: record.category,
    outcomeKind: record.outcomeKind,
    methods: record.methods.map((method) => ({
      methodKey: methodContentKey(keyOf(method.methodKey)),
      weight: method.weight,
    })),
    effects: { ...record.effects },
    allowsTitleChange: record.allowsTitleChange,
    gains: { ...record.gains },
    autoWeight: record.autoWeight,
    requiresTwoSides: record.requiresTwoSides,
    matchTypes: {
      ...(only === undefined ? {} : { only: only.map((ref) => matchTypeContentKey(keyOf(ref))) }),
      ...(except === undefined
        ? {}
        : { except: except.map((ref) => matchTypeContentKey(keyOf(ref))) }),
    },
  };
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/** One kind's merged records as runtime entries keyed by content key, in pack-key order. */
function catalogOf<PackRecord, Def extends { readonly key: ContentKey }>(
  merged: ReadonlyMap<string, { readonly record: PackRecord }>,
  toDef: (record: PackRecord) => Def,
): Record<string, Def> | undefined {
  if (merged.size === 0) {
    return undefined;
  }
  const catalog: Record<string, Def> = {};
  for (const key of [...merged.keys()].sort(compareText)) {
    const entry = merged.get(key);
    if (entry !== undefined) {
      const def = toDef(entry.record);
      catalog[def.key] = def;
    }
  }
  return catalog;
}

/**
 * The runtime catalogs for `WorldMeta.catalogs`, from merged pack records: every match type,
 * angle type, method and finish keyed by content key, in key order. A kind no pack defines is left out, so
 * nothing checks segment keys against a catalog that does not exist.
 */
export function catalogsFromRecords(
  records: Pick<MergedRecords, 'matchType' | 'angleType' | 'method' | 'finish'>,
): Catalogs {
  const angleTypes = catalogOf(records.angleType, toAngleTypeDef);
  const matchTypes = catalogOf(records.matchType, toMatchTypeDef);
  const methods = catalogOf(records.method, toMethodDef);
  const finishes = catalogOf(records.finish, toFinishDef);
  return {
    ...(angleTypes === undefined ? {} : { angleTypes }),
    ...(matchTypes === undefined ? {} : { matchTypes }),
    ...(methods === undefined ? {} : { methods }),
    ...(finishes === undefined ? {} : { finishes }),
  };
}

// ---------------------------------------------------------------------------------------------
// Reference fields. `defaultBeatKey` is a content key, not a pack reference. A finish names
// methods and match types by pack key.

export const matchTypeReferences = [] as const satisfies readonly RecordReference[];

export const angleTypeReferences = [] as const satisfies readonly RecordReference[];

export const methodReferences = [] as const satisfies readonly RecordReference[];

export const finishReferences = [
  { path: ['methods', EACH_ELEMENT, 'methodKey'], target: 'method' },
  { path: ['matchTypes', 'only', EACH_ELEMENT], target: 'matchType' },
  { path: ['matchTypes', 'except', EACH_ELEMENT], target: 'matchType' },
] as const satisfies readonly RecordReference[];
