/**
 * `rateSegment`: the one entry point that rates a segment from plain input.
 *
 * It checks the input's structure, works out the slot, resolves the rating policy, builds the
 * rating context, calls the registered rater for the segment's kind and attaches the segment's
 * warnings. It never writes and never touches the world's RNG: the only stream it uses is the one
 * the caller passes (a detached one for the lab, the world's `match.rating` stream for EVT3).
 *
 * Design: docs/design/match-rating.md#pipeline-and-seams.
 */

import type { Reason, QueryResult } from '../../../core/api/result';
import { RegistryError } from '../../../core/errors';
import type { RngStream } from '../../../core/rng/registry';
import { startDecision, type Traced } from '../../../core/trace';
import {
  angleTypeOf,
  matchTypeOf,
  type AngleTypeDef,
  type MatchTypeDef,
} from '../../../model/catalogs';
import { MAX_SIDE } from '../../../model/entities/participant';
import type { GameWorldView } from '../../../model/tables';
import type { EngineTunables } from '../../tunables';
import {
  SLOT_ROLES,
  SLOT_ROLE_LABELS,
  SLOTS_DOC_REF,
  durationClassOf,
  slotRoleOf,
  slotWeightOf,
  type SlotRole,
} from '../slots';
import './builtins';
import type { RatingContext, RatingMode } from './context';
import { ratingPolicyFor } from './policy';
import { segmentRaterFor } from './registry';
import { segmentWarnings } from './segmentWarnings';
import type { SegmentRatingInput, SegmentRatingResult, SlotDerivation } from './types';

/** The reason codes `rateSegment` refuses with. */
export const RATE_SEGMENT_REASON_CODES = [
  'unknownType',
  'emptySide',
  'unknownPerson',
  'invalidSide',
  'invalidSlot',
  'unknownPromotion',
] as const;

export interface RateSegmentOptions {
  readonly read: GameWorldView;
  readonly tunables: EngineTunables;
  /** Defaults to `preview`. */
  readonly mode?: RatingMode;
  /** The seed a preview's detached stream came from. Defaults to "". */
  readonly seed?: string;
  /** The stream the variance rolls draw from; left out or null, no rolls. */
  readonly rng?: RngStream | null;
}

export const GIVEN_ROLE_NOTE = 'Role chosen directly, not from a card position';

/** The type the input names: a match type for a match, an angle type for an angle. */
interface ResolvedType {
  readonly matchType?: MatchTypeDef;
  readonly angleType?: AngleTypeDef;
}

function resolveType(input: SegmentRatingInput, read: GameWorldView): ResolvedType | Reason {
  const kind: string = input.kind;
  if (kind === 'match') {
    const matchType = matchTypeOf(read, input.typeKey);
    return matchType === undefined
      ? {
          code: 'unknownType',
          message: `There is no match type ${input.typeKey}.`,
          field: 'typeKey',
        }
      : { matchType };
  }
  if (kind === 'angle') {
    const angleType = angleTypeOf(read, input.typeKey);
    return angleType === undefined
      ? {
          code: 'unknownType',
          message: `There is no talking segment type ${input.typeKey}.`,
          field: 'typeKey',
        }
      : { angleType };
  }
  return {
    code: 'unknownType',
    message: `"${kind}" is not a kind of segment: it must be a match or an angle.`,
    field: 'kind',
  };
}

function isReason(value: ResolvedType | Reason): value is Reason {
  return 'code' in value;
}

/** Sides, people and the promotion. */
function structureReasons(input: SegmentRatingInput, read: GameWorldView): Reason[] {
  const reasons: Reason[] = [];
  if (input.sides.length === 0) {
    reasons.push({ code: 'emptySide', message: 'The segment has no sides.', field: 'sides' });
  }
  const seenSides = new Set<number>();
  for (const [index, side] of input.sides.entries()) {
    const field = `sides[${String(index)}]`;
    if (!Number.isInteger(side.side) || side.side < 0 || side.side > MAX_SIDE) {
      reasons.push({
        code: 'invalidSide',
        message: `Side numbers run from 0 to ${String(MAX_SIDE)}; got ${String(side.side)}.`,
        field: `${field}.side`,
      });
    } else if (seenSides.has(side.side)) {
      reasons.push({
        code: 'invalidSide',
        message: `Side ${String(side.side + 1)} is listed twice.`,
        field: `${field}.side`,
      });
    }
    seenSides.add(side.side);
    if (side.personIds.length === 0) {
      reasons.push({
        code: 'emptySide',
        message: `Side ${String(side.side + 1)} has nobody on it.`,
        field: `${field}.personIds`,
      });
    }
    for (const [position, personId] of side.personIds.entries()) {
      if (!read.tables.people.has(personId)) {
        reasons.push({
          code: 'unknownPerson',
          message: `There is no person ${personId}.`,
          field: `${field}.personIds[${String(position)}]`,
          subject: { kind: 'person', id: personId },
        });
      }
    }
  }
  if (!read.tables.promotions.has(input.promotionId)) {
    reasons.push({
      code: 'unknownPromotion',
      message: `There is no promotion ${input.promotionId}.`,
      field: 'promotionId',
    });
  }
  return reasons;
}

