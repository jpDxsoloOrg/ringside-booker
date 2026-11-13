/**
 * The contracts system's queries (ECO4-02), the engine half of the Contracts screen (ECO4-04).
 *
 * - `contracts.releasePreview { employmentId }`: what releasing a worker would cost, with its Why?
 *   and warnings, or the reasons it is refused. Agrees to the cent with `contracts.release`.
 * - `contracts.list { tab }`: the viewer's contracts on the Active, Expiring or Ended tab.
 * - `contracts.detail { employmentId }`: one contract. Any contract in the world can be looked at,
 *   but a rival's money terms and morale are left out (`termsPrivate: true`, D-07).
 * - `contracts.counts`: the nav badge's numbers.
 * - `contracts.changesSince { from, to }`: the Next Day summary's contract lines, read from the
 *   contracts themselves so a long skip never loses lines to the event-log limit.
 *
 * Rival contracts are private: lists, counts and changes only ever cover the viewer's own
 * promotions. Design: docs/design/contracts.md#scoping.
 */

import { z } from 'zod';
import { viewerPromotionIds, type Viewer } from '../../core/api/controller';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import type { Reason } from '../../core/api/result';
import { compareDates, diffDays, type GameDate } from '../../core/date';
import type { BrandId, EmploymentId, PersonId, PromotionId, TitleId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import type { Traced } from '../../core/trace/types';
import type { ContractConcern, ContractEndingHow } from '../../model/entities/contract-concern';
import {
  type ContractKind,
  type ContractPerks,
  type Employment,
  type EmploymentRole,
  type EmploymentStatus,
  type Leave,
  type Push,
  type RevenueShares,
} from '../../model/entities/employment';
import type { ImageRef } from '../../model/primitives';
import { zGameDate, zId } from '../../model/primitives';
import { compareIds } from '../../model/table';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import { plainDate } from '../health/gate';
import { moneyText } from '../production';
import { unseenExpiringContracts } from './gates';
import { releaseSeverance } from './release';
import { releaseRefusals } from './rules';
import { titlesHeldBy } from './titles';

// ---------------------------------------------------------------------------------------------
// Types

/** The perks a contract row lists, in this order. */
export const CONTRACT_PERK_KEYS = [
  'creativeControl',
  'noHouseShows',
  'ironClad',
  'travelCovered',
] as const satisfies readonly (keyof ContractPerks)[];
export type ContractPerkKey = (typeof CONTRACT_PERK_KEYS)[number];

/** Why a contract ended, as the Ended tab says it. A granted release request reads `quit`. */
export type ContractEndReason =
  'expired' | 'released' | 'quit' | 'walkedOut' | 'exclusiveDeal' | 'withdrawn';

export type ContractsTab = 'active' | 'expiring' | 'ended';

/** A title as a contract row names it. */
export interface HeldTitle {
  id: TitleId;
  name: string;
}

/** One row of `contracts.list`. Only ever one of the viewer's own contracts. */
export interface ContractRow {
  employmentId: EmploymentId;
  personId: PersonId;
  promotionId: PromotionId;
  ringName: string;
  role: EmploymentRole;
  push: Push;
  brandId: BrandId | null;
  status: EmploymentStatus;
  kind: ContractKind;
  monthlyWage: number;
  perAppearanceFee: number;
  perks: ContractPerkKey[];
  exclusive: boolean;
  startsOn: GameDate;
  endsOn: GameDate | null;
  /** Days from today to the end date, or null for an open-ended or ended contract. */
  daysLeft: number | null;
  endedOn: GameDate | null;
  endReason: ContractEndReason | null;
  /** Severance paid when it ended, in cents (Ended tab), else null. */
  severancePaid: number | null;
  /** The severance's Why?, when one was paid and its trace is still stored. */
  severanceTraceRef: TraceRef | null;
  titles: HeldTitle[];
  notice: 'unseen' | 'seen' | null;
  imageRef: ImageRef;
}

export type ReleaseWarningCode = 'holdsTitle' | 'ironClad' | 'intoDebt' | 'bookedSoon' | 'gladToGo';

export interface ReleaseWarning {
  code: ReleaseWarningCode;
  message: string;
  subject?: { kind: 'title' | 'eventInstance'; id: string };
}

export type ReleasePreview =
  | {
      kind: 'ok';
      /** `release` for a contract that has started, `withdraw` for a signed deal that has not. */
      mode: 'release' | 'withdraw';
      severance: Traced<number>;
      cashBefore: number;
      cashAfter: number;
      warnings: ReleaseWarning[];
    }
  | { kind: 'refused'; reasons: Reason[] };

/** What anyone may see of a contract. */
interface ContractDetailBase {
  employmentId: EmploymentId;
  personId: PersonId;
  promotionId: PromotionId;
  promotionName: string;
  ringName: string;
  role: EmploymentRole;
  push: Push;
  brandId: BrandId | null;
  status: EmploymentStatus;
  kind: ContractKind;
  exclusive: boolean;
  perks: ContractPerkKey[];
  startsOn: GameDate;
  endsOn: GameDate | null;
  daysLeft: number | null;
  endedOn: GameDate | null;
  titles: HeldTitle[];
  imageRef: ImageRef;
}

/** The viewer's own contract (or any, for the omniscient viewer): every term. */
export interface OwnContractDetail extends ContractDetailBase {
  termsPrivate: false;
  monthlyWage: number;
  perAppearanceFee: number;
  signingBonus: number;
  shares: RevenueShares;
  appearanceCap: number | null;
  leave: Leave | null;
  morale: number;
  notice: 'unseen' | 'seen' | null;
  /** What releasing them would cost today, or null once the contract has ended. */
  severance: Traced<number> | null;
}

/** A rival's contract: no money terms, no morale (left out, not zeroed). */
export interface PrivateContractDetail extends ContractDetailBase {
  termsPrivate: true;
}

export type ContractDetail = OwnContractDetail | PrivateContractDetail;

export interface ContractCounts {
  /** The viewer's active contracts with an unseen "expiring soon" notice. */
  unseenExpiring: number;
  /** The viewer's workers with an open release request (ECO4-03). */
  wantsToLeave: number;
}

export interface ContractChange {
  employmentId: EmploymentId;
  personId: PersonId;
  ringName: string;
  date: GameDate;
  /** How it ended (released: `released`/`withdrawn`; quit: `granted`/`walkedOut`/`exclusiveDeal`). */
  how?: ContractEndingHow;
  /** The new end date (renewals only). */
  endsOn?: GameDate;
  /** A plain-words line for the summary (renewals only). */
  line?: string;
}

export interface ContractChanges {
  started: ContractChange[];
  expired: ContractChange[];
  released: ContractChange[];
  quit: ContractChange[];
  requests: ContractChange[];
  /**
   * Renewals in the range. Read from the recent-event log (a renewal only moves an end date), so a
   * very long skip can lose the oldest. Until ECO5 these are the automatic renewals.
   */
  renewed: ContractChange[];
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'contracts.releasePreview': { args: { employmentId: EmploymentId }; result: ReleasePreview };
    'contracts.list': { args: { tab: ContractsTab }; result: ContractRow[] };
    'contracts.detail': { args: { employmentId: EmploymentId }; result: ContractDetail | null };
    'contracts.counts': { args: Record<string, never>; result: ContractCounts };
    'contracts.changesSince': { args: { from: GameDate; to: GameDate }; result: ContractChanges };
  }
}

