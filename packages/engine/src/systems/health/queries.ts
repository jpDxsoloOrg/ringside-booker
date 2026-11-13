/**
 * The health system's queries.
 *
 * `health.profile` (WRK6-05) is the worker profile's Health tab in one answer: fatigue, the
 * condition of each body part with the cap for their age and next week's healing, the medical care
 * they get, the current injury and the injury history. Health is public (injuries are world news,
 * and a promotion's medical level is public policy), so every viewer gets the same answer, apart
 * from `pendingNotice`, which only the worker's own promotion sees as true.
 *
 * The age cap and next week's healing have no roll, so they are worked out here and returned inline
 * as `Traced` values; storing them would cost six traces per person every week. The numbers that
 * came from a roll (fatigue recovery, an injury's time out, condition lost and the chance behind
 * it) are stored, and come back as references, or null once the trace is gone.
 *
 * `health.report` (WRK6-06) answers "who is out right now?": every open injury in the world, or
 * only one promotion's, with the name and employer a list needs. It is public for the same reason.
 *
 * Design: docs/design/health.md#the-health-profile and #who-is-out.
 */

import { z } from 'zod';
import { defineQuery, type QueryContext, type QueryDefinition } from '../../core/api/query';
import { viewerPromotionIds } from '../../core/api/controller';
import type { ContentKey } from '../../core/content-key';
import { ageInYears, compareDates, diffDays, type GameDate } from '../../core/date';
import type { InjuryId, PersonId, PromotionId, SegmentId } from '../../core/ids';
import type { TraceRef } from '../../core/trace/store';
import type { Traced } from '../../core/trace/types';
import { injuryKindOf, type InjurySeverity } from '../../model/catalogs';
import type { InjuryRecord, InjurySource } from '../../model/entities/injury';
import {
  BODY_PARTS,
  type BodyPart,
  type Person,
  type PersonRole,
} from '../../model/entities/person';
import { zId } from '../../model/primitives';
import type { DeepReadonly } from '../../model/world';
import { compareIds } from '../../model/table';
import { activeEmploymentsOf, primaryEmploymentOf } from '../workers/helpers/employment';
import { computeConditionCap } from './formulas/conditionCap';
import { computeConditionRecovery } from './formulas/conditionRecovery';
import { injuryConditionLossTraceRef, injuryRecordChanceTraceRef, injuryTraceRef } from './injure';
import { medicalLevelOf, type MedicalLevel } from './medical';
import { fatigueRecoveryTraceRef } from './phases';

/** How tired someone looks at a glance. */
export type FatigueBand = 'fresh' | 'tired' | 'weary' | 'spent';

/**
 * The fatigue bands, lowest first: each covers `from` to `to`, both included. Display constants,
 * not tunables: they only name a stretch of the 0–100 scale in four even quarters, so a player can
 * read a meter at a glance; nothing in the simulation reads them. "Spent" starts at 75, where the
 * fatigue meter turns to its danger colour.
 */
export const FATIGUE_BANDS: readonly { band: FatigueBand; from: number; to: number }[] = [
  { band: 'fresh', from: 0, to: 24 },
  { band: 'tired', from: 25, to: 49 },
  { band: 'weary', from: 50, to: 74 },
  { band: 'spent', from: 75, to: 100 },
];

/** The band a fatigue value falls in. A value between two bands (24.5) goes to the higher one. */
export function fatigueBandOf(fatigue: number): FatigueBand {
  let found: FatigueBand = 'fresh';
  for (const { band, from } of FATIGUE_BANDS) {
    if (fatigue > from - 1) {
      found = band;
    }
  }
  return found;
}

/** The tab shows the last 50 injuries; older ones stay in the table but are not listed. */
export const HEALTH_PROFILE_HISTORY_LIMIT = 50;

/** One injury as the Health tab shows it, current or past. */
export interface InjuryView {
  injuryId: InjuryId;
  kindKey: ContentKey;
  /** The catalog's name for it, or the raw key when a modded catalog no longer has the kind. */
  label: string;
  bodyPart: BodyPart;
  severity: InjurySeverity;
  since: GameDate;
  expectedReturn: GameDate;
  /** The day they came back; null for the current injury. */
  returnedOn: GameDate | null;
  /** Days from `since` to the return (the actual one once back, else the expected one). */
  daysOut: number;
  /** Days from today to the expected return, for the current injury; null once back. */
  daysRemaining: number | null;
  canWorkAngles: boolean;
  source: InjurySource;
  segmentId: SegmentId | null;
  /** The Why? for the time out, or null when the trace is gone. */
  durationTraceRef: TraceRef | null;
  /** Condition the hurt part lost, in points. */
  conditionLoss: number;
  conditionLossTraceRef: TraceRef | null;
  /** The chance that led to the injury (a match's or the off-screen one), when one was kept. */
  chanceTraceRef: TraceRef | null;
  /** True only for the worker's own promotion, while it has not seen the injury yet. */
  pendingNotice: boolean;
}

