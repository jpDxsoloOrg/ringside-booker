/**
 * The match system's queries.
 *
 * - `match.catalog`: the match types, angle types and win methods booking and the Match lab can
 *   offer, from the world's catalog snapshot, plus the beats each angle type allows and the angle
 *   templates (MTCH5), so the web never hard-codes them.
 * - `match.slotRoles`: the role, duration class and weight of every slot of a show format, with
 *   the traces inline (a query cannot store traces).
 * - `match.slotInfo` (MTCH1-07): the duration class and weight one slot role gives a segment of a
 *   given kind and type, with their traces, for the Match lab's chips before a Run.
 *
 * - `match.finishes` (MTCH2): the finishes a match of a given type and side count may end with,
 *   with their effects, title flag and methods. Design: docs/design/match-finishes.md.
 * - `match.preview`, `match.previewBatch` (`previewQueries.ts`), `match.labOptions` and
 *   `match.labWorkers` (`labQueries.ts`) (MTCH1-06): the Match lab's rating previews on a detached
 *   stream and its setup queries. Their `QueryMap` entries sit beside them.
 * - `match.simulate`, `match.simulateBatch` and `match.resultMode` (`simulateQuery.ts`, MTCH2-04,
 *   MTCH2-07): the lab's Run for a match, which resolves a plan and rates the match with its
 *   finish (once, or many times with the outcomes counted), and whether Random winners decides the
 *   viewer's results.
 *
 * None is secret, so every viewer sees the same answer. Design: docs/design/match-rating.md.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import { INVALID_ARGS, refuseQuery, type Reason } from '../../core/api/result';
import type { ContentKey } from '../../core/content-key';
import type { TraceNode } from '../../core/trace';
import {
  angleTemplatesOf,
  angleTypesOf,
  beatsOf,
  isBeatAllowed,
  matchTypeOf,
  matchTypesOf,
  methodsOf,
  type AngleTemplateDef,
  type AngleTemplatePurpose,
  type BeatDef,
  type BeatRepetitionGroup,
  type CastToken,
  type MatchTypeDef,
} from '../../model/catalogs';
import type { BeatStat } from './angles/beatStats';
import type { DurationShift } from '../../model/catalogs';
import { zContentKey } from '../../model/primitives';
import { MAX_SIDE } from '../../model/entities/participant';
import type { SegmentKind } from './rating/types';
import {
  FINISH_OUTCOME_KINDS,
  methodOf,
  type FinishCategory,
  type FinishOutcomeKind,
} from '../../model/catalogs';
import { allowedFinishes, type FinishEntry } from './finishes/allowed';
import { labQueries } from './labQueries';
import { previewBatchQuery, previewQuery } from './previewQueries';
import { simulateQueries } from './simulateQuery';
import {
  DURATION_CLASS_LABELS,
  SLOT_ROLE_LABELS,
  durationClassOf,
  slotRoleOf,
  slotWeightOf,
  SLOT_ROLES,
  type DurationClass,
  type SlotRole,
} from './slots';

/** Smallest and largest main card `match.slotRoles` accepts. */
export const SLOT_ROLES_MIN_SLOTS = 3;
export const SLOT_ROLES_MAX_SLOTS = 12;
/** Most pre-show slots `match.slotRoles` accepts. */
export const SLOT_ROLES_MAX_PRE_SHOW_SLOTS = 3;

/** A whole-number range. */
export interface CountRange {
  min: number;
  max: number;
}

/** A match type as booking and the lab offer it. */
export interface MatchTypeOption {
  key: ContentKey;
  name: string;
  /** The short name, or the name when the type has none. */
  shortName: string;
  order: number;
  /** How many sides the match may have. */
  sides: CountRange;
  /** How many people may stand on one side. */
  sideSize: CountRange;
  equalSides: boolean;
  /** D-10: -1, 0 or 1 step on the slot's duration class. */
  durationShift: DurationShift;
  /** True when a title may be on the line. */
  allowsTitles: boolean;
  hidden: boolean;
}

