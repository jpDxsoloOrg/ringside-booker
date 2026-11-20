/**
 * How a computer promotion values a trade (TRD-01): every worker it would get or give up, the
 * roster needs the deal fills or opens, and the cash, all in points. Deterministic: the same world
 * and offer always give the same number.
 *
 * Per worker (`workerPoints`):
 * 1. The draft value (`systems/draft/draftValue.ts`): role rating, popularity and age, 0-100.
 * 2. × contract control: `trades.value.shortContractFactor` for a contract about to end, rising to
 *    1 at `trades.value.fullControlMonths` months left (an open-ended contract is full control).
 * 3. + contract cost: `(market value − monthly cost) ÷ market value`, kept between −1 and 1,
 *    × `trades.value.costWeight` × the same control share: a bargain contract adds points, an
 *    overpaid one takes them away, more so the longer it runs.
 * 4. Giving away a top star (draft value at least `trades.value.starValue`, or a main eventer):
 *    × `trades.value.starKeepFactor`.
 *
 * The deal (`valueDeal`): workers in − workers out, + roster needs (the AIP needs of the rival's
 * roster before and after: the severity they lose, × `trades.value.needWeight`; by division,
 * card level, faces and heels, and crew), + cash in − cash out ÷ `trades.value.cashPerPoint`.
 *
 * Design: docs/design/trades.md#valuation.
 */

import type { GameDate } from '../../core/date';
import type { EmploymentId, PromotionId } from '../../core/ids';
import { startCalc, type Traced } from '../../core/trace';
import { sidesOf, type TradeOffer } from '../../model/entities/trade';
import type { GameWorldView } from '../../model/tables';
import type { DeepReadonly } from '../../model/world';
import {
  NEED_CREW_ROLES,
  needSummaryText,
  rosterNeeds,
  type Need,
  type NeedCrewRole,
  type NeedsInputs,
} from '../aip/formulas/needs';
import { needsInputsFor } from '../aip/inputs';
import { unitOf } from '../aip/units';
import { draftValue } from '../draft/draftValue';
import { moneyText } from '../production/formulas/shared';
import type { EngineTunables } from '../tunables';
import { TradeWorkerReader, type TradeWorker } from './workers';

export const VALUATION_DOC_REF = 'trades.md#valuation';