/** One body part on the Health tab. */
export interface BodyPartHealth {
  part: BodyPart;
  /** Condition now, 0 to 100. */
  value: number;
  /** The most it can heal back to at their age. */
  cap: Traced<number>;
  /** Where next Monday's healing would leave it, worked out from today's numbers. */
  nextCheck: Traced<number>;
  /** True when the current injury is to this part (it does not heal until they are back). */
  injured: boolean;
}

/** `health.profile`: everything the Health tab shows about one person. */
export interface HealthProfile {
  personId: PersonId;
  fatigue: {
    /** 0 to 100. */
    value: number;
    band: FatigueBand;
    /** The latest recovery trace, or null when none is stored. */
    traceRef: TraceRef | null;
  };
  /** Every body part, in `BODY_PARTS` order. */
  condition: BodyPartHealth[];
  /** The care they get: their best employer's medical policy, or the free-agent level. */
  medical: { level: MedicalLevel; promotionId: PromotionId | null; promotionName: string | null };
  current: InjuryView | null;
  /** Past injuries, newest first, at most {@link HEALTH_PROFILE_HISTORY_LIMIT}. */
  history: InjuryView[];
}

/** One injured person in `health.report`: their current injury plus what a list shows of them. */
export interface InjuredRow extends InjuryView {
  personId: PersonId;
  /** The ring name at the employer the report is for (else their main one), or their default. */
  name: string;
  /** The stored image reference, or null for none. */
  imageRef: string | null;
  /** Their main employer, or null for a free agent. */
  employer: { promotionId: PromotionId; name: string } | null;
  roles: PersonRole[];
}

/** `health.report`: who is out on `asOf`, soonest back first. */
export interface HealthReport {
  asOf: GameDate;
  rows: InjuredRow[];
}

export interface HealthReportArgs {
  /** Only people with a working contract at this promotion; everyone in the world when left out. */
  promotionId?: PromotionId | undefined;
}

declare module '../../core/api/maps' {
  interface QueryMap {
    'health.profile': { args: { personId: PersonId }; result: HealthProfile | null };
    'health.report': { args: HealthReportArgs; result: HealthReport };
  }
}

function refIfStored(ctx: QueryContext, ref: TraceRef): TraceRef | null {
  return ctx.traces.has(ref) ? ref : null;
}

/** True when one of the viewer's promotions employs the person today. */
function viewerEmploys(ctx: QueryContext, personId: PersonId): boolean {
  const own = new Set(viewerPromotionIds(ctx.read, ctx.viewer));
  if (own.size === 0) {
    return false;
  }
  return activeEmploymentsOf(ctx.read, personId, ctx.date).some((employment) =>
    own.has(employment.promotionId),
  );
}

function injuryView(
  ctx: QueryContext,
  injury: DeepReadonly<InjuryRecord>,
  viewerIsEmployer: boolean,
): InjuryView {
  const open = injury.returnedOn === null;
  return {
    injuryId: injury.id,
    kindKey: injury.kindKey,
    label: injuryKindOf(ctx.read, injury.kindKey)?.label ?? injury.kindKey,
    bodyPart: injury.bodyPart,
    severity: injury.severity,
    since: injury.since,
    expectedReturn: injury.expectedReturn,
    returnedOn: injury.returnedOn,
    daysOut: diffDays(injury.since, injury.returnedOn ?? injury.expectedReturn),
    daysRemaining: open ? Math.max(0, diffDays(ctx.date, injury.expectedReturn)) : null,
    canWorkAngles: injury.canWorkAngles,
    source: injury.source,
    segmentId: injury.segmentId,
    durationTraceRef: refIfStored(ctx, injuryTraceRef(injury.id)),
    conditionLoss: injury.conditionLoss,
    conditionLossTraceRef: refIfStored(ctx, injuryConditionLossTraceRef(injury.id)),
    chanceTraceRef: refIfStored(ctx, injuryRecordChanceTraceRef(injury.id)),
    pendingNotice: injury.noticedOn === null && viewerIsEmployer,
  };
}

