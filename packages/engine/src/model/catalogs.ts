/**
 * Runtime catalogs: the content-pack catalogs a game reads while it runs, snapshotted into the
 * world metadata at new game (`WorldMeta.catalogs`).
 *
 * Nothing rebuilds the content library when a save is loaded, so the catalogs a running game needs
 * travel inside the save. They are small, and a snapshot keeps an old save behaving the same after
 * the bundled catalogs change; a mod enabled mid-game does not change that game's catalogs.
 *
 * Each catalog is keyed by content key (`match.singles`, `angle.promo`, `method.pinfall`,
 * `finish.clean`) and holds the pack record with every default filled in. The object is partial: a world built without packs
 * (most test worlds, saves from before a catalog existed) has `catalogs: {}`, and a later feature
 * appends its own catalog without touching the ones here (WRK6-01 added `injuries`).
 *
 * Phases, queries and commands read catalogs only through the readers below.
 *
 * Format doc: docs/design/data-packs.md, "Match and segment catalogs".
 */

import { z } from 'zod';
import { isContentKey, type ContentKey } from '../core/content-key';
import { BodyPartSchema, RingStyleSchema } from './entities/person';
import { MAX_SIDE } from './entities/participant';
import { hasDuplicates, zName } from './entities/entity-refinements';
import { zContentKey } from './primitives';
import type { WorldView } from './world';

// ---------------------------------------------------------------------------------------------
// Limits shared with the pack record schemas

/** Display order runs 0..999; lower comes first. */
export const CATALOG_ORDER_MAX = 999;
/** Longest catalog entry name and short name. */
export const CATALOG_NAME_MAX_LENGTH = 60;
export const CATALOG_SHORT_NAME_MAX_LENGTH = 20;
/** Longest catalog entry description. */
export const CATALOG_DESCRIPTION_MAX_LENGTH = 300;
/** Fewest and most sides a match type may allow. Stored sides are 0..MAX_SIDE. */
export const MATCH_TYPE_SIDES_MIN = 2;
export const MATCH_TYPE_SIDES_MAX = MAX_SIDE + 1;
/** Fewest and most people on one side of a match type. */
export const MATCH_TYPE_SIDE_SIZE_MIN = 1;
export const MATCH_TYPE_SIDE_SIZE_MAX = 6;
/** Range of a match type's work-rate and crowd factors. */
export const MATCH_TYPE_FACTOR_MIN = 0.5;
export const MATCH_TYPE_FACTOR_MAX = 1.5;
/** D-10: a match type may push its slot's duration class one step down or up. */
export const DURATION_SHIFTS = [-1, 0, 1] as const;
export type DurationShift = (typeof DURATION_SHIFTS)[number];
/** Fewest and most speakers an angle type may allow. */
export const ANGLE_TYPE_SPEAKERS_MIN = 1;
export const ANGLE_TYPE_SPEAKERS_MAX = 12;

/** A whole-number range `{ min, max }` within `low..high`, where `max` must be at least `min`. */
export function intRangeSchema(low: number, high: number, field: string) {
  return z
    .strictObject({
      min: z.number().int().min(low).max(high),
      max: z.number().int().min(low).max(high),
    })
    .refine((range) => range.max >= range.min, {
      message: `must be at least ${field}.min`,
      path: ['max'],
    });
}

/** `-1`, `0` or `1`. */
export const DurationShiftSchema = z.union([z.literal(-1), z.literal(0), z.literal(1)]);

/** A work-rate or crowd factor, 0.5..1.5. */
export const matchTypeFactorSchema = z
  .number()
  .min(MATCH_TYPE_FACTOR_MIN)
  .max(MATCH_TYPE_FACTOR_MAX);

/** Ring styles a match type suits, each at most once. May be empty. */
export const styleAffinitySchema = z
  .array(RingStyleSchema)
  .refine((styles) => !hasDuplicates(styles), { message: 'Each style may appear only once' });

/** The stat mix of an angle type's simple speaker score: each 0..1, and not all 0. */
export const speakerWeightsSchema = z
  .strictObject({
    mic: z.number().min(0).max(1),
    charisma: z.number().min(0).max(1),
    presence: z.number().min(0).max(1),
  })
  .refine((weights) => weights.mic + weights.charisma + weights.presence > 0, {
    message: 'mic, charisma and presence must not all be 0',
  });

