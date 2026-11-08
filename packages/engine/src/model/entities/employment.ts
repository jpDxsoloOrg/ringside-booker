/**
 * Employments: a person's contract with a promotion, as an entity with its own lifecycle.
 *
 * An employment starts life as an offer and only becomes a working contract by moving through the
 * lifecycle on purpose (`offered → signed → active`). Keeping "offered" and "active" as different
 * states means an offer can never pay a wage or put someone on a card by accident.
 *
 * Everything that exists only because someone works for a promotion lives here: ring name,
 * gimmick, alignment, push, brand, manager, morale and momentum. When the contract ends, those end
 * with it. Facts that outlive a contract (teams, stables, relationships) reference the person.
 */

import { z } from 'zod';
import { compareDates, type GameDate } from '../../core/date';
import type { PromotionId } from '../../core/ids';
import type { IntegrityIssue } from '../integrity';
import {
  zBasisPoints,
  zContentKey,
  zGameDate,
  zId,
  zNonNegativeCents,
  zNonNegativeInt,
  zPositiveInt,
  zSigned100,
} from '../primitives';
import { defineTable } from '../table-def';
import { tableOf, type WorldView } from '../world';
import { brandsTable } from './brand';

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

export const EMPLOYMENT_STATUSES = [
  'offered',
  'declined',
  'withdrawn',
  'signed',
  'active',
  'expired',
  'released',
  'quit',
] as const;

export const EmploymentStatusSchema = z.enum(EMPLOYMENT_STATUSES);
export type EmploymentStatus = z.infer<typeof EmploymentStatusSchema>;

/** Statuses that end an employment for good. Every one of them sets `endedOn`. */
export const ENDED_EMPLOYMENT_STATUSES = [
  'declined',
  'withdrawn',
  'expired',
  'released',
  'quit',
] as const satisfies readonly EmploymentStatus[];

/** Statuses an employment can only reach after it was active, so it must have started. */
export const STARTED_EMPLOYMENT_STATUSES = [
  'active',
  'expired',
  'released',
  'quit',
] as const satisfies readonly EmploymentStatus[];

/**
 * The legal moves between statuses. Commands that change an employment (ECO) check them with
 * `canTransition`; the transaction layer does not, so a migration or a sandbox edit can still set
 * any status. The `employments.unreachableState` invariant checks that whatever is stored could
 * have been reached.
 */
export const EMPLOYMENT_TRANSITIONS: Readonly<
  Record<EmploymentStatus, readonly EmploymentStatus[]>
> = {
  offered: ['signed', 'declined', 'withdrawn'],
  signed: ['active', 'withdrawn'],
  active: ['expired', 'released', 'quit'],
  declined: [],
  withdrawn: [],
  expired: [],
  released: [],
  quit: [],
};

/** True when an employment may move from `from` to `to` in one step. */
export function canTransition(from: EmploymentStatus, to: EmploymentStatus): boolean {
  return EMPLOYMENT_TRANSITIONS[from].includes(to);
}

/** True for a status with no way out. */
export function isTerminalStatus(status: EmploymentStatus): boolean {
  return EMPLOYMENT_TRANSITIONS[status].length === 0;
}

function isEndedStatus(status: EmploymentStatus): boolean {
  return ENDED_EMPLOYMENT_STATUSES.some((ended) => ended === status);
}

function isStartedStatus(status: EmploymentStatus): boolean {
  return STARTED_EMPLOYMENT_STATUSES.some((started) => started === status);
}

// ---------------------------------------------------------------------------------------------
// Row schema
// ---------------------------------------------------------------------------------------------

export const EMPLOYMENT_ROLES = [
  'wrestler',
  'manager',
  'presenter',
  'announcer',
  'referee',
  'producer',
  'booker',
] as const;
export const EmploymentRoleSchema = z.enum(EMPLOYMENT_ROLES);
export type EmploymentRole = z.infer<typeof EmploymentRoleSchema>;

export const ALIGNMENTS = ['face', 'heel', 'tweener'] as const;
export const AlignmentSchema = z.enum(ALIGNMENTS);
export type Alignment = z.infer<typeof AlignmentSchema>;

/** Card positions, from the top of the card down. `none` = not pushed at all (crew, managers). */
export const PUSH_LEVELS = [
  'mainEvent',
  'upperCard',
  'midCard',
  'lowerCard',
  'enhancement',
  'none',
] as const;
export const PushSchema = z.enum(PUSH_LEVELS);
export type Push = z.infer<typeof PushSchema>;

export const CONTRACT_KINDS = ['written', 'perAppearance', 'development', 'tour'] as const;
export const ContractKindSchema = z.enum(CONTRACT_KINDS);
export type ContractKind = z.infer<typeof ContractKindSchema>;

export const LEAVE_KINDS = ['suspension', 'timeOff'] as const;
export const LeaveKindSchema = z.enum(LEAVE_KINDS);
export type LeaveKind = z.infer<typeof LeaveKindSchema>;

export const RevenueSharesSchema = z.strictObject({
  gateBp: zBasisPoints,
  merchBp: zBasisPoints,
  broadcastBp: zBasisPoints,
});

