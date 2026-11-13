/**
 * `health.injure`: the one way anyone gets hurt (WRK6-03).
 *
 * Every feature that injures someone (MTCH4's in-match roll, DAY7's world events, the off-screen
 * injuries of WRK6-04) calls `injure`. It is the only code that inserts into the `injuries` table
 * or sets `person.injury` (`test/systems/health/ownership.test.ts` checks it). The daily return
 * step in `health.recovery` (`returns.ts`) is the only code that closes one.
 *
 * An injury never touches morale or anger: it is not a result, so the story shield (D-09) is not
 * involved either.
 *
 * Design: docs/design/health.md#injuries.
 */

import type { ContentKey } from '../../core/content-key';
import { addDays } from '../../core/date';
import { InvalidArgumentError } from '../../core/errors';
import type { InjuryId, PersonId, SegmentId } from '../../core/ids';
import type { PhaseContext } from '../../core/pipeline/context';
import { rollChance, type RollRecord } from '../../core/rng/rolls';
import type { TraceRef } from '../../core/trace/store';
import type { FormulaNode, Traced } from '../../core/trace/types';
import {
  hasCatalog,
  injuryCatalogOf,
  injuryKindOf,
  type InjurySeverity,
} from '../../model/catalogs';
import type { InjurySource } from '../../model/entities/injury';
import type { BodyPart } from '../../model/entities/person';
import { medicalCareLabel } from './formulas/conditionRecovery';
import { computeInjuryConditionLoss } from './formulas/injuryConditionLoss';
import { pickInjuryKind } from './formulas/injuryKindPick';
import { computeInjuryDays } from './formulas/injuryOutcome';
import { decideInjurySeverity } from './formulas/injurySeverity';
import { medicalLevelOf } from './medical';
import { INJURIES_STREAM } from './streams';

/** The trace kind of an injury's time out (its Why?). */
export const INJURY_TRACE_KIND = 'health.injury';
/** The trace kind of the condition an injury cost. */
export const INJURY_CONDITION_LOSS_TRACE_KIND = 'health.injuryConditionLoss';
/** The trace kind of the chance that led to the injury, when the caller had one. */
export const INJURY_CHANCE_TRACE_KIND = 'health.injuryChance';

/** Every trace kind an injury is stored under. */
export const INJURY_TRACE_KINDS = [
  INJURY_TRACE_KIND,
  INJURY_CONDITION_LOSS_TRACE_KIND,
  INJURY_CHANCE_TRACE_KIND,
] as const;

/** Where an injury's time out trace (its Why?) is stored. */
export function injuryTraceRef(injuryId: InjuryId): TraceRef {
  return { kind: INJURY_TRACE_KIND, id: injuryId };
}

/** Where the condition an injury cost is stored. */
export function injuryConditionLossTraceRef(injuryId: InjuryId): TraceRef {
  return { kind: INJURY_CONDITION_LOSS_TRACE_KIND, id: injuryId };
}

/** Where the chance that led to an injury is stored. */
export function injuryRecordChanceTraceRef(injuryId: InjuryId): TraceRef {
  return { kind: INJURY_CHANCE_TRACE_KIND, id: injuryId };
}

export interface InjureOptions {
  /** The kind of injury. Left out, one is rolled from the world's injury catalog. */
  kindKey?: ContentKey;
  source: InjurySource;
  /** The segment they were hurt in. Required for `segment`, not allowed for `world`. */
  segmentId?: SegmentId;
  /** A severity the caller already knows. Left out, it is rolled from the kind's weights. */
  severity?: InjurySeverity;
  /**
   * When no `kindKey` is given, roll only among kinds on this body part (MTCH4's hint: the part
   * the match wore down most). With no kind on that part, every kind can come up.
   */
  bodyPart?: BodyPart;
  /** The chance that led to the injury (MTCH4's injury chance), kept for the injury's Why? */
  chanceTrace?: Traced<number>;
}

export type InjureRefusal = 'alreadyInjured' | 'notInjurable' | 'unknownKind' | 'noCatalog';

export type InjureResult = { ok: true; injuryId: InjuryId } | { ok: false; reason: InjureRefusal };

/** People who cannot be hurt any more. */
const NOT_INJURABLE = new Set(['retired', 'deceased']);

/** The note under the angles roll. */
export function anglesNote(canWorkAngles: boolean): string {
  return canWorkAngles ? 'Can still work angles while out' : 'Cannot work angles while out';
}

/**
 * The days-out trace with the angles roll and its note added at the end. Rolls and notes do not
 * move the running value, so the trace still replays to the same days.
 */
function withAnglesRoll(
  days: Traced<number>,
  roll: RollRecord,
  canWorkAngles: boolean,
): Traced<number> {
  const root = days.trace;
  if (root.kind !== 'formula') {
    throw new Error('health.injure: the days-out trace should be a calculation');
  }
  const trace: FormulaNode = {
    ...root,
    children: [
      ...root.children,
      { kind: 'roll', label: 'Can they work angles?', value: roll.result, roll: { ...roll } },
      { kind: 'note', label: anglesNote(canWorkAngles), value: null },
    ],
  };
  return { value: days.value, trace };
}

function checkSource(personId: PersonId, options: InjureOptions): void {
  if (options.source === 'segment' && options.segmentId === undefined) {
    throw new InvalidArgumentError(
      'injure',
      'options.segmentId',
      options.segmentId,
      `the segment ${personId} was hurt in, for a segment injury`,
    );
  }
  if (options.source === 'world' && options.segmentId !== undefined) {
    throw new InvalidArgumentError(
      'injure',
      'options.segmentId',
      options.segmentId,
      'left out for a world injury',
    );
  }
}