// ---------------------------------------------------------------------------------------------
// Shared helpers

const ENDED_TAB_STATUSES: readonly EmploymentStatus[] = [
  'expired',
  'released',
  'quit',
  'withdrawn',
];

function ownPromotions(read: GameWorldView, viewer: Viewer): PromotionId[] {
  return viewerPromotionIds(read, viewer);
}

function perksOf(employment: DeepReadonly<Employment>): ContractPerkKey[] {
  return CONTRACT_PERK_KEYS.filter((key) => employment.terms.perks[key]);
}

function heldTitles(read: GameWorldView, employment: DeepReadonly<Employment>): HeldTitle[] {
  return titlesHeldBy(read, employment.personId, employment.promotionId).map((id) => ({
    id,
    name: read.tables.titles.get(id)?.name ?? 'a title',
  }));
}

function daysLeftOf(employment: DeepReadonly<Employment>, date: GameDate): number | null {
  if (
    employment.endsOn === null ||
    (employment.status !== 'active' && employment.status !== 'signed')
  ) {
    return null;
  }
  return diffDays(date, employment.endsOn);
}

function concernOf(
  read: GameWorldView,
  employmentId: EmploymentId,
): DeepReadonly<ContractConcern> | undefined {
  return read.tables.contractConcerns.lookupOne('byEmployment', employmentId);
}

