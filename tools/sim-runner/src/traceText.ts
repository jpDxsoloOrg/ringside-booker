/**
 * Prints a stored calculation trace as an indented tree for `--trace kind:id`.
 *
 * Each node is one line, `label: value unit`, with what the step did in brackets, and its child
 * steps indented under it. Every step reads in its calculation's unit (see `withStepUnits`), and
 * money reads as dollars and cents (`-$333930.19`), never as raw cents. Rolls read as
 * `rolled 1 in 0..1 (stream health.recovery)`. An older result whose full trace has been
 * summarised prints its value and its largest contributors.
 */

import {
  isFullTrace,
  withStepUnits,
  type RollRecord,
  type StoredTraceEntry,
  type TraceNode,
  type TraceRef,
  type TraceUnit,
  type TraceValue,
} from '@ringside/engine';

const INDENT = '  ';

/** Units that add nothing after the value: a switch reads as yes/no, a choice as its text. */
const SILENT_UNITS: ReadonlySet<TraceUnit> = new Set<TraceUnit>(['flag', 'choice']);

const CENTS_PER_DOLLAR = 100;

/** A number with at most four decimals and no trailing zeros. */
function formatNumber(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
}

/** Cents as dollars with two decimals and no grouping, so the text stays easy to grep. */
function formatDollars(amountInCents: number): string {
  const sign = amountInCents < 0 ? '-' : '';
  const dollars = Math.abs(Math.round(amountInCents)) / CENTS_PER_DOLLAR;
  return `${sign}$${dollars.toFixed(2)}`;
}

function isMoney(unit: TraceUnit | undefined): boolean {
  return unit === 'money' || unit === 'money/month';
}

/** An amount in a step's unit, without the unit word: `-$333930.19` for money, `12.5` otherwise. */
function formatAmount(value: number, unit: TraceUnit | undefined): string {
  return isMoney(unit) ? formatDollars(value) : formatNumber(value);
}

