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
import { ANGLE_SETTINGS, TALK_ROLES } from './entities/angle-setting';
import { hasDuplicates, zName } from './entities/entity-refinements';
import { zContentKey } from './primitives';
import type { WorldView } from './world';
import { BEAT_STATS } from '../systems/match/angles/beatStats';

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
// Beats and angle templates (MTCH5): the steps an angle is built from, and ready-made orders of
// them. Beats have no length (D-10). Design: docs/design/angle-rating.md.

/** The content-key namespace of beats (`beat.promo`) and angle templates (`template.solo-promo`). */
export const BEAT_KEY_PREFIX = 'beat';
export const ANGLE_TEMPLATE_KEY_PREFIX = 'template';
/** Longest beat name, beat description and group label. */
export const BEAT_NAME_MAX_LENGTH = 40;
export const BEAT_DESCRIPTION_MAX_LENGTH = 200;
export const BEAT_GROUP_LABEL_MAX_LENGTH = 24;
/** A beat has one or two groups of people. */
export const BEAT_GROUPS_MIN = 1;
export const BEAT_GROUPS_MAX = 2;
/** Each group is scored on 1-4 stats. */
export const BEAT_GROUP_STATS_MAX = 4;
/** Range of a group's weight inside its beat. */
export const BEAT_GROUP_WEIGHT_MIN = 0.1;
export const BEAT_GROUP_WEIGHT_MAX = 5;
/** Fewest and most people in one group. */
export const BEAT_GROUP_PEOPLE_MIN = 1;
export const BEAT_GROUP_PEOPLE_MAX = 6;
/** Range of a beat's weight in the angle's mean. */
export const BEAT_WEIGHT_MIN = 0.1;
export const BEAT_WEIGHT_MAX = 3;
/** Longest angle template name. */
export const ANGLE_TEMPLATE_NAME_MAX_LENGTH = 40;
/**
 * Most beats an angle template may have: the stored angle's limit (`MAX_ANGLE_BEATS` in
 * `entities/segment.ts`, not imported here to keep the model free of import cycles).
 */
export const ANGLE_TEMPLATE_BEATS_MAX = 8;

/** Beats in the same repetition group feel alike; MTCH5-03 tires a crowd of repeats. */
export const BEAT_REPETITION_GROUPS = [
  'talk',
  'violence',
  'faceoff',
  'ceremony',
  'video',
  'spectacle',
  'skit',
  'announcement',
] as const;
export type BeatRepetitionGroup = (typeof BEAT_REPETITION_GROUPS)[number];

/**
 * Each repetition group in the player's words, as it reads mid-sentence in the Why? panel
 * ("Second face-off beat in this angle"). MTCH5-09: the codes never reach the screen.
 */
export const BEAT_REPETITION_GROUP_LABELS: Readonly<Record<BeatRepetitionGroup, string>> = {
  talk: 'talk',
  violence: 'violent',
  faceoff: 'face-off',
  ceremony: 'ceremony',
  video: 'video',
  spectacle: 'spectacle',
  skit: 'skit',
  announcement: 'announcement',
};

/** A repetition group's readable name; a group this build does not know reads as itself. */
export function beatRepetitionGroupLabel(group: string): string {
  return (BEAT_REPETITION_GROUP_LABELS as Readonly<Record<string, string>>)[group] ?? group;
}

/** What an angle template is for; rival bookers (AIP4) pick by purpose. */
export const ANGLE_TEMPLATE_PURPOSES = [
  'promo',
  'startFeud',
  'buildFeud',
  'titleChallenge',
  'celebrate',
  'introduce',
  'announce',
] as const;
export type AngleTemplatePurpose = (typeof ANGLE_TEMPLATE_PURPOSES)[number];

/**
 * Who fills a template beat's group: side `a`, side `b`, both sides together (`ab`) or the host
 * (an interviewer or announcer who belongs to neither side).
 */
export const CAST_TOKENS = ['a', 'b', 'ab', 'host'] as const;
export type CastToken = (typeof CAST_TOKENS)[number];

