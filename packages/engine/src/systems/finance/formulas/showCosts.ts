/**
 * Show costs: what one show costs on the night, as three numbers with a Why? each.
 *
 * Design: docs/design/finances.md#show-costs.
 *
 * - **Appearance fees** = Σ per-appearance fee over the paid workers.
 * - **Travel** = Σ over the paid workers of the travel rate at the promotion's travel level, then
 *   × the show's importance multiplier × the distance multiplier, rounded to the cent. A contract
 *   with the travel perk is paid at least at `finance.travel.coveredLevel`.
 * - **Catering** = the catering rate at the promotion's catering level × the importance
 *   multiplier, rounded to the cent.
 *
 * Paid workers are the show's distinct workers less guests (no contract here) and the owner and
 * booker. Each worker is one line, so a long card stays readable: past
 * {@link SHOW_COST_TRACE_LINES_MAX} lines the rest fold into one "and N more" line. Nothing here
 * depends on segment length (D-10): costs follow headcount, importance and distance only.
 */

import { startCalc, type Calc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EventImportance } from '../../../model/entities/event-definition';
import type { EngineTunables, NumberTunableKey } from '../../tunables';
import { POLICY_LEVEL_LABELS, type PolicyLevel } from '../policies';
import type { ShowWorker } from '../showWorkers';
import { PAYROLL_TRACE_LINES_MAX } from './monthlyPayroll';

export const SHOW_COSTS_DOC_REF = 'docs/design/finances.md#show-costs';

/** Workers listed one by one in a cost's Why?; the rest fold into one line. */
export const SHOW_COST_TRACE_LINES_MAX = PAYROLL_TRACE_LINES_MAX;

/** The note on a show whose card was estimated from the roster. */
export const ESTIMATED_CARD_NOTE = 'Card not booked in detail: estimated from the roster';

/** Where a show is held, seen from the promotion's home. */
export type ShowDistance = 'home' | 'domestic' | 'abroad';

export const SHOW_DISTANCES: readonly ShowDistance[] = ['home', 'domestic', 'abroad'];

export const TRAVEL_RATE_KEYS: Readonly<Record<PolicyLevel, NumberTunableKey>> = Object.freeze({
  0: 'finance.travel.perWorker.level0',
  1: 'finance.travel.perWorker.level1',
  2: 'finance.travel.perWorker.level2',
  3: 'finance.travel.perWorker.level3',
});

export const CATERING_RATE_KEYS: Readonly<Record<PolicyLevel, NumberTunableKey>> = Object.freeze({
  0: 'finance.catering.perShow.level0',
  1: 'finance.catering.perShow.level1',
  2: 'finance.catering.perShow.level2',
  3: 'finance.catering.perShow.level3',
});

export const IMPORTANCE_MULTIPLIER_KEYS: Readonly<Record<EventImportance, NumberTunableKey>> =
  Object.freeze({
    house: 'finance.show.importance.house',
    minor: 'finance.show.importance.minor',
    regular: 'finance.show.importance.regular',
    major: 'finance.show.importance.major',
    flagship: 'finance.show.importance.flagship',
  });

/** What the formula reads about one worker. */
export type ShowCostWorker = Pick<
  ShowWorker,
  'name' | 'perAppearanceFee' | 'travelCovered' | 'excluded'
>;

export interface ShowCostsInputs {
  workers: readonly ShowCostWorker[];
  /** True when the card was estimated from the roster. */
  estimated: boolean;
  importance: EventImportance;
  /** The importance's name, such as "Regular". */
  importanceLabel: string;
  distance: ShowDistance;
  travelLevel: PolicyLevel;
  cateringLevel: PolicyLevel;
}

export interface ShowCosts {
  appearanceFees: Traced<number>;
  travel: Traced<number>;
  catering: Traced<number>;
}

interface CostLine {
  label: string;
  amount: number;
  /** The rate tunable the amount comes from, recorded on the line that first uses it. */
  rateKey?: NumberTunableKey;
  rateLabel?: string;
}

function plural(count: number, one: string, many: string): string {
  return `${String(count)} ${count === 1 ? one : many}`;
}

/**
 * Adds one step per line (the first {@link SHOW_COST_TRACE_LINES_MAX}), then one step for the rest.
 * A rate tunable is recorded on the first line that uses it, so the Why? names every rate once.
 */
function addLines(
  calc: Calc,
  lines: readonly CostLine[],
  tunables: EngineTunables,
  noun: [string, string],
): void {
  const read = new Set<NumberTunableKey>();
  const recordRate = (line: CostLine): void => {
    if (line.rateKey !== undefined && !read.has(line.rateKey)) {
      read.add(line.rateKey);
      calc.tunable(tunables, line.rateKey, line.rateLabel);
    }
  };
  const listed = lines.slice(0, SHOW_COST_TRACE_LINES_MAX);
  for (const line of listed) {
    recordRate(line);
    calc.add(line.label, line.amount);
  }
  const folded = lines.slice(SHOW_COST_TRACE_LINES_MAX);
  if (folded.length > 0) {
    folded.forEach(recordRate);
    const total = folded.reduce((sum, line) => sum + line.amount, 0);
    calc.add(`and ${plural(folded.length, `more ${noun[0]}`, `more ${noun[1]}`)}`, total);
  }
}