/** An angle type as booking and the lab offer it. */
export interface AngleTypeOption {
  key: ContentKey;
  name: string;
  /** The short name, or the name when the type has none. */
  shortName: string;
  order: number;
  /** How many people may speak. */
  speakers: CountRange;
  /** MTCH5: the beats an angle of this type may use, by key. Empty without a beat catalog. */
  beatKeys: ContentKey[];
  /**
   * MTCH5-05: the beat a new angle of this type starts with, or null on a save without a beat
   * catalog. Always one of `beatKeys` when set. Optional so hand-made catalogs (gallery fixtures)
   * may leave it out; `match.catalog` always sets it.
   */
  defaultBeatKey?: ContentKey | null | undefined;
  hidden: boolean;
}

/** One group of a beat as the lab offers it (MTCH5). */
export interface BeatGroupOption {
  label: string;
  stats: BeatStat[];
  weight: number;
  minPeople: number;
  maxPeople: number;
  optional: boolean;
  managerCanStandIn: boolean;
}

/** A beat as the lab offers it (MTCH5). Beats have no length. */
export interface BeatOption {
  key: ContentKey;
  name: string;
  description: string;
  groups: BeatGroupOption[];
  physical: boolean;
  repetitionGroup: BeatRepetitionGroup;
  weight: number;
}

/** One beat of an angle template (MTCH5). */
export interface AngleTemplateBeatOption {
  beatKey: ContentKey;
  groupOne: CastToken;
  groupTwo: CastToken | null;
  optional: boolean;
}

/** An angle template as the lab offers it (MTCH5). */
export interface AngleTemplateOption {
  key: ContentKey;
  name: string;
  angleTypeKey: ContentKey;
  purpose: AngleTemplatePurpose;
  beats: AngleTemplateBeatOption[];
  /** How many beats are left once every optional beat is dropped. */
  requiredBeatCount: number;
  description: string | null;
}

/** A win method as booking and the lab offer it. */
export interface MethodOption {
  key: ContentKey;
  name: string;
  order: number;
  /** True when a win by this method can move a title. */
  changesTitles: boolean;
  hidden: boolean;
}

/** `match.catalog`. */
export interface MatchCatalog {
  matchTypes: MatchTypeOption[];
  angleTypes: AngleTypeOption[];
  methods: MethodOption[];
  /** MTCH5: every beat, by key. Empty on a save started before beats existed. */
  beats: BeatOption[];
  /** MTCH5: every angle template, by key. Empty on a save started before beats existed. */
  angleTemplates: AngleTemplateOption[];
  /** False when the world has no match types (a save from before catalogs); every list is empty. */
  available: boolean;
}

/** `match.slotRoles` arguments. */
export interface SlotRolesArgs {
  /** Main-card slots, 3..12. */
  slots: number;
  /** Pre-show slots, 0..3. */
  preShowSlots: number;
  /**
   * One entry per slot, pre-show first: the segment's match type, or null for a talking segment
   * or an empty slot. Omitted, no slot is shifted.
   */
  matchTypeKeys?: (ContentKey | null)[] | undefined;
}

/** One slot of a show format. Nothing here is stored; it is derived from the position. */
export interface SlotRoleRow {
  /** 1-based, counted separately on the pre-show and the main card. */
  slot: number;
  preShow: boolean;
  role: SlotRole;
  roleLabel: string;
  durationClass: DurationClass;
  durationLabel: string;
  weight: number;
  roleTrace: TraceNode;
  durationTrace: TraceNode;
  weightTrace: TraceNode;
}

/** `match.slotInfo` arguments. */
export interface SlotInfoArgs {
  slotRole: SlotRole;
  kind: SegmentKind;
  /** The match type, for a match (required there); ignored for a talking segment. */
  typeKey?: ContentKey | undefined;
}