function conditionOf(
  ctx: QueryContext,
  person: DeepReadonly<Person>,
  medicalLevel: MedicalLevel,
  medicalSource: string | null,
): BodyPartHealth[] {
  const cap = computeConditionCap(
    {
      age: ageInYears(person.birthDate, ctx.date),
      agingEnabled: ctx.read.meta.settings.agingEnabled,
    },
    { tunables: ctx.tunables },
  );
  return BODY_PARTS.map((part) => {
    const injured = person.injury?.bodyPart === part;
    const nextCheck = computeConditionRecovery(
      {
        current: person.condition[part],
        cap,
        partInjured: injured,
        traits: person.traits,
        medicalLevel,
        medicalSource,
      },
      { tunables: ctx.tunables },
    );
    return { part, value: person.condition[part], cap, nextCheck, injured };
  });
}

/** Newest first: the later start, then the higher id for two on the same day. */
function newestFirst(left: DeepReadonly<InjuryRecord>, right: DeepReadonly<InjuryRecord>): number {
  const byDate = compareDates(right.since, left.since);
  if (byDate !== 0) {
    return byDate;
  }
  return right.id < left.id ? -1 : 1;
}

export const healthProfileQuery: QueryDefinition<'health.profile'> = defineQuery('health.profile', {
  args: z.strictObject({ personId: zId('person') }),
  run: (ctx, args) => {
    const person = ctx.read.tables.people.get(args.personId);
    if (person === undefined) {
      return null;
    }
    const care = medicalLevelOf(ctx.read, person.id, ctx.date, ctx.tunables);
    const promotionName =
      care.promotionId === null
        ? null
        : (ctx.read.tables.promotions.get(care.promotionId)?.name ?? null);
    const viewerIsEmployer = viewerEmploys(ctx, person.id);
    const rows = ctx.read.tables.injuries.lookup('byPerson', person.id);
    const open = rows.find((injury) => injury.returnedOn === null);
    const closed = rows
      .filter((injury) => injury.returnedOn !== null)
      .sort(newestFirst)
      .slice(0, HEALTH_PROFILE_HISTORY_LIMIT);
    return {
      personId: person.id,
      fatigue: {
        value: person.fatigue,
        band: fatigueBandOf(person.fatigue),
        traceRef: refIfStored(ctx, fatigueRecoveryTraceRef(person.id)),
      },
      condition: conditionOf(ctx, person, care.level, promotionName),
      medical: { level: care.level, promotionId: care.promotionId, promotionName },
      current: open === undefined ? null : injuryView(ctx, open, viewerIsEmployer),
      history: closed.map((injury) => injuryView(ctx, injury, viewerIsEmployer)),
    };
  },
});

/** Lower-cased code-unit order, the same on every machine (as `workers.list` sorts names). */
function compareNames(left: string, right: string): number {
  const leftName = left.toLowerCase();
  const rightName = right.toLowerCase();
  return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
}

/** Soonest back first, then by name, then by id so the order never depends on storage. */
function soonestBackFirst(left: InjuredRow, right: InjuredRow): number {
  return (
    compareDates(left.expectedReturn, right.expectedReturn) ||
    compareNames(left.name, right.name) ||
    compareIds(left.personId, right.personId)
  );
}

export const healthReportQuery: QueryDefinition<'health.report'> = defineQuery('health.report', {
  args: z.strictObject({ promotionId: zId('promotion').optional() }),
  run: (ctx, args) => {
    const own = new Set(viewerPromotionIds(ctx.read, ctx.viewer));
    const rows: InjuredRow[] = [];
    // The pointer on the person marks the open injury, so only the hurt are looked up.
    for (const person of ctx.read.tables.people.values()) {
      if (person.injury === null) {
        continue;
      }
      const injury = ctx.read.tables.injuries.lookupOne('openByPerson', person.id);
      if (injury === undefined) {
        continue;
      }
      const employments = activeEmploymentsOf(ctx.read, person.id, ctx.date);
      const atPromotion =
        args.promotionId === undefined
          ? undefined
          : employments.find((employment) => employment.promotionId === args.promotionId);
      if (args.promotionId !== undefined && atPromotion === undefined) {
        continue;
      }
      const primary = primaryEmploymentOf(ctx.read, person.id, ctx.date);
      const named = atPromotion ?? primary;
      const viewerIsEmployer = employments.some((employment) => own.has(employment.promotionId));
      rows.push({
        ...injuryView(ctx, injury, viewerIsEmployer),
        personId: person.id,
        name: named?.ringName ?? person.defaultRingName,
        imageRef: person.imageRef,
        employer:
          primary === null
            ? null
            : {
                promotionId: primary.promotionId,
                name: ctx.read.tables.promotions.get(primary.promotionId)?.name ?? '',
              },
        roles: [...person.roles],
      });
    }
    rows.sort(soonestBackFirst);
    return { asOf: ctx.date, rows };
  },
});

export const healthQueries: readonly QueryDefinition[] = [healthProfileQuery, healthReportQuery];