function noticeOf(concern: DeepReadonly<ContractConcern> | undefined): 'unseen' | 'seen' | null {
  if (concern?.expiryNotice == null) {
    return null;
  }
  return concern.expiryNotice.seenOn === null ? 'unseen' : 'seen';
}

function endReasonOf(
  employment: DeepReadonly<Employment>,
  concern: DeepReadonly<ContractConcern> | undefined,
): ContractEndReason | null {
  if (!ENDED_TAB_STATUSES.includes(employment.status)) {
    return null;
  }
  const how = concern?.ending?.how;
  if (how === undefined) {
    return employment.status === 'expired' ||
      employment.status === 'released' ||
      employment.status === 'quit' ||
      employment.status === 'withdrawn'
      ? employment.status
      : null;
  }
  return how === 'granted' ? 'quit' : how;
}

function imageOf(read: GameWorldView, personId: PersonId): ImageRef {
  return read.tables.people.get(personId)?.imageRef ?? null;
}

function rowOf(ctx: QueryContext, employment: DeepReadonly<Employment>): ContractRow {
  const concern = concernOf(ctx.read, employment.id);
  const ended = ENDED_TAB_STATUSES.includes(employment.status);
  const severanceTraceRef = ended ? (concern?.ending?.traceRef ?? null) : null;
  return {
    employmentId: employment.id,
    personId: employment.personId,
    promotionId: employment.promotionId,
    ringName: employment.ringName,
    role: employment.role,
    push: employment.push,
    brandId: employment.brandId,
    status: employment.status,
    kind: employment.terms.kind,
    monthlyWage: employment.terms.monthlyWage,
    perAppearanceFee: employment.terms.perAppearanceFee,
    perks: perksOf(employment),
    exclusive: employment.terms.exclusive,
    startsOn: employment.startsOn,
    endsOn: employment.endsOn,
    daysLeft: daysLeftOf(employment, ctx.date),
    endedOn: employment.endedOn,
    endReason: endReasonOf(employment, concern),
    severancePaid: ended ? (concern?.ending?.severance ?? 0) : null,
    severanceTraceRef:
      severanceTraceRef !== null && ctx.traces.has(severanceTraceRef) ? severanceTraceRef : null,
    titles: ended ? [] : heldTitles(ctx.read, employment),
    notice: noticeOf(concern),
    imageRef: imageOf(ctx.read, employment.personId),
  };
}

function ownEmployments(ctx: QueryContext): DeepReadonly<Employment>[] {
  return ownPromotions(ctx.read, ctx.viewer).flatMap((promotionId) =>
    ctx.read.tables.employments.lookup('byPromotion', promotionId),
  );
}

function byName(left: ContractRow, right: ContractRow): number {
  return (
    left.ringName.localeCompare(right.ringName) || compareIds(left.employmentId, right.employmentId)
  );
}