/** `match.slotInfo`: what one slot role gives a segment, with the rules that decided it. */
export interface SlotInfo {
  role: SlotRole;
  roleLabel: string;
  durationClass: DurationClass;
  durationLabel: string;
  weight: number;
  durationTrace: TraceNode;
  weightTrace: TraceNode;
}

/** `match.finishes` arguments. */
export interface FinishesArgs {
  matchTypeKey: ContentKey;
  /** Sides actually built, 2..30; left out, the match type's minimum. */
  sideCount?: number | undefined;
  /** Stipulations on the match, for the filters MTCH7 registers. */
  stipulationKeys?: ContentKey[] | undefined;
  /** Only finishes with this outcome kind. */
  outcomeKind?: FinishOutcomeKind | undefined;
}

/** A win method a finish allows. */
export interface FinishMethodOption {
  key: ContentKey;
  name: string;
  /** True when a win by this method can move a title. */
  changesTitles: boolean;
}

/** A finish as booking and the lab offer it. */
export interface FinishOption {
  key: ContentKey;
  name: string;
  summary: string;
  category: FinishCategory;
  outcomeKind: FinishOutcomeKind;
  /** A title on the line may change hands. */
  allowsTitleChange: boolean;
  /** Whole-step effects on the rating's work-rate and crowd parts. */
  effects: { workRate: number; crowd: number };
  methods: FinishMethodOption[];
  /** True when the finish can be picked automatically (`autoWeight > 0`). */
  autoPickable: boolean;
}

/** `match.finishes` refusal codes. */
export const FINISHES_REASON_CODES = {
  unknownMatchType: 'unknownMatchType',
  noFinishCatalog: 'noFinishCatalog',
} as const;

declare module '../../core/api/maps' {
  interface QueryMap {
    'match.catalog': { args: { includeHidden?: boolean | undefined }; result: MatchCatalog };
    'match.slotRoles': { args: SlotRolesArgs; result: SlotRoleRow[] };
    'match.slotInfo': { args: SlotInfoArgs; result: SlotInfo };
    'match.finishes': { args: FinishesArgs; result: FinishOption[] };
  }
}

function range(value: { readonly min: number; readonly max: number }): CountRange {
  return { min: value.min, max: value.max };
}

function matchTypeOption(def: MatchTypeDef): MatchTypeOption {
  return {
    key: def.key,
    name: def.name,
    shortName: def.shortName ?? def.name,
    order: def.order,
    sides: range(def.sides),
    sideSize: range(def.sideSize),
    equalSides: def.equalSides,
    durationShift: def.durationShift,
    allowsTitles: def.allowsTitles,
    hidden: def.hidden,
  };
}

function beatOption(def: BeatDef): BeatOption {
  return {
    key: def.key,
    name: def.name,
    description: def.description,
    groups: def.groups.map((group) => ({ ...group, stats: [...group.stats] })),
    physical: def.physical,
    repetitionGroup: def.repetitionGroup,
    weight: def.weight,
  };
}

function angleTemplateOption(def: AngleTemplateDef): AngleTemplateOption {
  return {
    key: def.key,
    name: def.name,
    angleTypeKey: def.angleTypeKey,
    purpose: def.purpose,
    beats: def.beats.map((beat) => ({ ...beat })),
    requiredBeatCount: def.beats.filter((beat) => !beat.optional).length,
    description: def.description ?? null,
  };
}