const orderSchema = z.number().int().min(0).max(CATALOG_ORDER_MAX);
const descriptionSchema = z.string().min(1).max(CATALOG_DESCRIPTION_MAX_LENGTH);

// ---------------------------------------------------------------------------------------------
// Finishes (MTCH2): how a match ends. Design: docs/design/match-finishes.md.

/** What sort of ending a finish is. */
export const FINISH_CATEGORIES = [
  'clean',
  'cheating',
  'countOut',
  'disqualification',
  'controversial',
  'draw',
  'noContest',
] as const;
export type FinishCategory = (typeof FINISH_CATEGORIES)[number];

/** The outcome kind a finish produces; the same kinds a segment's `outcome` has. */
export const FINISH_OUTCOME_KINDS = ['win', 'draw', 'noContest'] as const;
export type FinishOutcomeKind = (typeof FINISH_OUTCOME_KINDS)[number];

/** The content-key namespace of finishes: `finish.clean`. */
export const FINISH_KEY_PREFIX = 'finish';
/** Longest finish name and player summary. */
export const FINISH_NAME_MAX_LENGTH = 40;
export const FINISH_SUMMARY_MAX_LENGTH = 140;
/** Range of a finish's work-rate and crowd effects (whole steps). */
export const FINISH_EFFECT_MIN = -10;
export const FINISH_EFFECT_MAX = 10;
/** Range of a method's weight inside a finish. */
export const FINISH_METHOD_WEIGHT_MIN = 1;
export const FINISH_METHOD_WEIGHT_MAX = 100;
/** Range of a finish's winner and loser gain factors. */
export const FINISH_GAIN_MAX = 3;
/** Range of a finish's automatic-pick weight; 0 means never picked automatically. */
export const FINISH_AUTO_WEIGHT_MAX = 100;

export const finishCategorySchema = z.enum(FINISH_CATEGORIES);
export const finishOutcomeKindSchema = z.enum(FINISH_OUTCOME_KINDS);
export const finishMethodWeightSchema = z
  .number()
  .int()
  .min(FINISH_METHOD_WEIGHT_MIN)
  .max(FINISH_METHOD_WEIGHT_MAX);
export const finishEffectsSchema = z.strictObject({
  workRate: z.number().int().min(FINISH_EFFECT_MIN).max(FINISH_EFFECT_MAX),
  crowd: z.number().int().min(FINISH_EFFECT_MIN).max(FINISH_EFFECT_MAX),
});
export const finishGainsSchema = z.strictObject({
  winner: z.number().min(0).max(FINISH_GAIN_MAX),
  loser: z.number().min(0).max(FINISH_GAIN_MAX),
});
export const finishAutoWeightSchema = z.number().int().min(0).max(FINISH_AUTO_WEIGHT_MAX);
export const finishSummarySchema = zName(FINISH_SUMMARY_MAX_LENGTH);

/** The cross-field rules a finish obeys, shared by the pack record and the runtime entry. */
export interface FinishShapeForCheck {
  readonly outcomeKind: FinishOutcomeKind;
  readonly methods: readonly unknown[];
  readonly allowsTitleChange: boolean;
  readonly matchTypes?:
    | {
        readonly only?: readonly unknown[] | undefined;
        readonly except?: readonly unknown[] | undefined;
      }
    | undefined;
}

/**
 * Adds an issue for each broken finish rule: `methods` is non-empty exactly when the finish is a
 * win, a draw or no contest never changes a title, and `matchTypes` names `only` or `except`, not
 * both.
 */
export function refineFinish(finish: FinishShapeForCheck, context: z.RefinementCtx): void {
  if (finish.outcomeKind === 'win' && finish.methods.length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'a win finish needs at least one method',
      path: ['methods'],
    });
  }
  if (finish.outcomeKind !== 'win' && finish.methods.length > 0) {
    context.addIssue({
      code: 'custom',
      message: `a ${finish.outcomeKind} finish has no methods`,
      path: ['methods'],
    });
  }
  if (finish.outcomeKind !== 'win' && finish.allowsTitleChange) {
    context.addIssue({
      code: 'custom',
      message: `a ${finish.outcomeKind} finish cannot change a title`,
      path: ['allowsTitleChange'],
    });
  }
  if (finish.matchTypes?.only !== undefined && finish.matchTypes.except !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'list matchTypes.only or matchTypes.except, not both',
      path: ['matchTypes'],
    });
  }
}