// ---------------------------------------------------------------------------------------------
// contracts.releasePreview

/** The future shows of this promotion the worker is booked on, soonest first. */
function upcomingBookings(
  read: GameWorldView,
  employment: DeepReadonly<Employment>,
  date: GameDate,
): { id: string; name: string; date: GameDate }[] {
  const seen = new Set<string>();
  const shows: { id: string; name: string; date: GameDate }[] = [];
  for (const participant of read.tables.participants.lookup('byPerson', employment.personId)) {
    const segment = read.tables.segments.get(participant.segmentId);
    if (segment === undefined || seen.has(segment.eventInstanceId)) {
      continue;
    }
    const instance = read.tables.eventInstances.get(segment.eventInstanceId);
    if (
      instance?.promotionId !== employment.promotionId ||
      (instance.status !== 'scheduled' && instance.status !== 'booked') ||
      compareDates(instance.date, date) < 0
    ) {
      continue;
    }
    seen.add(instance.id);
    shows.push({ id: instance.id, name: instance.name, date: instance.date });
  }
  return shows.sort(
    (left, right) => compareDates(left.date, right.date) || compareIds(left.id, right.id),
  );
}

function releaseWarnings(
  ctx: QueryContext,
  employment: DeepReadonly<Employment>,
  cashAfter: number,
): ReleaseWarning[] {
  const warnings: ReleaseWarning[] = [];
  for (const title of heldTitles(ctx.read, employment)) {
    warnings.push({
      code: 'holdsTitle',
      message: `Holds the ${title.name}. Titles don't change hands on their own yet, so they keep it.`,
      subject: { kind: 'title', id: title.id },
    });
  }
  if (employment.terms.perks.ironClad) {
    const multiplier = ctx.tunables.get('contracts.severance.ironCladMultiplier');
    warnings.push({
      code: 'ironClad',
      message: `Iron-clad contract: the severance is multiplied by ${String(multiplier)}.`,
    });
  }
  if (cashAfter < 0) {
    warnings.push({ code: 'intoDebt', message: `This puts you ${moneyText(-cashAfter)} in debt.` });
  }
  const [next, ...later] = upcomingBookings(ctx.read, employment, ctx.date);
  if (next !== undefined) {
    const more =
      later.length === 0
        ? ''
        : ` and ${String(later.length)} more ${later.length === 1 ? 'show' : 'shows'}`;
    warnings.push({
      code: 'bookedSoon',
      message: `Booked on ${next.name}, ${plainDate(next.date)}${more}.`,
      subject: { kind: 'eventInstance', id: next.id },
    });
  }
  const mutualMorale = ctx.tunables.get('contracts.severance.mutualMorale');
  if (employment.status === 'active' && employment.morale <= mutualMorale) {
    warnings.push({
      code: 'gladToGo',
      message: `${employment.ringName} is glad to go, so they take less severance.`,
    });
  }
  return warnings;
}

export const releasePreviewQuery = defineQuery('contracts.releasePreview', {
  args: z.strictObject({ employmentId: zId('employment') }),
  run: (ctx, args): ReleasePreview => {
    const reasons = releaseRefusals(
      ctx.read,
      args.employmentId,
      ownPromotions(ctx.read, ctx.viewer),
    );
    if (reasons.length > 0) {
      return { kind: 'refused', reasons };
    }
    const employment = ctx.read.tables.employments.require(args.employmentId);
    const severance = releaseSeverance(ctx, employment.id);
    const cashBefore = ctx.read.tables.promotions.require(employment.promotionId).cash;
    const cashAfter = cashBefore - severance.value;
    return {
      kind: 'ok',
      mode: employment.status === 'active' ? 'release' : 'withdraw',
      severance,
      cashBefore,
      cashAfter,
      warnings: releaseWarnings(ctx, employment, cashAfter),
    };
  },
});

// ---------------------------------------------------------------------------------------------
// contracts.list