export const BeatStatSchema = z.enum(BEAT_STATS);
export const TalkRoleSchema = z.enum(TALK_ROLES);
export const CatalogAngleSettingSchema = z.enum(ANGLE_SETTINGS);
/** MTCH5-08: talk roles, each once. */
export const talkRoleListSchema = z
  .array(TalkRoleSchema)
  .min(1)
  .refine((roles) => !hasDuplicates(roles), { message: 'Each role may appear only once' });
/** MTCH5-08: where a beat or an angle type may happen, each setting once. */
export const angleSettingListSchema = z
  .array(CatalogAngleSettingSchema)
  .min(1)
  .refine((settings) => !hasDuplicates(settings), { message: 'Each setting may appear only once' });
export const beatRepetitionGroupSchema = z.enum(BEAT_REPETITION_GROUPS);
export const angleTemplatePurposeSchema = z.enum(ANGLE_TEMPLATE_PURPOSES);
export const castTokenSchema = z.enum(CAST_TOKENS);
export const beatNameSchema = zName(BEAT_NAME_MAX_LENGTH);
export const beatDescriptionSchema = z.string().min(1).max(BEAT_DESCRIPTION_MAX_LENGTH);
export const beatWeightSchema = z.number().min(BEAT_WEIGHT_MIN).max(BEAT_WEIGHT_MAX);
export const angleTemplateNameSchema = zName(ANGLE_TEMPLATE_NAME_MAX_LENGTH);

const groupPeopleSchema = z.number().int().min(BEAT_GROUP_PEOPLE_MIN).max(BEAT_GROUP_PEOPLE_MAX);

/** One group of a beat: who it is, what they are scored on and how much they count. */
export const BeatGroupSchema = z
  .strictObject({
    /** Player text, such as "Speaker" or "Side A". */
    label: zName(BEAT_GROUP_LABEL_MAX_LENGTH),
    stats: z
      .array(BeatStatSchema)
      .min(1)
      .max(BEAT_GROUP_STATS_MAX)
      .refine((stats) => !hasDuplicates(stats), { message: 'Each stat may appear only once' }),
    weight: z.number().min(BEAT_GROUP_WEIGHT_MIN).max(BEAT_GROUP_WEIGHT_MAX),
    minPeople: groupPeopleSchema,
    maxPeople: groupPeopleSchema,
    /** The group may be left empty. Only the second group may be optional. */
    optional: z.boolean(),
    /** A manager may speak for this group (on mic and charisma only). */
    managerCanStandIn: z.boolean(),
    /**
     * MTCH5-08: the talk roles that suit this group (Host: an interviewer). Someone else in it is a
     * booking warning, never a block. Absent = anyone suits it.
     */
    roles: talkRoleListSchema.optional(),
  })
  .refine((group) => group.maxPeople >= group.minPeople, {
    message: 'must be at least minPeople',
    path: ['maxPeople'],
  });

export const beatGroupsSchema = z
  .array(BeatGroupSchema)
  .min(BEAT_GROUPS_MIN)
  .max(BEAT_GROUPS_MAX)
  .refine((groups) => groups[0]?.optional !== true, {
    message: 'the first group cannot be optional',
    path: [0, 'optional'],
  });

/** One beat of an angle template, cast by token. */
export interface AngleTemplateBeatShape {
  readonly groupTwo: CastToken | null;
  readonly optional: boolean;
}

/** Adds an issue when every beat of a template is optional. */
export function refineAngleTemplateBeats(
  beats: readonly AngleTemplateBeatShape[],
  context: z.RefinementCtx,
): void {
  if (beats.length > 0 && beats.every((beat) => beat.optional)) {
    context.addIssue({
      code: 'custom',
      message: 'at least one beat must not be optional',
      path: [],
    });
  }
}

/** A beat content key: `beat.<name>`. */
const beatKeySchema = zContentKey.refine((key) => key.startsWith(`${BEAT_KEY_PREFIX}.`), {
  message: `must be a beat content key starting with "${BEAT_KEY_PREFIX}."`,
});

/** An angle template content key: `template.<name>`. */
const angleTemplateKeySchema = zContentKey.refine(
  (key) => key.startsWith(`${ANGLE_TEMPLATE_KEY_PREFIX}.`),
  {
    message: `must be an angle template content key starting with "${ANGLE_TEMPLATE_KEY_PREFIX}."`,
  },
);