/** A finish content key: `finish.<name>`. */
const finishKeySchema = zContentKey.refine((key) => key.startsWith(`${FINISH_KEY_PREFIX}.`), {
  message: `must be a finish content key starting with "${FINISH_KEY_PREFIX}."`,
});

const contentKeyListSchema = z
  .array(zContentKey)
  .refine((keys) => !hasDuplicates(keys), { message: 'Each key may appear only once' });

// ---------------------------------------------------------------------------------------------
// Injuries (WRK6-01): the kinds of injury a person can pick up. Design: docs/design/data-packs.md,
// "Health".

/** The content-key namespace of injury kinds: `injury.sprained-ankle`. */
export const INJURY_KEY_PREFIX = 'injury';
/** Longest injury label and description. */
export const INJURY_LABEL_MAX_LENGTH = 60;
export const INJURY_DESCRIPTION_MAX_LENGTH = 300;
/** Shortest and longest time out, in days (two years at most). */
export const INJURY_DAYS_MIN = 1;
export const INJURY_DAYS_MAX = 730;
/** Range of an injury kind's pick weight; must be above 0. */
export const INJURY_WEIGHT_MAX = 100;
/** Range of each severity weight; at least one must be above 0. */
export const INJURY_SEVERITY_WEIGHT_MAX = 100;
/** The severities an injury roll picks between (WRK6-03 owns their multipliers). */
export const INJURY_SEVERITIES = ['minor', 'moderate', 'severe'] as const;
export type InjurySeverity = (typeof INJURY_SEVERITIES)[number];

export const injuryLabelSchema = zName(INJURY_LABEL_MAX_LENGTH);
export const injuryDescriptionSchema = z.string().min(1).max(INJURY_DESCRIPTION_MAX_LENGTH);
export const injuryDaysSchema = z.number().int().min(INJURY_DAYS_MIN).max(INJURY_DAYS_MAX);
export const injuryWeightSchema = z.number().gt(0).max(INJURY_WEIGHT_MAX);
export const injuryAnglesChanceSchema = z.number().min(0).max(1);

const severityWeightSchema = z.number().min(0).max(INJURY_SEVERITY_WEIGHT_MAX);

/** How often each severity is picked for this kind, relative to the others. Not all 0. */
export const injurySeverityWeightsSchema = z
  .strictObject({
    minor: severityWeightSchema,
    moderate: severityWeightSchema,
    severe: severityWeightSchema,
  })
  .refine((weights) => weights.minor + weights.moderate + weights.severe > 0, {
    message: 'minor, moderate and severe must not all be 0',
  });

/** The cross-field rule an injury kind obeys, shared by the pack record and the runtime entry. */
export function refineInjuryKind(
  kind: { readonly minDays: number; readonly maxDays: number },
  context: z.RefinementCtx,
): void {
  if (kind.maxDays < kind.minDays) {
    context.addIssue({
      code: 'custom',
      message: 'must be at least minDays',
      path: ['maxDays'],
    });
  }
}

/** An injury content key: `injury.<name>`. */
const injuryKeySchema = zContentKey.refine((key) => key.startsWith(`${INJURY_KEY_PREFIX}.`), {
  message: `must be an injury content key starting with "${INJURY_KEY_PREFIX}."`,
});

// ---------------------------------------------------------------------------------------------
// Runtime shapes

/** A match type with every default filled in. */
export const MatchTypeDefSchema = z.strictObject({
  key: zContentKey,
  name: zName(CATALOG_NAME_MAX_LENGTH),
  shortName: zName(CATALOG_SHORT_NAME_MAX_LENGTH).optional(),
  order: orderSchema,
  sides: intRangeSchema(MATCH_TYPE_SIDES_MIN, MATCH_TYPE_SIDES_MAX, 'sides'),
  sideSize: intRangeSchema(MATCH_TYPE_SIDE_SIZE_MIN, MATCH_TYPE_SIDE_SIZE_MAX, 'sideSize'),
  equalSides: z.boolean(),
  durationShift: DurationShiftSchema,
  workRateFactor: matchTypeFactorSchema,
  crowdFactor: matchTypeFactorSchema,
  styleAffinity: styleAffinitySchema,
  allowsTitles: z.boolean(),
  hidden: z.boolean(),
  description: descriptionSchema.optional(),
});