/** One decimal, for points in plain words. */
export function pointsText(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

/** A worker in a deal, as one side's desk counts them. */
export interface WorkerReading {
  readonly worker: TradeWorker;
  /** Points for the side reading it (positive). */
  readonly points: Traced<number>;
  /** A top star the side hates to lose (only for workers it gives up). */
  readonly star: boolean;
}

export interface NeedChange {
  readonly key: string;
  readonly text: string;
  readonly before: number;
  readonly after: number;
}

export interface DealValue {
  readonly promotionId: PromotionId;
  readonly score: Traced<number>;
  readonly incoming: readonly WorkerReading[];
  readonly outgoing: readonly WorkerReading[];
  readonly needPoints: number;
  readonly needChanges: readonly NeedChange[];
  readonly cashIn: number;
  readonly cashOut: number;
  /** Plain-words lines for the answer, one per part. */
  readonly lines: readonly string[];
}

function controlShare(worker: TradeWorker, tunables: EngineTunables): number {
  if (worker.monthsLeft === null) {
    return 1;
  }
  const full = tunables.get('trades.value.fullControlMonths');
  return Math.min(1, worker.monthsLeft / full);
}

function monthsText(worker: TradeWorker): string {
  if (worker.monthsLeft === null) {
    return 'open-ended contract';
  }
  const months = Math.round(worker.monthsLeft);
  return months === 1 ? '1 month left' : `${String(months)} months left`;
}

/** True when the side would hate to lose this worker. */
export function isTopStar(worker: TradeWorker, tunables: EngineTunables): boolean {
  return worker.push === 'mainEvent' || worker.value >= tunables.get('trades.value.starValue');
}

/**
 * What one worker is worth to a side, in points. `givingAway` adds the top-star factor for a
 * worker the side would lose.
 */
export function workerPoints(
  worker: TradeWorker,
  deps: { tunables: EngineTunables },
  givingAway: boolean,
): WorkerReading {
  const { tunables } = deps;
  const base = draftValue(
    {
      roleRating: worker.rating,
      peakPop: worker.peakPop,
      worldPop: worker.worldPop,
      age: worker.age,
    },
    deps,
  );
  const calc = startCalc(`Trade value of ${worker.name}`, base, {
    unit: 'points',
    docRef: VALUATION_DOC_REF,
    startLabel: 'Draft value',
  });
  const share = controlShare(worker, tunables);
  const shortFactor = tunables.get('trades.value.shortContractFactor');
  const control = shortFactor + (1 - shortFactor) * share;
  calc.multiply(`Contract control: ${monthsText(worker)}`, control);
  const market = Math.max(1, worker.marketMonthly);
  const surplus = Math.max(-1, Math.min(1, (market - worker.monthlyCost) / market));
  const costWeight = tunables.get('trades.value.costWeight');
  const cost = surplus * costWeight * share;
  if (cost !== 0) {
    calc.add(
      `Contract cost: ${moneyText(worker.monthlyCost)} a month against a market value of ${moneyText(market)}`,
      cost,
    );
  }
  const star = givingAway && isTopStar(worker, tunables);
  if (star) {
    calc.multiply(
      'A top star they hate to lose',
      calc.tunable(tunables, 'trades.value.starKeepFactor'),
    );
  }
  return { worker, points: calc.done(), star };
}

function totalSeverity(needs: readonly Need[]): Map<string, { value: number; text: string }> {
  const byKey = new Map<string, { value: number; text: string }>();
  for (const need of needs) {
    byKey.set(need.key, { value: need.severity.value, text: needSummaryText(need.summary) });
  }
  return byKey;
}

function isCrewRole(role: string): role is NeedCrewRole {
  return NEED_CREW_ROLES.some((crew) => crew === role);
}

/** The needs inputs with `outgoing` gone and `incoming` added. */
function inputsAfter(
  before: NeedsInputs,
  incoming: readonly TradeWorker[],
  outgoing: readonly TradeWorker[],
): NeedsInputs {
  const leaving = new Set(outgoing.map((worker) => worker.personId));
  const crewCounts = { ...before.crewCounts };
  for (const worker of outgoing) {
    if (isCrewRole(worker.role)) {
      crewCounts[worker.role] = Math.max(0, crewCounts[worker.role] - 1);
    }
  }
  const wrestlers = before.wrestlers.filter((wrestler) => !leaving.has(wrestler.personId));
  for (const worker of incoming) {
    if (isCrewRole(worker.role)) {
      crewCounts[worker.role] += 1;
    } else if (worker.role === 'wrestler') {
      wrestlers.push({
        personId: worker.personId,
        name: worker.name,
        gender: worker.gender,
        push: worker.push,
        alignment: worker.alignment,
        available: worker.available,
      });
    }
  }
  return { ...before, wrestlers, crewCounts };
}

/** How the deal moves the side's roster needs: severity lost (positive) and what changed. */
export function needsChange(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
  promotionId: PromotionId,
  incoming: readonly TradeWorker[],
  outgoing: readonly TradeWorker[],
): { relief: number; changes: NeedChange[] } {
  const before = needsInputsFor(read, tunables, unitOf(read, promotionId), date);
  const after = inputsAfter(before, incoming, outgoing);
  const beforeNeeds = totalSeverity(rosterNeeds(before, { tunables }));
  const afterNeeds = totalSeverity(rosterNeeds(after, { tunables }));
  const keys = [...new Set([...beforeNeeds.keys(), ...afterNeeds.keys()])].sort();
  const changes: NeedChange[] = [];
  let relief = 0;
  for (const key of keys) {
    const was = beforeNeeds.get(key);
    const now = afterNeeds.get(key);
    const beforeValue = was?.value ?? 0;
    const afterValue = now?.value ?? 0;
    if (beforeValue === afterValue) {
      continue;
    }
    relief += beforeValue - afterValue;
    changes.push({
      key,
      text: (now ?? was)?.text ?? key,
      before: beforeValue,
      after: afterValue,
    });
  }
  return { relief, changes };
}

/** The side of `offer` that `promotionId` sends, and the other side. */
export function sidesFor(
  offer: DeepReadonly<TradeOffer>,
  promotionId: PromotionId,
): {
  own: DeepReadonly<TradeOffer>['sides'][number];
  other: DeepReadonly<TradeOffer>['sides'][number];
} {
  const [first, second] = sidesOf(offer);
  return first.promotionId === promotionId
    ? { own: first, other: second }
    : { own: second, other: first };
}

/** The workers of a side, with the deal's contract changes. Unknown contracts are left out. */
export function sideWorkers(
  reader: TradeWorkerReader,
  offer: DeepReadonly<TradeOffer>,
  employmentIds: readonly EmploymentId[],
): TradeWorker[] {
  const workers: TradeWorker[] = [];
  for (const employmentId of employmentIds) {
    const adjustment =
      offer.adjustments.find((candidate) => candidate.employmentId === employmentId) ?? null;
    const worker = reader.worker(employmentId, adjustment);
    if (worker !== null) {
      workers.push(worker);
    }
  }
  return workers;
}

/** The deal as `promotionId`'s desk sees it. */
export function valueDeal(
  read: GameWorldView,
  tunables: EngineTunables,
  date: GameDate,
  offer: DeepReadonly<TradeOffer>,
  promotionId: PromotionId,
): DealValue {
  const reader = new TradeWorkerReader(read, tunables, date);
  const { own, other } = sidesFor(offer, promotionId);
  const name = read.tables.promotions.get(promotionId)?.name ?? 'They';
  const incoming = sideWorkers(reader, offer, other.employmentIds).map((worker) =>
    workerPoints(worker, { tunables }, false),
  );
  const outgoing = sideWorkers(reader, offer, own.employmentIds).map((worker) =>
    workerPoints(worker, { tunables }, true),
  );
  const needs = needsChange(
    read,
    tunables,
    date,
    promotionId,
    incoming.map((reading) => reading.worker),
    outgoing.map((reading) => reading.worker),
  );
  const calc = startCalc(`What the deal is worth to ${name}`, 0, {
    unit: 'points',
    docRef: VALUATION_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  const lines: string[] = [];
  for (const reading of incoming) {
    calc.add(`${reading.worker.name} joins them`, reading.points);
    lines.push(
      `They get ${reading.worker.name}: worth ${pointsText(reading.points.value)} points to them`,
    );
  }
  for (const reading of outgoing) {
    calc.subtract(`${reading.worker.name} leaves them`, reading.points);
    lines.push(
      `They give up ${reading.worker.name}: worth ${pointsText(reading.points.value)} points to them${reading.star ? ' (a top star they hate to lose)' : ''}`,
    );
  }
  const needWeight = tunables.get('trades.value.needWeight');
  const needPoints = needs.relief * needWeight;
  if (needs.changes.length > 0) {
    calc.add(
      `Roster needs: ${pointsText(needs.relief)} severity ${needs.relief >= 0 ? 'filled' : 'opened'} × ${pointsText(needWeight)}`,
      needPoints,
    );
    for (const change of needs.changes) {
      lines.push(
        change.after < change.before
          ? `Helps a need: ${change.text}`
          : `Leaves them short: ${change.text}`,
      );
    }
  }
  const cashPerPoint = tunables.get('trades.value.cashPerPoint');
  if (other.cash > 0) {
    calc.add(
      `Cash from ${read.tables.promotions.get(other.promotionId)?.name ?? 'the other side'}: ${moneyText(other.cash)}`,
      other.cash / cashPerPoint,
    );
    lines.push(
      `Cash in: ${moneyText(other.cash)} (${pointsText(other.cash / cashPerPoint)} points)`,
    );
  }
  if (own.cash > 0) {
    calc.subtract(`Cash they pay: ${moneyText(own.cash)}`, own.cash / cashPerPoint);
    lines.push(`Cash out: ${moneyText(own.cash)} (${pointsText(own.cash / cashPerPoint)} points)`);
  }
  return {
    promotionId,
    score: calc.done(),
    incoming,
    outgoing,
    needPoints,
    needChanges: needs.changes,
    cashIn: other.cash,
    cashOut: own.cash,
    lines,
  };
}