/** The beats an angle type allows: beat content keys, each once. */
export const beatKeyListSchema = z
  .array(beatKeySchema)
  .min(1)
  .refine((keys) => !hasDuplicates(keys), { message: 'Each beat may appear only once' });

/** Adds an issue when an angle type lists its beats and leaves out its default beat. */
export function refineAngleTypeBeats(
  angleType: { readonly defaultBeatKey: string; readonly beatKeys?: readonly string[] | undefined },
  context: z.RefinementCtx,
): void {
  if (angleType.beatKeys !== undefined && !angleType.beatKeys.includes(angleType.defaultBeatKey)) {
    context.addIssue({
      code: 'custom',
      message: `must include the default beat ${angleType.defaultBeatKey}`,
      path: ['beatKeys'],
    });
  }
}

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
export const AngleTypeDefSchema = z
  .strictObject({
    key: zContentKey,
    name: zName(CATALOG_NAME_MAX_LENGTH),
    shortName: zName(CATALOG_SHORT_NAME_MAX_LENGTH).optional(),
    order: orderSchema,
    /** The beat a new angle of this type starts with. MTCH5 owns the beat catalog. */
    defaultBeatKey: zContentKey,
    speakers: intRangeSchema(ANGLE_TYPE_SPEAKERS_MIN, ANGLE_TYPE_SPEAKERS_MAX, 'speakers'),
    speakerWeights: speakerWeightsSchema,
    /** MTCH5: the beats an angle of this type may use. Absent = every beat. */
    beatKeys: beatKeyListSchema.optional(),
    /** MTCH5-08: where an angle of this type may happen. Absent = every setting. */
    settings: angleSettingListSchema.optional(),
    hidden: z.boolean(),
    description: descriptionSchema.optional(),
  })
  .superRefine(refineAngleTypeBeats);

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

/** A beat: one step of an angle, its one or two groups and what they are scored on (MTCH5). */
export const BeatDefSchema = z.strictObject({
  key: beatKeySchema,
  name: beatNameSchema,
  description: beatDescriptionSchema,
  groups: beatGroupsSchema,
  /** A physical beat (contact, a fight) wears people like a match does (MTCH5-03). */
  physical: z.boolean(),
  repetitionGroup: beatRepetitionGroupSchema,
  /** How much the beat counts in the angle's mean, 0.1-3. */
  weight: beatWeightSchema,
  /** MTCH5-08: where the beat can happen. Absent = every setting. */
  settings: angleSettingListSchema.optional(),
});

/** One beat of an angle template: the beat and which cast fills each group. */
export const AngleTemplateBeatSchema = z.strictObject({
  beatKey: beatKeySchema,
  groupOne: castTokenSchema,
  /** Null when the beat has one group, or its optional second group is left empty. */
  groupTwo: castTokenSchema.nullable(),
  /** Dropped first when the slot cannot fit every beat. */
  optional: z.boolean(),
});

/** A ready-made angle: its type, purpose and beats in order (MTCH5). */
export const AngleTemplateDefSchema = z.strictObject({
  key: angleTemplateKeySchema,
  name: angleTemplateNameSchema,
  angleTypeKey: zContentKey,
  purpose: angleTemplatePurposeSchema,
  beats: z
    .array(AngleTemplateBeatSchema)
    .min(1)
    .max(ANGLE_TEMPLATE_BEATS_MAX)
    .superRefine(refineAngleTemplateBeats),
  /** MTCH5-08: where the template's angle happens. Absent = in the ring. */
  setting: CatalogAngleSettingSchema.optional(),
  description: descriptionSchema.optional(),
});

/** One catalog: its entries keyed by content key. */
export const MatchTypeCatalogSchema = z.record(zContentKey, MatchTypeDefSchema);
export const AngleTypeCatalogSchema = z.record(zContentKey, AngleTypeDefSchema);
export const MethodCatalogSchema = z.record(zContentKey, MethodDefSchema);
export const FinishCatalogSchema = z.record(zContentKey, FinishDefSchema);
export const InjuryCatalogSchema = z.record(zContentKey, InjuryKindSchema);
export const BeatCatalogSchema = z.record(zContentKey, BeatDefSchema);
export const AngleTemplateCatalogSchema = z.record(zContentKey, AngleTemplateDefSchema);

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
    /** MTCH5. A save started before beats existed has none (`hasBeatCatalog`). */
    beats: BeatCatalogSchema,
    /** MTCH5. Ready-made angles; absent with `beats` on older saves. */
    angleTemplates: AngleTemplateCatalogSchema,
  })
  .partial();