/** Notes for the workers on the card who cost nothing. */
function addExclusionNotes(calc: Calc, workers: readonly ShowCostWorker[]): void {
  const guests = workers.filter((worker) => worker.excluded === 'guest').length;
  if (guests > 0) {
    calc.note(`${plural(guests, 'guest has', 'guests have')} no contract here: nothing to pay`);
  }
  const ownerOrBooker = workers.filter((worker) => worker.excluded === 'ownerOrBooker').length;
  if (ownerOrBooker > 0) {
    calc.note(
      `${plural(ownerOrBooker, 'worker runs', 'workers run')} the promotion (owner or booker): not charged`,
    );
  }
}

function paidWorkers(workers: readonly ShowCostWorker[]): ShowCostWorker[] {
  return workers.filter((worker) => worker.excluded === null);
}

/** Appearance fees: Σ per-appearance fee over the paid workers. */
function appearanceFees(inputs: ShowCostsInputs, tunables: EngineTunables): Traced<number> {
  const lines = paidWorkers(inputs.workers)
    .filter((worker) => worker.perAppearanceFee > 0)
    .map((worker): CostLine => ({ label: worker.name, amount: worker.perAppearanceFee }));
  const calc = startCalc('Appearance fees', 0, {
    unit: 'money',
    docRef: SHOW_COSTS_DOC_REF,
    startLabel:
      lines.length === 0 ? 'Nobody on the card is paid per appearance' : 'Per-appearance fees',
  });
  addLines(calc, lines, tunables, ['worker', 'workers']);
  addExclusionNotes(calc, inputs.workers);
  if (inputs.estimated) {
    calc.note(ESTIMATED_CARD_NOTE);
  }
  return calc.done();
}

/** The travel level a worker is paid at: the travel perk lifts it to the covered level. */
function travelLevelOf(
  worker: ShowCostWorker,
  level: PolicyLevel,
  coveredLevel: PolicyLevel,
): PolicyLevel {
  return worker.travelCovered && coveredLevel > level ? coveredLevel : level;
}

function asPolicyLevel(value: number): PolicyLevel {
  if (value <= 0) {
    return 0;
  }
  if (value >= 3) {
    return 3;
  }
  return value === 1 ? 1 : 2;
}

/** Multiplies `calc` by the show's importance multiplier. */
function multiplyByImportance(calc: Calc, inputs: ShowCostsInputs, tunables: EngineTunables): void {
  calc.multiply(
    `${inputs.importanceLabel} show`,
    calc.tunable(tunables, IMPORTANCE_MULTIPLIER_KEYS[inputs.importance]),
  );
}

/** Travel: Σ rate over the paid workers × importance × distance, to the cent. */
function travel(inputs: ShowCostsInputs, tunables: EngineTunables): Traced<number> {
  const coveredLevel = asPolicyLevel(tunables.get('finance.travel.coveredLevel'));
  const levelLabel = POLICY_LEVEL_LABELS[inputs.travelLevel];
  const lines: CostLine[] = [];
  let unpaid = 0;
  for (const worker of paidWorkers(inputs.workers)) {
    const level = travelLevelOf(worker, inputs.travelLevel, coveredLevel);
    const key = TRAVEL_RATE_KEYS[level];
    const amount = tunables.get(key);
    if (amount === 0) {
      unpaid += 1;
      continue;
    }
    lines.push({
      label: worker.travelCovered ? `${worker.name}: travel covered by contract` : worker.name,
      amount,
      rateKey: key,
      rateLabel: `${POLICY_LEVEL_LABELS[level]} travel per worker`,
    });
  }
  const calc = startCalc('Travel', 0, {
    unit: 'money',
    docRef: SHOW_COSTS_DOC_REF,
    startLabel: lines.length === 0 ? 'Nobody on the card is paid travel' : 'Travel per worker',
  });
  addLines(calc, lines, tunables, ['worker', 'workers']);
  if (unpaid > 0) {
    calc.note(
      `${plural(unpaid, 'worker pays', 'workers pay')} their own way: ${levelLabel} travel`,
    );
  }
  addExclusionNotes(calc, inputs.workers);
  if (inputs.estimated) {
    calc.note(ESTIMATED_CARD_NOTE);
  }
  multiplyByImportance(calc, inputs, tunables);
  switch (inputs.distance) {
    case 'home':
      calc.note('Show in the home region: no extra for distance');
      break;
    case 'domestic':
      calc.multiply(
        'Away from the home region',
        calc.tunable(tunables, 'finance.travel.domesticMultiplier'),
      );
      break;
    case 'abroad':
      calc.multiply(
        'In another country',
        calc.tunable(tunables, 'finance.travel.abroadMultiplier'),
      );
      break;
  }
  return calc.round('round', 'Rounded to the nearest cent').done();
}

/** Catering: the rate at the catering level × importance, to the cent. */
function catering(inputs: ShowCostsInputs, tunables: EngineTunables): Traced<number> {
  const label = POLICY_LEVEL_LABELS[inputs.cateringLevel];
  const calc = startCalc('Catering', 0, {
    unit: 'money',
    docRef: SHOW_COSTS_DOC_REF,
    startLabel: 'Start',
  });
  calc.add(
    `${label} catering per show`,
    calc.tunable(tunables, CATERING_RATE_KEYS[inputs.cateringLevel]),
  );
  multiplyByImportance(calc, inputs, tunables);
  return calc.round('round', 'Rounded to the nearest cent').done();
}

/** The three costs of one show, in cents (positive: what the show costs). */
export function showCosts(inputs: ShowCostsInputs, deps: { tunables: EngineTunables }): ShowCosts {
  return {
    appearanceFees: appearanceFees(inputs, deps.tunables),
    travel: travel(inputs, deps.tunables),
    catering: catering(inputs, deps.tunables),
  };
}
