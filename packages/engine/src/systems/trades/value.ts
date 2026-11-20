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
export const CASH_DOC_REF = 'trades.md#cash';

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
  /** What cash is worth to this side in this deal: cents per point (see `cashRate`). */
  readonly cashPerPoint: number;
  /** Set when the side would give up a top star mostly for cash: it won't. */
  readonly starForCash: string | null;
  /** Plain-words lines for the answer, one per part. */
  readonly lines: readonly string[];
}

/**
 * The pay a cash price is counted from, a month: the contract's cost, but at least
 * `trades.cash.marketFloor` × their market value (so a token contract is no bargain).
 */
export function cashPayBasis(worker: TradeWorker, tunables: EngineTunables): number {
  return Math.max(
    worker.monthlyCost,
    worker.marketMonthly * tunables.get('trades.cash.marketFloor'),
  );
}

/** Years of pay a rival asks in cash for this worker (`trades.cash.multiple.*`). */
export function cashMultiple(worker: TradeWorker, tunables: EngineTunables): number {
  const band =
    worker.push === 'none'
      ? tunables.get('trades.cash.multiple.crew')
      : tunables.get(`trades.cash.multiple.${worker.push}`);
  return worker.value >= tunables.get('trades.value.starValue')
    ? Math.max(band, tunables.get('trades.cash.multiple.star'))
    : band;
}

/** The worker's price in cash: yearly pay × the multiple, in cents. */
export function cashPrice(worker: TradeWorker, tunables: EngineTunables): number {
  return cashPayBasis(worker, tunables) * 12 * cashMultiple(worker, tunables);
}

/**
 * How much the side's money in the bank changes what cash is worth to it: (runway ÷
 * `trades.cash.runwayMonths`) ^ −`financeExponent`, within `financeMin`–`financeMax`. Runway is its
 * cash in months of payroll; a cash-poor side values cash more.
 */
export function financeFactor(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
): { factor: number; runwayMonths: number | null } {
  const cash = read.tables.promotions.get(promotionId)?.cash ?? 0;
  const appearances = tunables.get('trades.value.appearancesPerMonth');
  let payroll = 0;
  for (const row of read.tables.employments.lookup('byPromotionStatus', `${promotionId}|active`)) {
    payroll += row.terms.monthlyWage + row.terms.perAppearanceFee * appearances;
  }
  const min = tunables.get('trades.cash.financeMin');
  const max = tunables.get('trades.cash.financeMax');
  if (payroll <= 0) {
    return { factor: cash > 0 ? min : max, runwayMonths: null };
  }
  const runway = Math.max(0, cash) / payroll;
  const reference = tunables.get('trades.cash.runwayMonths');
  const raw =
    runway <= 0 ? max : Math.pow(runway / reference, -tunables.get('trades.cash.financeExponent'));
  return { factor: Math.min(max, Math.max(min, raw)), runwayMonths: runway };
}

/**
 * What cash is worth to `promotionId` in a deal over `readings`, as cents per point, with its Why?:
 * the cash price of the workers (yearly pay × the multiple) over their points, so buying a worker
 * with cash costs their price, ÷ the finance factor. Null when no worker is in the deal.
 */