export type MatchTypeDef = z.infer<typeof MatchTypeDefSchema>;
export type AngleTypeDef = z.infer<typeof AngleTypeDefSchema>;
export type MethodDef = z.infer<typeof MethodDefSchema>;
export type FinishEntry = z.infer<typeof FinishEntrySchema>;
export type FinishDef = FinishEntry;
export type InjuryKind = z.infer<typeof InjuryKindSchema>;
export type BeatGroupDef = z.infer<typeof BeatGroupSchema>;
export type BeatDef = z.infer<typeof BeatDefSchema>;
export type AngleTemplateBeat = z.infer<typeof AngleTemplateBeatSchema>;
export type AngleTemplateDef = z.infer<typeof AngleTemplateDefSchema>;
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
type BeatCatalog = z.output<typeof BeatCatalogSchema>;
type AngleTemplateCatalog = z.output<typeof AngleTemplateCatalogSchema>;

const matchTypeCopies = new WeakMap<object, MatchTypeCatalog>();
const angleTypeCopies = new WeakMap<object, AngleTypeCatalog>();
const methodCopies = new WeakMap<object, MethodCatalog>();
const finishCopies = new WeakMap<object, FinishCatalog>();
const injuryCopies = new WeakMap<object, InjuryCatalog>();
const beatCopies = new WeakMap<object, BeatCatalog>();
const angleTemplateCopies = new WeakMap<object, AngleTemplateCatalog>();

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

function beatCatalog(read: CatalogReader): BeatCatalog | undefined {
  return frozenCatalog(beatCopies, BeatCatalogSchema, read.meta.catalogs.beats);
}

function angleTemplateCatalog(read: CatalogReader): AngleTemplateCatalog | undefined {
  return frozenCatalog(
    angleTemplateCopies,
    AngleTemplateCatalogSchema,
    read.meta.catalogs.angleTemplates,
  );
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
export function injuryKindOf(
  read: CatalogReader,
  key: ContentKey | string,
): InjuryKind | undefined {
  return entryOf(injuryCatalog(read), key);
}

/** True when the world holds a catalog of that name (even an empty one). */
export function hasCatalog(read: CatalogReader, name: CatalogName): boolean {
  return read.meta.catalogs[name] !== undefined;
}

/**
 * True when the world holds the beat catalog (MTCH5). A game started before beats existed has
 * none: angles there keep MTCH1's simple speaker score (MTCH5-03) and the lab says so (MTCH5-05).
 */
export function hasBeatCatalog(read: CatalogReader): boolean {
  return read.meta.catalogs.beats !== undefined;
}

/** Every beat, by key. Empty without a catalog. */
export function beatsOf(read: CatalogReader): readonly BeatDef[] {
  const catalog = beatCatalog(read);
  if (catalog === undefined) {
    return [];
  }
  return Object.values(catalog).sort((left, right) => compareText(left.key, right.key));
}

/** One beat by content key (`beat.promo`), or undefined. */
export function beatOf(read: CatalogReader, key: ContentKey | string): BeatDef | undefined {
  return entryOf(beatCatalog(read), key);
}

/** Every angle template, by key. Empty without a catalog. */
export function angleTemplatesOf(read: CatalogReader): readonly AngleTemplateDef[] {
  const catalog = angleTemplateCatalog(read);
  if (catalog === undefined) {
    return [];
  }
  return Object.values(catalog).sort((left, right) => compareText(left.key, right.key));
}

/** One angle template by content key (`template.solo-promo`), or undefined. */
export function angleTemplateOf(
  read: CatalogReader,
  key: ContentKey | string,
): AngleTemplateDef | undefined {
  return entryOf(angleTemplateCatalog(read), key);
}

/** True when an angle of `angleType` may use the beat `beatKey`; no `beatKeys` list allows all. */
export function isBeatAllowed(
  angleType: { readonly beatKeys?: readonly string[] | undefined },
  beatKey: ContentKey | string,
): boolean {
  return angleType.beatKeys === undefined || angleType.beatKeys.includes(beatKey);
}