export const catalogQuery: QueryDefinition<'match.catalog'> = defineQuery('match.catalog', {
  args: z.strictObject({ includeHidden: z.boolean().optional() }),
  run: (ctx, args) => {
    const options = { includeHidden: args.includeHidden ?? false };
    if (matchTypesOf(ctx.read, { includeHidden: true }).length === 0) {
      return {
        matchTypes: [],
        angleTypes: [],
        methods: [],
        beats: [],
        angleTemplates: [],
        available: false,
      };
    }
    const beats = beatsOf(ctx.read);
    return {
      matchTypes: matchTypesOf(ctx.read, options).map(matchTypeOption),
      angleTypes: angleTypesOf(ctx.read, options).map((def) => ({
        key: def.key,
        name: def.name,
        shortName: def.shortName ?? def.name,
        order: def.order,
        speakers: range(def.speakers),
        beatKeys: beats.filter((beat) => isBeatAllowed(def, beat.key)).map((beat) => beat.key),
        defaultBeatKey: beats.some((beat) => beat.key === def.defaultBeatKey)
          ? def.defaultBeatKey
          : null,
        hidden: def.hidden,
      })),
      methods: methodsOf(ctx.read, options).map((def) => ({
        key: def.key,
        name: def.name,
        order: def.order,
        changesTitles: def.changesTitles,
        hidden: def.hidden,
      })),
      beats: beats.map(beatOption),
      angleTemplates: angleTemplatesOf(ctx.read).map(angleTemplateOption),
      available: true,
    };
  },
});

const slotRolesArgs = z
  .strictObject({
    slots: z.number().int().min(SLOT_ROLES_MIN_SLOTS).max(SLOT_ROLES_MAX_SLOTS),
    preShowSlots: z.number().int().min(0).max(SLOT_ROLES_MAX_PRE_SHOW_SLOTS),
    matchTypeKeys: z.array(zContentKey.nullable()).optional(),
  })
  .refine(
    (args) =>
      args.matchTypeKeys === undefined ||
      args.matchTypeKeys.length === args.slots + args.preShowSlots,
    { message: 'must have one entry per slot, pre-show first', path: ['matchTypeKeys'] },
  );

interface SlotPlace {
  readonly slot: number;
  readonly preShow: boolean;
}

function placesOf(slots: number, preShowSlots: number): SlotPlace[] {
  const places: SlotPlace[] = [];
  for (let index = 1; index <= preShowSlots; index += 1) {
    places.push({ slot: index, preShow: true });
  }
  for (let index = 1; index <= slots; index += 1) {
    places.push({ slot: index, preShow: false });
  }
  return places;
}

export const slotRolesQuery: QueryDefinition<'match.slotRoles'> = defineQuery('match.slotRoles', {
  args: slotRolesArgs,
  run: (ctx, args) => {
    const places = placesOf(args.slots, args.preShowSlots);
    const keys = args.matchTypeKeys ?? [];
    const matchTypes: (MatchTypeDef | null)[] = [];
    const unknown: Reason[] = [];
    places.forEach((_, index) => {
      const key = keys[index] ?? null;
      if (key === null) {
        matchTypes.push(null);
        return;
      }
      const matchType = matchTypeOf(ctx.read, key);
      if (matchType === undefined) {
        const field = `matchTypeKeys[${String(index)}]`;
        unknown.push({
          code: INVALID_ARGS,
          message: `${field}: there is no match type "${key}"`,
          field,
        });
      }
      matchTypes.push(matchType ?? null);
    });
    if (unknown.length > 0) {
      return refuseQuery(unknown);
    }

    const deps = { tunables: ctx.tunables };
    return places.map((place, index) => {
      const role = slotRoleOf({ ...place, slots: args.slots }, deps);
      const duration = durationClassOf(
        { role: role.value, matchType: matchTypes[index] ?? null },
        deps,
      );
      const weight = slotWeightOf({ role: role.value }, deps);
      return {
        slot: place.slot,
        preShow: place.preShow,
        role: role.value,
        roleLabel: SLOT_ROLE_LABELS[role.value],
        durationClass: duration.value,
        durationLabel: DURATION_CLASS_LABELS[duration.value],
        weight: weight.value,
        roleTrace: role.trace,
        durationTrace: duration.trace,
        weightTrace: weight.trace,
      };
    });
  },
});

const slotInfoArgs = z.strictObject({
  slotRole: z.enum(SLOT_ROLES),
  kind: z.enum(['match', 'angle']),
  typeKey: zContentKey.optional(),
});

/**
 * `match.slotInfo`. A match is shifted by its match type (refused as `invalidArgs` when the type
 * is missing or unknown); a talking segment never is, whatever `typeKey` says.
 */
