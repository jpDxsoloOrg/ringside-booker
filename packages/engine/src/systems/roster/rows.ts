/**
 * Roster rows: one row per active contract with a promotion, every number already worked out so a
 * screen only formats it.
 *
 * Every derived value comes from the workers system's own helpers and formulas (rating, grade,
 * expected push, footprint popularity, availability, age); the only formula the roster adds is the
 * push gap and its verdict. Rows carry numbers, never traces, so a few hundred stay small. Nothing
 * here is stored: queries cannot record traces, so a number's Why? is rebuilt on demand from the
 * same inputs.
 *
 * Design: docs/design/roster.md#roster-rows.
 */

import { diffDays, type GameDate } from '../../core/date';
import type { BrandId, EmploymentId, PersonId, PromotionId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import type { TraceReader } from '../../core/api/query';
import {
  promotionStatusKey,
  type Alignment,
  type Employment,
  type EmploymentRole,
  type Push,
} from '../../model/entities/employment';
import type { Gender, Person } from '../../model/entities/person';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { EngineTunables } from '../tunables';
import { geographyOf } from '../world/geography';
import { DOOR_TRACE_KINDS } from '../workers/doors';
import { footprintPopularityValue } from '../workers/formulas/footprintPopularity';
import { gradeOf, type Grade } from '../workers/formulas/grade';
import type { AvailabilityStatus } from '../workers/helpers/availability';
import type { PushVerdict } from './formulas/pushVerdict';
import {
  pushIndexOf,
  ROSTER_ROLE_GROUPS,
  rosterRoleGroupOf,
  type RosterRoleGroup,
} from './roleGroups';
import { oneDecimal, rowInputs, rowOverall, rowPushGap } from './rowInputs';

/** Which rows to keep. Both are optional; a row must pass every one that is set. */
export interface RosterFilter {
  /** A brand's rows, or `'shared'` for the rows on no brand. */
  brandId?: BrandId | 'shared' | undefined;
  group?: RosterRoleGroup | undefined;
}

export interface RosterPushGap {
  /** Card positions below the push they expect; negative when above it. */
  steps: number;
  verdict: PushVerdict;
}

export interface RosterRowAvailability {
  status: AvailabilityStatus;
  /** Why they cannot work (or work only some dates), written for the player; null when available. */
  reason: string | null;
  /** The first day back, or null when there is no known end. */
  until: GameDate | null;
}

/** One contract on the roster. Plain JSON only. */
export interface RosterRow {
  employmentId: EmploymentId;
  personId: PersonId;
  promotionId: PromotionId;
  /** Null for a contract on no brand (shared). */
  brandId: BrandId | null;
  brandName: string | null;
  group: RosterRoleGroup;
  role: EmploymentRole;
  ringName: string;
  imageRef: Person['imageRef'];
  gender: Gender;
  /** Whole years on the date asked about. */
  age: number;
  alignment: Alignment;
  push: Push;
  /** The push they expect here, or null for a role with no card position. */
  expectedPush: Push | null;
  pushGap: RosterPushGap | null;
  /** Their rating in the contracted role, to 1 decimal, and its grade. */
  overall: { value: number; grade: Grade };
  /** Popularity among this promotion's fans, 0 to 100, to 1 decimal. */
  popularity: number;
  /** Null until their first appearance under this contract. */
  momentum: { value: number | null; traceRef: TraceRef | null };
  morale: { value: number; traceRef: TraceRef | null };
  availability: RosterRowAvailability;
  /** The last day of the contract, or null when it is open-ended. */
  endsOn: GameDate | null;
  /** Days from the date asked about to `endsOn`, or null when open-ended. */
  daysLeft: number | null;
}

export interface RosterDeps {
  tunables: EngineTunables;
  traces: Pick<TraceReader, 'has'>;
}

function storedRef(traces: Pick<TraceReader, 'has'>, ref: TraceRef): TraceRef | null {
  return traces.has(ref) ? ref : null;
}

function passesFilter(employment: Employment, filter: RosterFilter): boolean {
  if (filter.group !== undefined && rosterRoleGroupOf(employment.role) !== filter.group) {
    return false;
  }
  if (filter.brandId === undefined) {
    return true;
  }
  return filter.brandId === 'shared'
    ? employment.brandId === null
    : employment.brandId === filter.brandId;
}

/** Group order, then card position, then ring name, then employment ID: a fixed order. */
function compareRows(left: RosterRow, right: RosterRow): number {
  return (
    ROSTER_ROLE_GROUPS.indexOf(left.group) - ROSTER_ROLE_GROUPS.indexOf(right.group) ||
    pushIndexOf(left.push) - pushIndexOf(right.push) ||
    left.ringName.localeCompare(right.ringName, 'en', { numeric: true }) ||
    compareIds(left.employmentId, right.employmentId)
  );
}

/**
 * The rows for every active contract with `promotionId` on `date`, filtered and sorted. Throws
 * `EntityNotFoundError` for an unknown promotion.
 */
export function buildRosterRows(
  read: GameWorldView,
  promotionId: PromotionId,
  date: GameDate,
  deps: RosterDeps,
  filter: RosterFilter = {},
): RosterRow[] {
  read.tables.promotions.require(promotionId);
  const regions = geographyOf(read).regions;
  const formulaDeps = { tunables: deps.tunables };
  const rows: RosterRow[] = [];

  for (const employment of read.tables.employments.lookup(
    'byPromotionStatus',
    promotionStatusKey(promotionId, 'active'),
  )) {
    if (!passesFilter(employment, filter)) {
      continue;
    }
    const inputs = rowInputs(read, employment, date, regions);
    const { person, availability } = inputs;
    const brand = employment.brandId === null ? null : read.tables.brands.get(employment.brandId);
    const rating = rowOverall(inputs, formulaDeps).value;
    const push = rowPushGap(inputs, formulaDeps);

    rows.push({
      employmentId: employment.id,
      personId: person.id,
      promotionId,
      brandId: employment.brandId,
      brandName: brand?.name ?? null,
      group: rosterRoleGroupOf(employment.role),
      role: employment.role,
      ringName: employment.ringName,
      imageRef: person.imageRef,
      gender: person.gender,
      age: inputs.age,
      alignment: employment.alignment,
      push: employment.push,
      expectedPush: push?.expected.value ?? null,
      pushGap: push === null ? null : { steps: push.gap.value, verdict: push.verdict.value },
      overall: { value: oneDecimal(rating), grade: gradeOf(rating).grade },
      popularity: oneDecimal(footprintPopularityValue(inputs.popularity, formulaDeps)),
      momentum: {
        value: employment.momentum,
        traceRef: storedRef(deps.traces, {
          kind: DOOR_TRACE_KINDS.momentum,
          id: employment.id,
        }),
      },
      morale: {
        value: employment.morale,
        traceRef: storedRef(deps.traces, { kind: DOOR_TRACE_KINDS.morale, id: employment.id }),
      },
      availability: {
        status: availability.status,
        // "Available" says nothing a status does not; a semi-retired worker's note still shows.
        reason:
          availability.status === 'available' && person.status !== 'semiRetired'
            ? null
            : availability.reason,
        until: availability.until,
      },
      endsOn: employment.endsOn,
      daysLeft: employment.endsOn === null ? null : diffDays(date, employment.endsOn),
    });
  }
  return rows.sort(compareRows);
}