export const listQuery = defineQuery('contracts.list', {
  args: z.strictObject({ tab: z.enum(['active', 'expiring', 'ended']) }),
  run: (ctx, args): ContractRow[] => {
    const employments = ownEmployments(ctx);
    switch (args.tab) {
      case 'active':
        return employments
          .filter((employment) => employment.status === 'active' || employment.status === 'signed')
          .map((employment) => rowOf(ctx, employment))
          .sort(byName);
      case 'expiring': {
        const window = ctx.tunables.get('contracts.expiring.windowDays');
        return employments
          .filter((employment) => employment.status === 'active')
          .map((employment) => rowOf(ctx, employment))
          .filter((row) => row.daysLeft !== null && row.daysLeft <= window)
          .sort(
            (left, right) =>
              (left.daysLeft ?? 0) - (right.daysLeft ?? 0) ||
              compareIds(left.employmentId, right.employmentId),
          );
      }
      case 'ended':
        return employments
          .filter((employment) => ENDED_TAB_STATUSES.includes(employment.status))
          .map((employment) => rowOf(ctx, employment))
          .sort(
            (left, right) =>
              compareDates(right.endedOn ?? right.startsOn, left.endedOn ?? left.startsOn) ||
              compareIds(left.employmentId, right.employmentId),
          );
    }
  },
});

// ---------------------------------------------------------------------------------------------
// contracts.detail

export const detailQuery = defineQuery('contracts.detail', {
  args: z.strictObject({ employmentId: zId('employment') }),
  run: (ctx, args): ContractDetail | null => {
    const employment = ctx.read.tables.employments.get(args.employmentId);
    if (employment === undefined) {
      return null;
    }
    const base: ContractDetailBase = {
      employmentId: employment.id,
      personId: employment.personId,
      promotionId: employment.promotionId,
      promotionName: ctx.read.tables.promotions.get(employment.promotionId)?.name ?? '',
      ringName: employment.ringName,
      role: employment.role,
      push: employment.push,
      brandId: employment.brandId,
      status: employment.status,
      kind: employment.terms.kind,
      exclusive: employment.terms.exclusive,
      perks: perksOf(employment),
      startsOn: employment.startsOn,
      endsOn: employment.endsOn,
      daysLeft: daysLeftOf(employment, ctx.date),
      endedOn: employment.endedOn,
      titles: ENDED_TAB_STATUSES.includes(employment.status)
        ? []
        : heldTitles(ctx.read, employment),
      imageRef: imageOf(ctx.read, employment.personId),
    };
    const sees =
      ctx.viewer.kind === 'omniscient' ||
      ownPromotions(ctx.read, ctx.viewer).includes(employment.promotionId);
    if (!sees) {
      return { ...base, termsPrivate: true };
    }
    const { terms } = employment;
    const live = employment.status === 'active' || employment.status === 'signed';
    return {
      ...base,
      termsPrivate: false,
      monthlyWage: terms.monthlyWage,
      perAppearanceFee: terms.perAppearanceFee,
      signingBonus: terms.signingBonus,
      shares: { ...terms.shares },
      appearanceCap: terms.appearanceCap,
      leave: employment.leave === null ? null : { ...employment.leave },
      morale: employment.morale,
      notice: noticeOf(concernOf(ctx.read, employment.id)),
      severance: live ? releaseSeverance(ctx, employment.id) : null,
    };
  },
});

// ---------------------------------------------------------------------------------------------
// contracts.counts

export const countsQuery = defineQuery('contracts.counts', {
  args: z.strictObject({}),
  run: (ctx): ContractCounts => {
    const own = new Set(ownPromotions(ctx.read, ctx.viewer));
    if (own.size === 0) {
      return { unseenExpiring: 0, wantsToLeave: 0 };
    }
    const unseenExpiring = unseenExpiringContracts(ctx.read).filter((employment) =>
      own.has(employment.promotionId),
    ).length;
    let wantsToLeave = 0;
    for (const promotionId of own) {
      for (const concern of ctx.read.tables.contractConcerns.lookup('byPromotion', promotionId)) {
        if (concern.request?.status === 'open') {
          wantsToLeave += 1;
        }
      }
    }
    return { unseenExpiring, wantsToLeave };
  },
});