export const slotInfoQuery: QueryDefinition<'match.slotInfo'> = defineQuery('match.slotInfo', {
  args: slotInfoArgs,
  run: (ctx, args) => {
    let matchType: MatchTypeDef | null = null;
    if (args.kind === 'match') {
      if (args.typeKey === undefined) {
        return refuseQuery({
          code: INVALID_ARGS,
          message: 'typeKey: pick the match type',
          field: 'typeKey',
        });
      }
      matchType = matchTypeOf(ctx.read, args.typeKey) ?? null;
      if (matchType === null) {
        return refuseQuery({
          code: INVALID_ARGS,
          message: `typeKey: there is no match type "${args.typeKey}"`,
          field: 'typeKey',
        });
      }
    }
    const deps = { tunables: ctx.tunables };
    const duration = durationClassOf({ role: args.slotRole, matchType }, deps);
    const weight = slotWeightOf({ role: args.slotRole }, deps);
    return {
      role: args.slotRole,
      roleLabel: SLOT_ROLE_LABELS[args.slotRole],
      durationClass: duration.value,
      durationLabel: DURATION_CLASS_LABELS[duration.value],
      weight: weight.value,
      durationTrace: duration.trace,
      weightTrace: weight.trace,
    };
  },
});

const finishesArgs = z.strictObject({
  matchTypeKey: zContentKey,
  sideCount: z
    .number()
    .int()
    .min(2)
    .max(MAX_SIDE + 1)
    .optional(),
  stipulationKeys: z.array(zContentKey).optional(),
  outcomeKind: z.enum(FINISH_OUTCOME_KINDS).optional(),
});

export const finishesQuery: QueryDefinition<'match.finishes'> = defineQuery('match.finishes', {
  args: finishesArgs,
  run: (ctx, args) => {
    const { catalogs } = ctx.read.meta;
    if (catalogs.finishes === undefined) {
      return refuseQuery({
        code: FINISHES_REASON_CODES.noFinishCatalog,
        message: 'This save was started before finishes existed. Start a new game to use finishes.',
      });
    }
    if (matchTypeOf(ctx.read, args.matchTypeKey) === undefined) {
      return refuseQuery({
        code: FINISHES_REASON_CODES.unknownMatchType,
        field: 'matchTypeKey',
        message: `There is no match type "${args.matchTypeKey}".`,
      });
    }
    const finishes = allowedFinishes(catalogs, {
      matchTypeKey: args.matchTypeKey,
      sideCount: args.sideCount,
      stipulationKeys: args.stipulationKeys,
    });
    return finishes
      .filter((finish) => args.outcomeKind === undefined || finish.outcomeKind === args.outcomeKind)
      .map((finish) => finishOption(ctx.read, finish));
  },
});

function finishOption(read: Parameters<typeof methodOf>[0], finish: FinishEntry): FinishOption {
  return {
    key: finish.key,
    name: finish.name,
    summary: finish.summary,
    category: finish.category,
    outcomeKind: finish.outcomeKind,
    allowsTitleChange: finish.allowsTitleChange,
    effects: { workRate: finish.effects.workRate, crowd: finish.effects.crowd },
    methods: finish.methods.map((method) => {
      const def = methodOf(read, method.methodKey);
      return {
        key: method.methodKey,
        name: def?.name ?? method.methodKey,
        changesTitles: def?.changesTitles ?? false,
      };
    }),
    autoPickable: finish.autoWeight > 0,
  };
}

export const matchQueries: readonly QueryDefinition[] = [
  catalogQuery,
  slotRolesQuery,
  slotInfoQuery,
  finishesQuery,
  // The Match lab's previews and setup queries (MTCH1-06).
  previewQuery,
  previewBatchQuery,
  ...labQueries,
  // The lab's Simulate, its batch and the result mode (MTCH2-04, MTCH2-07).
  ...simulateQueries,
];
