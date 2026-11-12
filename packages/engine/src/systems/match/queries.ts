/**
 * The match system's queries.
 *
 * - `match.catalog`: the match types, angle types and win methods booking and the Match lab can
 *   offer, from the world's catalog snapshot.
 * - `match.slotRoles`: the role, duration class and weight of every slot of a show format, with
 *   the traces inline (a query cannot store traces).
 *
 * Neither is secret, so every viewer sees the same answer. Design: docs/design/match-rating.md.
 */

import { z } from 'zod';
import { defineQuery, type QueryDefinition } from '../../core/api/query';
import { INVALID_ARGS, refuseQuery, type Reason } from '../../core/api/result';
import type { ContentKey } from '../../core/content-key';
import type { TraceNode } from '../../core/trace';
import {
  angleTypesOf,
  matchTypeOf,
  matchTypesOf,
  methodsOf,
  type MatchTypeDef,
} from '../../model/catalogs';
import type { DurationShift } from '../../model/catalogs';
import { zContentKey } from '../../model/primitives';
import {
  DURATION_CLASS_LABELS,
  SLOT_ROLE_LABELS,
  durationClassOf,
  slotRoleOf,
  slotWeightOf,
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
  hidden: boolean;
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

declare module '../../core/api/maps' {
  interface QueryMap {
    'match.catalog': { args: { includeHidden?: boolean | undefined }; result: MatchCatalog };
    'match.slotRoles': { args: SlotRolesArgs; result: SlotRoleRow[] };
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

export const catalogQuery: QueryDefinition<'match.catalog'> = defineQuery('match.catalog', {
  args: z.strictObject({ includeHidden: z.boolean().optional() }),
  run: (ctx, args) => {
    const options = { includeHidden: args.includeHidden ?? false };
    if (matchTypesOf(ctx.read, { includeHidden: true }).length === 0) {
      return { matchTypes: [], angleTypes: [], methods: [], available: false };
    }
    return {
      matchTypes: matchTypesOf(ctx.read, options).map(matchTypeOption),
      angleTypes: angleTypesOf(ctx.read, options).map((def) => ({
        key: def.key,
        name: def.name,
        shortName: def.shortName ?? def.name,
        order: def.order,
        speakers: range(def.speakers),
        hidden: def.hidden,
      })),
      methods: methodsOf(ctx.read, options).map((def) => ({
        key: def.key,
        name: def.name,
        order: def.order,
        changesTitles: def.changesTitles,
        hidden: def.hidden,
      })),
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

export const matchQueries: readonly QueryDefinition[] = [catalogQuery, slotRolesQuery];