export const ContractPerksSchema = z.strictObject({
  creativeControl: z.boolean(),
  noHouseShows: z.boolean(),
  ironClad: z.boolean(),
  travelCovered: z.boolean(),
});

export const ContractTermsSchema = z.strictObject({
  kind: ContractKindSchema,
  /** An exclusive contract rules out any other active contract for the same person. */
  exclusive: z.boolean(),
  monthlyWage: zNonNegativeCents,
  perAppearanceFee: zNonNegativeCents,
  signingBonus: zNonNegativeCents,
  shares: RevenueSharesSchema,
  /** Most appearances per game year, or null for no cap. */
  appearanceCap: zPositiveInt.nullable(),
  perks: ContractPerksSchema,
});

export const LeaveSchema = z.strictObject({
  kind: LeaveKindSchema,
  until: zGameDate,
  paid: z.boolean(),
});

export const EmploymentSchema = z
  .strictObject({
    id: zId('employment'),
    // Links
    personId: zId('person'),
    promotionId: zId('promotion'),
    /** Null = not assigned to a brand (single-brand promotions, or between drafts). */
    brandId: zId('brand').nullable(),
    managerPersonId: zId('person').nullable(),
    // Lifecycle
    status: EmploymentStatusSchema,
    offeredOn: zGameDate,
    startsOn: zGameDate,
    /** Null = open-ended. */
    endsOn: zGameDate.nullable(),
    /** The day the employment ended; set exactly when the status is an ended one. */
    endedOn: zGameDate.nullable(),
    // Role and character
    role: EmploymentRoleSchema,
    ringName: z.string().min(1).max(60),
    gimmickKey: zContentKey.nullable(),
    alignment: AlignmentSchema,
    push: PushSchema,
    // Terms
    terms: ContractTermsSchema,
    // State
    morale: zSigned100,
    /** Null until the first appearance under this contract. */
    momentum: zSigned100.nullable(),
    appearancesThisYear: zNonNegativeInt,
    lastAppearanceOn: zGameDate.nullable(),
    leave: LeaveSchema.nullable(),
  })
  .superRefine((employment, context) => {
    const issue = (path: (string | number)[], message: string): void => {
      context.addIssue({ code: 'custom', path, message });
    };
    if (compareDates(employment.startsOn, employment.offeredOn) < 0) {
      issue(['startsOn'], 'startsOn must not be before offeredOn');
    }
    if (employment.endsOn !== null && compareDates(employment.endsOn, employment.startsOn) <= 0) {
      issue(['endsOn'], 'endsOn must be after startsOn (or null for open-ended)');
    }
    const ended = isEndedStatus(employment.status);
    if (ended && employment.endedOn === null) {
      issue(['endedOn'], `endedOn is required when the status is ${employment.status}`);
    }
    if (!ended && employment.endedOn !== null) {
      issue(['endedOn'], `endedOn must be null while the status is ${employment.status}`);
    }
    if (employment.endedOn !== null) {
      if (compareDates(employment.endedOn, employment.offeredOn) < 0) {
        issue(['endedOn'], 'endedOn must not be before offeredOn');
      }
      if (
        isStartedStatus(employment.status) &&
        compareDates(employment.endedOn, employment.startsOn) < 0
      ) {
        issue(['endedOn'], `A ${employment.status} employment cannot end before it started`);
      }
    }
    if (employment.status === 'expired') {
      if (employment.endsOn === null) {
        issue(['endsOn'], 'An open-ended employment cannot expire');
      } else if (
        employment.endedOn !== null &&
        compareDates(employment.endedOn, employment.endsOn) < 0
      ) {
        issue(['endedOn'], 'An employment cannot expire before its endsOn date');
      }
    }
    if (employment.managerPersonId === employment.personId) {
      issue(['managerPersonId'], 'A person cannot be their own manager');
    }
    if (employment.terms.kind === 'perAppearance' && employment.terms.monthlyWage !== 0) {
      issue(['terms', 'monthlyWage'], 'A per-appearance contract has no monthly wage');
    }
  });

export type Employment = z.infer<typeof EmploymentSchema>;
export type ContractTerms = z.infer<typeof ContractTermsSchema>;
export type RevenueShares = z.infer<typeof RevenueSharesSchema>;
export type ContractPerks = z.infer<typeof ContractPerksSchema>;
export type Leave = z.infer<typeof LeaveSchema>;

/** The `byPromotionStatus` index key. */
export function promotionStatusKey(promotionId: PromotionId, status: EmploymentStatus): string {
  return `${promotionId}|${status}`;
}

// ---------------------------------------------------------------------------------------------
// Invariants
// ---------------------------------------------------------------------------------------------

function groupBy<Row, Key>(rows: readonly Row[], keyOf: (row: Row) => Key): Map<Key, Row[]> {
  const groups = new Map<Key, Row[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [row]);
    } else {
      group.push(row);
    }
  }
  return groups;
}

function employmentRows(view: WorldView): readonly Employment[] {
  return tableOf(view, employmentsTable).values();
}

function idList(rows: readonly Employment[]): string {
  return rows.map((row) => row.id).join(', ');
}