/** An angle type with every default filled in. */
export const AngleTypeDefSchema = z.strictObject({
  key: zContentKey,
  name: zName(CATALOG_NAME_MAX_LENGTH),
  shortName: zName(CATALOG_SHORT_NAME_MAX_LENGTH).optional(),
  order: orderSchema,
  /** The beat a new angle of this type starts with. MTCH5 owns the beat catalog. */
  defaultBeatKey: zContentKey,
  speakers: intRangeSchema(ANGLE_TYPE_SPEAKERS_MIN, ANGLE_TYPE_SPEAKERS_MAX, 'speakers'),
  speakerWeights: speakerWeightsSchema,
  hidden: z.boolean(),
  description: descriptionSchema.optional(),
});

/** A win method with every default filled in. */
export const MethodDefSchema = z.strictObject({
  key: zContentKey,
  name: zName(CATALOG_NAME_MAX_LENGTH),
  order: orderSchema,
  /** True when a win by this method can move a title. */
  changesTitles: z.boolean(),
  hidden: z.boolean(),
  description: descriptionSchema.optional(),
});

/**
 * A finish: how a match ends. Effects are structured numbers (whole steps the rating reads), never
 * modifier strings. `methods` hold method content keys and `matchTypes` match type content keys.
 */
export const FinishEntrySchema = z
  .strictObject({
    key: finishKeySchema,
    name: zName(FINISH_NAME_MAX_LENGTH),
    /** Display order, lower first, ties by key. */
    order: orderSchema,
    /** One line for the player. */
    summary: finishSummarySchema,
    category: finishCategorySchema,
    outcomeKind: finishOutcomeKindSchema,
    /** The win methods it allows, with their pick weights. Empty unless `outcomeKind` is `win`. */
    methods: z.array(z.strictObject({ methodKey: zContentKey, weight: finishMethodWeightSchema })),
    effects: finishEffectsSchema,
    /** A title on the line may change hands. */
    allowsTitleChange: z.boolean(),
    /** Popularity gain factors for the winner and loser (MTCH3 reads them). */
    gains: finishGainsSchema,
    /** Weight when a finish is picked automatically; 0 = never picked automatically. */
    autoWeight: finishAutoWeightSchema,
    /** Only for matches with exactly two sides. */
    requiresTwoSides: z.boolean(),
    /** Which match types allow it: only these, all but these, or (both left out) every type. */
    matchTypes: z.strictObject({
      only: contentKeyListSchema.optional(),
      except: contentKeyListSchema.optional(),
    }),
  })
  .superRefine(refineFinish);

/** The runtime finish entry; the same schema under the name the other catalogs use. */
export const FinishDefSchema = FinishEntrySchema;

/** A kind of injury: where it is, how long it keeps someone out and how often it is picked. */
export const InjuryKindSchema = z
  .strictObject({
    key: injuryKeySchema,
    /** Player text, such as "Sprained ankle". */
    label: injuryLabelSchema,
    bodyPart: BodyPartSchema,
    /** Shortest and longest time out, in days, before severity is applied. */
    minDays: injuryDaysSchema,
    maxDays: injuryDaysSchema,
    /** How often this kind is picked relative to the others, above 0 and at most 100. */
    weight: injuryWeightSchema,
    /** Chance (0..1) the injured person can still appear in talking segments. */
    canWorkAnglesChance: injuryAnglesChanceSchema,
    severityWeights: injurySeverityWeightsSchema,
    description: injuryDescriptionSchema.optional(),
  })
  .superRefine(refineInjuryKind);