function isSlotRole(value: string): value is SlotRole {
  return SLOT_ROLES.some((role) => role === value);
}

/** A role given outright, traced like `slotRoleOf`'s answer. */
function givenRole(role: SlotRole): Traced<SlotRole> {
  return startDecision<SlotRole>('Slot role', { docRef: SLOTS_DOC_REF })
    .note(GIVEN_ROLE_NOTE)
    .choose(role, `${SLOT_ROLE_LABELS[role]} chosen`);
}

/** The slot's role trace, or a reason when the slot is not on the card. */
function roleOf(input: SegmentRatingInput, tunables: EngineTunables): Traced<SlotRole> | Reason {
  const { slot } = input;
  if ('role' in slot) {
    const role: string = slot.role;
    return isSlotRole(role)
      ? givenRole(role)
      : { code: 'invalidSlot', message: `"${role}" is not a slot role.`, field: 'slot.role' };
  }
  try {
    return slotRoleOf(slot, { tunables });
  } catch (error) {
    if (error instanceof RangeError) {
      return { code: 'invalidSlot', message: error.message, field: 'slot' };
    }
    throw error;
  }
}

function isTracedRole(value: Traced<SlotRole> | Reason): value is Traced<SlotRole> {
  return 'trace' in value;
}

function slotDerivation(
  roleTrace: Traced<SlotRole>,
  matchType: MatchTypeDef | undefined,
  tunables: EngineTunables,
): SlotDerivation {
  const role = roleTrace.value;
  const durationTrace = durationClassOf({ role, matchType: matchType ?? null }, { tunables });
  const weightTrace = slotWeightOf({ role }, { tunables });
  return {
    role,
    durationClass: durationTrace.value,
    weight: weightTrace.value,
    roleTrace,
    durationTrace,
    weightTrace,
  };
}

/**
 * Rates a match or talking segment. Refuses with `unknownType`, `emptySide`, `unknownPerson`,
 * `invalidSide`, `invalidSlot` or `unknownPromotion` when the input does not describe a segment the
 * world can rate; booking problems that still rate (a third side, an injured worker) come back as
 * `warnings` on the result.
 *
 * @throws RegistryError when no rater is registered for the kind (the built-ins always are).
 */
export function rateSegment(
  input: SegmentRatingInput,
  options: RateSegmentOptions,
): QueryResult<SegmentRatingResult> {
  const { read, tunables } = options;
  const resolved = resolveType(input, read);
  const reasons: Reason[] = isReason(resolved) ? [resolved] : [];
  reasons.push(...structureReasons(input, read));
  const roleTrace = roleOf(input, tunables);
  if (!isTracedRole(roleTrace)) {
    reasons.push(roleTrace);
  }
  if (reasons.length > 0 || isReason(resolved) || !isTracedRole(roleTrace)) {
    return { ok: false, reasons };
  }

  const rater = segmentRaterFor(input.kind);
  if (rater === undefined) {
    throw new RegistryError(`No segment rater is registered for "${input.kind}"`, {
      kind: input.kind,
    });
  }
  const slot = slotDerivation(roleTrace, resolved.matchType, tunables);
  const ctx: RatingContext = {
    mode: options.mode ?? 'preview',
    seed: options.seed ?? '',
    read,
    date: input.event.date,
    tunables,
    input,
    segmentKind: input.kind,
    ...(resolved.matchType === undefined ? {} : { matchType: resolved.matchType }),
    ...(resolved.angleType === undefined ? {} : { angleType: resolved.angleType }),
    durationClass: slot.durationClass,
    role: slot.role,
    slot,
    policy: ratingPolicyFor(read, tunables, input.promotionId),
    rng: options.rng ?? null,
  };
  const result = rater(ctx);
  return {
    ok: true,
    data: {
      ...result,
      warnings: segmentWarnings(input, read, read.meta.catalogs, input.event.date),
    },
  };
}