/** The kind to use, or why there is none. Rolls only when the caller named no kind. */
function chooseKind(
  ctx: PhaseContext,
  options: InjureOptions,
): { ok: true; key: ContentKey } | { ok: false; reason: InjureRefusal } {
  if (options.kindKey !== undefined) {
    return injuryKindOf(ctx.read, options.kindKey) === undefined
      ? { ok: false, reason: 'unknownKind' }
      : { ok: true, key: options.kindKey };
  }
  const catalog = injuryCatalogOf(ctx.read);
  if (!hasCatalog(ctx.read, 'injuries') || catalog.length === 0) {
    ctx.log('health.injure: this world has no injury catalog, so nobody was hurt');
    return { ok: false, reason: 'noCatalog' };
  }
  const onPart =
    options.bodyPart === undefined
      ? []
      : catalog.filter((kind) => kind.bodyPart === options.bodyPart);
  const picked = pickInjuryKind(
    { catalog: onPart.length > 0 ? onPart : catalog },
    { rng: ctx.rng(INJURIES_STREAM) },
  );
  return picked.value === null
    ? { ok: false, reason: 'noCatalog' }
    : { ok: true, key: picked.value };
}

/**
 * Hurts `personId`: rolls the injury (kind, severity, days out, whether they can work angles) on
 * `health.injuries`, stores the injury row and the person's `injury` pointer, takes condition off
 * the hurt part, records the traces under the injury id and publishes `injury.sustained`.
 *
 * Refuses (changing nothing and drawing nothing) a person who is retired, deceased or missing
 * (`notInjurable`), someone already injured (`alreadyInjured`: injuries never stack), an unknown
 * `kindKey` (`unknownKind`), and a world with no injury catalog when no kind is named
 * (`noCatalog`).
 *
 * @throws InvalidArgumentError for a segment injury without `segmentId`, or a world injury with one.
 */
export function injure(
  ctx: PhaseContext,
  personId: PersonId,
  options: InjureOptions,
): InjureResult {
  checkSource(personId, options);
  const person = ctx.read.tables.people.get(personId);
  if (person === undefined || NOT_INJURABLE.has(person.status)) {
    return { ok: false, reason: 'notInjurable' };
  }
  if (
    person.injury !== null ||
    ctx.read.tables.injuries.lookupOne('openByPerson', personId) !== undefined
  ) {
    return { ok: false, reason: 'alreadyInjured' };
  }
  const chosen = chooseKind(ctx, options);
  if (!chosen.ok) {
    return chosen;
  }
  const kind = injuryKindOf(ctx.read, chosen.key);
  if (kind === undefined) {
    return { ok: false, reason: 'unknownKind' };
  }

  const stream = ctx.rng(INJURIES_STREAM);
  const severity = decideInjurySeverity(
    {
      weights: kind.severityWeights,
      ...(options.severity === undefined ? {} : { forced: options.severity }),
    },
    { rng: stream },
  );
  const care = medicalLevelOf(ctx.read, personId, ctx.date, ctx.tunables);
  const promotionName =
    care.promotionId === null
      ? null
      : (ctx.read.tables.promotions.get(care.promotionId)?.name ?? null);
  const days = computeInjuryDays(
    {
      kind: { label: kind.label, minDays: kind.minDays, maxDays: kind.maxDays },
      severity,
      traits: person.traits,
      medicalLevel: care.level,
      medicalLabel: medicalCareLabel(care.level, promotionName),
    },
    { tunables: ctx.tunables, rng: stream },
  );
  const angles = rollChance(stream, kind.canWorkAnglesChance, 'Can they work angles?');
  const outcome = withAnglesRoll(days, angles.roll, angles.value);
  const loss = computeInjuryConditionLoss(
    { daysOut: days, currentCondition: person.condition[kind.bodyPart] },
    { tunables: ctx.tunables },
  );

  const expectedReturn = addDays(ctx.date, days.value);
  const row = ctx.tx.create('injuries', {
    personId,
    kindKey: kind.key,
    bodyPart: kind.bodyPart,
    severity: severity.value,
    since: ctx.date,
    expectedReturn,
    returnedOn: null,
    source: options.source,
    segmentId: options.segmentId ?? null,
    canWorkAngles: angles.value,
    conditionLoss: loss.value,
    // WRK6-04's own-injury gate decides when the promotion notices; until then, on the day.
    noticedOn: ctx.date,
  });
  ctx.tx.update('people', personId, {
    injury: {
      kindKey: kind.key,
      bodyPart: kind.bodyPart,
      since: ctx.date,
      expectedReturn,
      canWorkAngles: angles.value,
    },
    condition: {
      ...person.condition,
      [kind.bodyPart]: person.condition[kind.bodyPart] - loss.value,
    },
  });
  ctx.recordTrace(injuryTraceRef(row.id), ctx.date, outcome);
  ctx.recordTrace(injuryConditionLossTraceRef(row.id), ctx.date, loss);
  if (options.chanceTrace !== undefined) {
    ctx.recordTrace(injuryRecordChanceTraceRef(row.id), ctx.date, options.chanceTrace);
  }
  ctx.publish('injury.sustained', {
    personId,
    injuryId: row.id,
    kindKey: kind.key,
    bodyPart: kind.bodyPart,
    severity: severity.value,
    expectedReturn,
    source: options.source,
    segmentId: options.segmentId ?? null,
  });
  return { ok: true, injuryId: row.id };
}