/** One catalog: its entries keyed by content key. */
export const MatchTypeCatalogSchema = z.record(zContentKey, MatchTypeDefSchema);
export const AngleTypeCatalogSchema = z.record(zContentKey, AngleTypeDefSchema);
export const MethodCatalogSchema = z.record(zContentKey, MethodDefSchema);
export const FinishCatalogSchema = z.record(zContentKey, FinishDefSchema);
export const InjuryCatalogSchema = z.record(zContentKey, InjuryKindSchema);

/**
 * The catalogs snapshotted into a world at new game, keyed by content key. Every catalog is
 * optional: a world built without packs has none. Later features append their own catalog here.
 */
export const CatalogsSchema = z
  .strictObject({
    angleTypes: AngleTypeCatalogSchema,
    matchTypes: MatchTypeCatalogSchema,
    methods: MethodCatalogSchema,
    /** MTCH2. A save started before finishes existed has none. */
    finishes: FinishCatalogSchema,
    /** WRK6-01. A save started before injuries existed has none. */
    injuries: InjuryCatalogSchema,
  })
  .partial();

export type MatchTypeDef = z.infer<typeof MatchTypeDefSchema>;
export type AngleTypeDef = z.infer<typeof AngleTypeDefSchema>;
export type MethodDef = z.infer<typeof MethodDefSchema>;
export type FinishEntry = z.infer<typeof FinishEntrySchema>;
export type FinishDef = FinishEntry;
export type InjuryKind = z.infer<typeof InjuryKindSchema>;
export type Catalogs = z.infer<typeof CatalogsSchema>;
export type CatalogName = keyof Catalogs;

// ---------------------------------------------------------------------------------------------
// Readers

/** What a reader needs: anything with the world metadata (a `WorldView`, a transaction's view). */
export type CatalogReader = Pick<WorldView, 'meta'>;

export interface CatalogListOptions {
  /** Include entries marked `hidden` (default false). */
  readonly includeHidden?: boolean;
}

interface CatalogEntry {
  readonly key: string;
  readonly order: number;
  readonly hidden: boolean;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    const children: unknown[] = Object.values(value);
    for (const child of children) {
      deepFreeze(child);
    }
  }
  return value;
}

/**
 * A frozen copy of one stored catalog, made once per stored catalog object. The copy is parsed
 * with the catalog's schema, which both types it and leaves the stored metadata untouched.
 */
function frozenCatalog<Schema extends z.ZodType>(
  cache: WeakMap<object, z.output<Schema>>,
  schema: Schema,
  catalog: object | undefined,
): z.output<Schema> | undefined {
  if (catalog === undefined) {
    return undefined;
  }
  const cached = cache.get(catalog);
  if (cached !== undefined) {
    return cached;
  }
  const copy = deepFreeze(schema.parse(catalog));
  cache.set(catalog, copy);
  return copy;
}

type MatchTypeCatalog = z.output<typeof MatchTypeCatalogSchema>;
type AngleTypeCatalog = z.output<typeof AngleTypeCatalogSchema>;
type MethodCatalog = z.output<typeof MethodCatalogSchema>;
type FinishCatalog = z.output<typeof FinishCatalogSchema>;
type InjuryCatalog = z.output<typeof InjuryCatalogSchema>;

const matchTypeCopies = new WeakMap<object, MatchTypeCatalog>();
const angleTypeCopies = new WeakMap<object, AngleTypeCatalog>();
const methodCopies = new WeakMap<object, MethodCatalog>();
const finishCopies = new WeakMap<object, FinishCatalog>();
const injuryCopies = new WeakMap<object, InjuryCatalog>();

function matchTypeCatalog(read: CatalogReader): MatchTypeCatalog | undefined {
  return frozenCatalog(matchTypeCopies, MatchTypeCatalogSchema, read.meta.catalogs.matchTypes);
}

function angleTypeCatalog(read: CatalogReader): AngleTypeCatalog | undefined {
  return frozenCatalog(angleTypeCopies, AngleTypeCatalogSchema, read.meta.catalogs.angleTypes);
}

function methodCatalog(read: CatalogReader): MethodCatalog | undefined {
  return frozenCatalog(methodCopies, MethodCatalogSchema, read.meta.catalogs.methods);
}

function finishCatalog(read: CatalogReader): FinishCatalog | undefined {
  return frozenCatalog(finishCopies, FinishCatalogSchema, read.meta.catalogs.finishes);
}