/**
 * (1) An exclusive active contract is the only active contract its person has. That also means at
 * most one exclusive active contract per person.
 */
function checkExclusiveContracts(view: WorldView): IntegrityIssue[] {
  const active = employmentRows(view).filter((employment) => employment.status === 'active');
  const issues: IntegrityIssue[] = [];
  for (const [personId, contracts] of groupBy(active, (employment) => employment.personId)) {
    const exclusive = contracts.filter((employment) => employment.terms.exclusive);
    const [first] = exclusive;
    if (first === undefined || contracts.length < 2) {
      continue;
    }
    issues.push({
      code: 'employments.exclusiveConflict',
      table: 'employments',
      id: first.id,
      path: 'terms.exclusive',
      message: `Person ${personId} has an exclusive active contract alongside other active contracts: ${idList(contracts)}`,
    });
  }
  return issues;
}

/** (2) At most one signed or active employment per person and promotion. */
function checkOneContractPerPromotion(view: WorldView): IntegrityIssue[] {
  const live = employmentRows(view).filter(
    (employment) => employment.status === 'signed' || employment.status === 'active',
  );
  const issues: IntegrityIssue[] = [];
  const groups = groupBy(live, (employment) => `${employment.personId}|${employment.promotionId}`);
  for (const contracts of groups.values()) {
    const [first] = contracts;
    if (first === undefined || contracts.length < 2) {
      continue;
    }
    issues.push({
      code: 'employments.duplicateContract',
      table: 'employments',
      id: first.id,
      message: `Person ${first.personId} has more than one signed or active contract with ${first.promotionId}: ${idList(contracts)}`,
    });
  }
  return issues;
}

/** (3) An employment's brand belongs to the employment's promotion. */
function checkBrandPromotion(view: WorldView): IntegrityIssue[] {
  const brands = tableOf(view, brandsTable);
  const issues: IntegrityIssue[] = [];
  for (const employment of employmentRows(view)) {
    if (employment.brandId === null) {
      continue;
    }
    // A missing brand is a dangling reference, which the reference check reports.
    const brand = brands.get(employment.brandId);
    if (brand === undefined || brand.promotionId === employment.promotionId) {
      continue;
    }
    issues.push({
      code: 'employments.brandOtherPromotion',
      table: 'employments',
      id: employment.id,
      path: 'brandId',
      message: `Employment ${employment.id} is with ${employment.promotionId} but its brand ${brand.id} belongs to ${brand.promotionId}`,
    });
  }
  return issues;
}

function isOnOrBefore(date: GameDate, other: GameDate): boolean {
  return compareDates(date, other) <= 0;
}

/**
 * The stored status could have been reached by today: no offer is dated in the future, a contract
 * that has been active must have started by the current date, and nothing can have ended in the
 * future.
 */
function checkReachableState(view: WorldView): IntegrityIssue[] {
  const today = view.meta.currentDate;
  const issues: IntegrityIssue[] = [];
  for (const employment of employmentRows(view)) {
    if (!isOnOrBefore(employment.offeredOn, today)) {
      issues.push({
        code: 'employments.unreachableState',
        table: 'employments',
        id: employment.id,
        path: 'offeredOn',
        message: `Employment ${employment.id} was offered on ${employment.offeredOn}, which is after today (${today})`,
      });
    }
    if (isStartedStatus(employment.status) && !isOnOrBefore(employment.startsOn, today)) {
      issues.push({
        code: 'employments.unreachableState',
        table: 'employments',
        id: employment.id,
        path: 'startsOn',
        message: `Employment ${employment.id} is ${employment.status} but only starts on ${employment.startsOn} (today is ${today})`,
      });
    }
    if (employment.endedOn !== null && !isOnOrBefore(employment.endedOn, today)) {
      issues.push({
        code: 'employments.unreachableState',
        table: 'employments',
        id: employment.id,
        path: 'endedOn',
        message: `Employment ${employment.id} ended on ${employment.endedOn}, which is after today (${today})`,
      });
    }
  }
  return issues;
}

export const employmentsTable = defineTable({
  kind: 'employment',
  name: 'employments',
  schema: EmploymentSchema,
  refs: [
    { path: 'personId', target: 'person', nullable: false },
    { path: 'promotionId', target: 'promotion', nullable: false },
    { path: 'brandId', target: 'brand', nullable: true },
    { path: 'managerPersonId', target: 'person', nullable: true },
  ],
  indexes: [
    { name: 'byPerson', key: (employment) => employment.personId },
    { name: 'byPromotion', key: (employment) => employment.promotionId },
    { name: 'byStatus', key: (employment) => employment.status },
    {
      name: 'byPromotionStatus',
      key: (employment) => promotionStatusKey(employment.promotionId, employment.status),
    },
  ],
  invariants: [
    { name: 'exclusiveContracts', check: checkExclusiveContracts },
    { name: 'oneContractPerPromotion', check: checkOneContractPerPromotion },
    { name: 'brandBelongsToPromotion', check: checkBrandPromotion },
    { name: 'reachableState', check: checkReachableState },
  ],
});