function formatValue(value: TraceValue): string {
  if (typeof value === 'number') {
    return formatNumber(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'yes' : 'no';
  }
  return value ?? 'none';
}

/** A value in its unit: `$1250.50`, `$800.00/month`, `37.6 points`, `yes`. */
function withUnit(value: TraceValue, unit: TraceUnit | undefined): string {
  if (typeof value === 'number' && isMoney(unit)) {
    return unit === 'money/month' ? `${formatDollars(value)}/month` : formatDollars(value);
  }
  const text = formatValue(value);
  return unit === undefined || SILENT_UNITS.has(unit) ? text : `${text} ${unit}`;
}

function formatPercent(probability: number): string {
  return `${formatNumber(probability * 100)}%`;
}

/** A roll in words: `rolled 1 in 0..1 (stream health.recovery)`. */
export function describeRoll(roll: RollRecord): string {
  const result = typeof roll.result === 'number' ? formatNumber(roll.result) : String(roll.result);
  let range = '';
  switch (roll.kind) {
    case 'int':
    case 'float':
    case 'normal':
      if (roll.min !== undefined && roll.max !== undefined) {
        range = ` in ${formatNumber(roll.min)}..${formatNumber(roll.max)}`;
      }
      break;
    case 'chance':
    case 'oneIn':
      if (roll.odds !== undefined) {
        range = ` at ${formatPercent(roll.odds)} odds`;
      }
      break;
    case 'pick':
    case 'weighted':
      if (roll.options !== undefined) {
        range = ` from ${String(roll.options)} options`;
      }
      break;
  }
  return `rolled ${result}${range} (stream ${roll.stream})`;
}

const ARITHMETIC_SYMBOLS = {
  add: '+',
  subtract: '-',
  multiply: '×',
  divide: '÷',
  power: '^',
} as const;

/** What a limit did, when it changed the value: `(was 104, kept within 0..100)`. */
function limitDetail(applied: boolean, before: string, limit: string): string {
  return applied ? ` (was ${before}, ${limit})` : '';
}

/**
 * The line for one node, without indentation. Give it nodes that have been through
 * `withStepUnits` (as {@link formatTraceNode} does), so each step carries its calculation's unit.
 */
export function describeNode(node: TraceNode): string {
  const unit = node.unit;
  const head = `${node.label}: ${withUnit(node.value, unit)}`;
  switch (node.kind) {
    case 'formula':
    case 'input':
      return head;
    case 'constant':
      return `${head} (fixed: ${node.reason})`;
    case 'tunable': {
      const overridden = node.overridden ? ', overridden' : '';
      return `${head} (tunable ${node.key}, default ${formatValue(node.defaultValue)}${overridden})`;
    }
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'power': {
      const reason = node.reason === undefined ? '' : `: ${node.reason}`;
      // An amount added or taken away is in the step's unit; a factor or exponent is a plain
      // number, unless this step turns the value into the calculation's unit (a price per head).
      const operand =
        node.kind === 'add' || node.kind === 'subtract'
          ? formatAmount(node.operand, unit)
          : formatAmount(node.operand, node.operandUnit);
      const before = formatAmount(node.before, node.beforeUnit ?? unit);
      return `${head} (${before} ${ARITHMETIC_SYMBOLS[node.kind]} ${operand}${reason})`;
    }
    case 'min':
      return `${head}${limitDetail(node.applied, formatAmount(node.before, unit), `at most ${formatAmount(node.limit, unit)}`)}`;
    case 'max':
      return `${head}${limitDetail(node.applied, formatAmount(node.before, unit), `at least ${formatAmount(node.limit, unit)}`)}`;
    case 'clamp':
      return `${head}${limitDetail(node.applied, formatAmount(node.before, unit), `kept within ${formatAmount(node.min, unit)}..${formatAmount(node.max, unit)}`)}`;
    case 'round':
      return `${head} (${node.mode} of ${formatAmount(node.before, unit)})`;
    case 'roll':
      return `${node.label}: ${describeRoll(node.roll)}`;
    case 'branch':
      return `${node.label}: ${node.taken ? 'taken' : 'not taken'} (${node.condition})`;
    case 'decision':
      return `${node.label}: ${formatValue(node.chosen)} (${node.reason})`;
    case 'note':
      return node.value === null ? node.label : head;
  }
}

function formatWithUnits(node: TraceNode, depth: number): string[] {
  const indent = INDENT.repeat(depth);
  const lines = [`${indent}${describeNode(node)}`];
  if (node.kind === 'decision') {
    for (const option of node.considered) {
      const reason = option.reason === undefined ? '' : ` (${option.reason})`;
      lines.push(
        `${indent}${INDENT}- ${formatValue(option.option)}: score ${formatNumber(option.score)}${reason}`,
      );
    }
  }
  for (const child of node.children ?? []) {
    lines.push(...formatWithUnits(child, depth + 1));
  }
  return lines;
}

/** The node and its children as indented lines, every step in its calculation's unit. */
export function formatTraceNode(node: TraceNode, depth = 0): string[] {
  return formatWithUnits(withStepUnits(node), depth);
}

/** The whole `--trace` section: a heading and the tree, or a line saying nothing is stored. */
export function formatTraceEntry(ref: TraceRef, entry: StoredTraceEntry | null): string {
  const name = `${ref.kind}:${ref.id}`;
  if (entry === null) {
    return `Trace ${name}: nothing is stored under this ref\n`;
  }
  if (isFullTrace(entry)) {
    return `${[`Trace ${name} (recorded ${entry.date})`, ...formatTraceNode(entry.trace, 1)].join('\n')}\n`;
  }
  const lines = [
    `Trace ${name} (recorded ${entry.date}, summary only: the full trace is no longer kept)`,
    `${INDENT}${entry.label}: ${withUnit(entry.value, entry.unit)}`,
    ...entry.topContributors.map((contributor) => {
      const sign = contributor.effect > 0 ? '+' : '';
      return `${INDENT}${INDENT}${contributor.label}: ${sign}${formatAmount(contributor.effect, entry.unit)}`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}