export function cashRate(
  read: GameWorldView,
  tunables: EngineTunables,
  promotionId: PromotionId,
  readings: readonly WorkerReading[],
): Traced<number> | null {
  if (readings.length === 0) {
    return null;
  }
  let points = 0;
  const calc = startCalc('What cash is worth to them (cents per point)', 0, {
    unit: 'money',
    docRef: CASH_DOC_REF,
    startLabel: 'Nothing counted yet',
  });
  for (const reading of readings) {
    const worker = reading.worker;
    const multiple = cashMultiple(worker, tunables);
    const workerPrice = cashPrice(worker, tunables);
    points += Math.max(1, reading.points.value);
    calc.add(
      `Price of ${worker.name}: ${moneyText(cashPayBasis(worker, tunables) * 12)} a year × ${pointsText(multiple)}`,
      workerPrice,
    );
  }
  calc.divide(`Their worth: ${pointsText(points)} points`, points);
  const finances = financeFactor(read, tunables, promotionId);
  calc.divide(
    finances.runwayMonths === null
      ? 'Their finances: no payroll'
      : `Their finances: ${pointsText(finances.runwayMonths)} months of payroll in the bank`,
    finances.factor,
  );
  return calc.done();
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

/**
 * A worker a rival won't sell for money: a top star by draft value (`trades.value.starValue`) or
 * its ace, the best-valued wrestler on its roster.
 */
export function isProtectedStar(
  read: GameWorldView,
  reader: TradeWorkerReader,
  worker: TradeWorker,
  tunables: EngineTunables,
): boolean {
  if (worker.value >= tunables.get('trades.value.starValue')) {
    return true;
  }
  if (worker.role !== 'wrestler') {
    return false;
  }
  for (const row of read.tables.employments.lookup(
    'byPromotionStatus',
    `${worker.promotionId}|active`,
  )) {
    if (row.role !== 'wrestler' || row.id === worker.employmentId) {
      continue;
    }
    const other = reader.worker(row.id);
    if (other !== null && other.value > worker.value) {
      return false;
    }
  }
  return true;
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
  const rate = cashRate(read, tunables, promotionId, [...incoming, ...outgoing]);
  const cashPerPoint = rate?.value ?? Number.POSITIVE_INFINITY;
  if (rate !== null && (other.cash > 0 || own.cash > 0)) {
    lines.push(
      `Cash is worth 1 point per ${moneyText(rate.value)} to them (a few years of the workers' pay)`,
    );
  }
  if (other.cash > 0 && rate !== null) {
    calc.add(
      `Cash from ${read.tables.promotions.get(other.promotionId)?.name ?? 'the other side'}: ${moneyText(other.cash)}`,
      startCalc(`Cash from the other side`, other.cash, { unit: 'points', docRef: CASH_DOC_REF })
        .divide('What cash is worth to them', rate)
        .done(),
    );
    lines.push(
      `Cash in: ${moneyText(other.cash)} (${pointsText(other.cash / cashPerPoint)} points)`,
    );
  }
  if (own.cash > 0 && rate !== null) {
    calc.subtract(
      `Cash they pay: ${moneyText(own.cash)}`,
      startCalc('Cash they pay', own.cash, { unit: 'points', docRef: CASH_DOC_REF })
        .divide('What cash is worth to them', rate)
        .done(),
    );
    lines.push(`Cash out: ${moneyText(own.cash)} (${pointsText(own.cash / cashPerPoint)} points)`);
  }
  // A top star or their ace never goes mostly for cash: the workers coming back must be worth enough.
  let starForCash: string | null = null;
  // Two or more from the top card (main event, upper card) at once all count too: cash can buy
  // one top-card worker per trade, never the whole top of the card.
  const topCard = outgoing.filter(
    (reading) => reading.worker.push === 'mainEvent' || reading.worker.push === 'upperCard',
  );
  const stars = outgoing.filter(
    (reading) =>
      isProtectedStar(read, reader, reading.worker, tunables) ||
      (topCard.length > 1 && topCard.includes(reading)),
  );

  if (stars.length > 0) {
    const share = tunables.get('trades.cash.starWorkerShare');
    const back = incoming.reduce((total, reading) => total + reading.points.value, 0);
    const given = stars.reduce((total, reading) => total + reading.points.value, 0);
    if (back < given * share) {
      const names = stars.map((reading) => reading.worker.name).join(', ');
      starForCash = `They won't sell their top star for money: ${names} only goes for workers worth at least ${pointsText(given * share)} points`;
      lines.push(starForCash);
    }
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
    cashPerPoint,
    starForCash,
    lines,
  };
}