function injuryCatalog(read: CatalogReader): InjuryCatalog | undefined {
  return frozenCatalog(injuryCopies, InjuryCatalogSchema, read.meta.catalogs.injuries);
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

function compareEntries(
  left: Pick<CatalogEntry, 'key' | 'order'>,
  right: Pick<CatalogEntry, 'key' | 'order'>,
): number {
  if (left.order !== right.order) {
    return left.order - right.order;
  }
  if (left.key === right.key) {
    return 0;
  }
  return left.key < right.key ? -1 : 1;
}

function listOf<Entry extends CatalogEntry>(
  catalog: Readonly<Record<ContentKey, Entry>> | undefined,
  options: CatalogListOptions,
): readonly Entry[] {
  if (catalog === undefined) {
    return [];
  }
  const includeHidden = options.includeHidden ?? false;
  return Object.values(catalog)
    .filter((entry) => includeHidden || !entry.hidden)
    .sort(compareEntries);
}

function entryOf<Entry>(
  catalog: Readonly<Record<ContentKey, Entry>> | undefined,
  key: string,
): Entry | undefined {
  if (catalog === undefined || !isContentKey(key) || !Object.hasOwn(catalog, key)) {
    return undefined;
  }
  return catalog[key];
}

/** Every match type, by `order` then key; hidden ones only when asked. Empty without a catalog. */
export function matchTypesOf(
  read: CatalogReader,
  options: CatalogListOptions = {},
): readonly MatchTypeDef[] {
  return listOf(matchTypeCatalog(read), options);
}

/** One match type by content key (`match.singles`), hidden or not, or undefined. */
export function matchTypeOf(
  read: CatalogReader,
  key: ContentKey | string,
): MatchTypeDef | undefined {
  return entryOf(matchTypeCatalog(read), key);
}

/** Every angle type, by `order` then key; hidden ones only when asked. Empty without a catalog. */
export function angleTypesOf(
  read: CatalogReader,
  options: CatalogListOptions = {},
): readonly AngleTypeDef[] {
  return listOf(angleTypeCatalog(read), options);
}

/** One angle type by content key (`angle.promo`), hidden or not, or undefined. */
export function angleTypeOf(
  read: CatalogReader,
  key: ContentKey | string,
): AngleTypeDef | undefined {
  return entryOf(angleTypeCatalog(read), key);
}

/** Every win method, by `order` then key; hidden ones only when asked. Empty without a catalog. */
export function methodsOf(
  read: CatalogReader,
  options: CatalogListOptions = {},
): readonly MethodDef[] {
  return listOf(methodCatalog(read), options);
}

/** One win method by content key (`method.pinfall`), hidden or not, or undefined. */
export function methodOf(read: CatalogReader, key: ContentKey | string): MethodDef | undefined {
  return entryOf(methodCatalog(read), key);
}

/** Every finish, by `order` then key. Empty without a catalog. Finishes are never hidden. */
export function finishesOf(read: CatalogReader): readonly FinishEntry[] {
  const catalog = finishCatalog(read);
  if (catalog === undefined) {
    return [];
  }
  return Object.values(catalog).sort(compareEntries);
}

/** One finish by content key (`finish.clean`), or undefined. */
export function finishOf(read: CatalogReader, key: ContentKey | string): FinishEntry | undefined {
  return entryOf(finishCatalog(read), key);
}

/** Every injury kind, by key. Empty without a catalog. Injury kinds are never hidden. */
export function injuryCatalogOf(read: CatalogReader): readonly InjuryKind[] {
  const catalog = injuryCatalog(read);
  if (catalog === undefined) {
    return [];
  }
  return Object.values(catalog).sort((left, right) => compareText(left.key, right.key));
}

/** One injury kind by content key (`injury.sprained-ankle`), or undefined. */
export function injuryKindOf(read: CatalogReader, key: ContentKey | string): InjuryKind | undefined {
  return entryOf(injuryCatalog(read), key);
}

/** True when the world holds a catalog of that name (even an empty one). */
export function hasCatalog(read: CatalogReader, name: CatalogName): boolean {
  return read.meta.catalogs[name] !== undefined;
}