// ---------------------------------------------------------------------------------------------
// contracts.changesSince

function inRange(date: GameDate | null, from: GameDate, to: GameDate): date is GameDate {
  return date !== null && compareDates(date, from) >= 0 && compareDates(date, to) <= 0;
}

function changeOf(employment: DeepReadonly<Employment>, date: GameDate): ContractChange {
  return {
    employmentId: employment.id,
    personId: employment.personId,
    ringName: employment.ringName,
    date,
  };
}

function byDate(left: ContractChange, right: ContractChange): number {
  return compareDates(left.date, right.date) || compareIds(left.employmentId, right.employmentId);
}

export const changesSinceQuery = defineQuery('contracts.changesSince', {
  args: z.strictObject({ from: zGameDate, to: zGameDate }),
  run: (ctx, { from, to }): ContractChanges => {
    const changes: ContractChanges = {
      started: [],
      expired: [],
      released: [],
      quit: [],
      requests: [],
      renewed: [],
    };
    const own = new Set(ownPromotions(ctx.read, ctx.viewer));
    if (own.size === 0 || compareDates(from, to) > 0) {
      return changes;
    }
    for (const employment of ownEmployments(ctx)) {
      const started =
        employment.status === 'active' ||
        employment.status === 'expired' ||
        employment.status === 'released' ||
        employment.status === 'quit';
      if (
        started &&
        inRange(employment.startsOn, from, to) &&
        compareDates(employment.startsOn, ctx.date) <= 0
      ) {
        changes.started.push(changeOf(employment, employment.startsOn));
      }
      if (!inRange(employment.endedOn, from, to)) {
        continue;
      }
      const how = concernOf(ctx.read, employment.id)?.ending?.how;
      const change = changeOf(employment, employment.endedOn);
      switch (employment.status) {
        case 'expired':
          changes.expired.push(change);
          break;
        case 'released':
        case 'withdrawn':
          changes.released.push({ ...change, how: employment.status });
          break;
        case 'quit':
          changes.quit.push(how === undefined ? change : { ...change, how });
          break;
        case 'offered':
        case 'declined':
        case 'signed':
        case 'active':
          break;
      }
    }
    for (const promotionId of own) {
      for (const concern of ctx.read.tables.contractConcerns.lookup('byPromotion', promotionId)) {
        const raisedOn = concern.request?.raisedOn ?? null;
        const employment = ctx.read.tables.employments.get(concern.employmentId);
        if (employment !== undefined && inRange(raisedOn, from, to)) {
          changes.requests.push(changeOf(employment, raisedOn));
        }
      }
    }
    for (const event of ctx.events.recent()) {
      if (event.type !== 'contract.renewed' || !inRange(event.date, from, to)) {
        continue;
      }
      const { payload } = event;
      const employment = ctx.read.tables.employments.get(payload.employmentId);
      if (employment === undefined || !own.has(payload.promotionId)) {
        continue;
      }
      changes.renewed.push({
        ...changeOf(employment, event.date),
        endsOn: payload.endsOn,
        line: `${employment.ringName}'s contract was renewed until ${plainDate(payload.endsOn)}.`,
      });
    }
    for (const list of [
      changes.started,
      changes.expired,
      changes.released,
      changes.quit,
      changes.requests,
      changes.renewed,
    ]) {
      list.sort(byDate);
    }
    return changes;
  },
});

export const contractsQueries: readonly QueryDefinition[] = [
  releasePreviewQuery,
  listQuery,
  detailQuery,
  countsQuery,
  changesSinceQuery,
];
