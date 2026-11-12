/**
 * Prints a stored calculation trace as an indented tree for `--trace kind:id`.
 *
 * Each node is one line, `label: value unit`, with what the step did in brackets, and its child
 * steps indented under it. Rolls read as `rolled 1 in 0..1 (stream condition.recovery)`. An older
 * result whose full trace has been summarised prints its value and its largest contributors.
 */

import {
  isFullTrace,
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

/** A number with at most four decimals and no trailing zeros. */
function formatNumber(value: number): string {
  return String(Math.round(value * 10_000) / 10_000);
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

function withUnit(value: TraceValue, unit: TraceUnit | undefined): string {
  const text = formatValue(value);
  return unit === undefined || SILENT_UNITS.has(unit) ? text : `${text} ${unit}`;
}

function formatPercent(probability: number): string {
  return `${formatNumber(probability * 100)}%`;
}

/** A roll in words: `rolled 1 in 0..1 (stream condition.recovery)`. */
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
function limitDetail(applied: boolean, before: number, limit: string): string {
  return applied ? ` (was ${formatNumber(before)}, ${limit})` : '';
}

/**
 * The line for one node, without indentation. `inheritedUnit` is the unit of the calculation the
 * node belongs to; steps of a formula usually leave their own unit out.
 */
export function describeNode(node: TraceNode, inheritedUnit?: TraceUnit): string {
  const head = `${node.label}: ${withUnit(node.value, node.unit ?? inheritedUnit)}`;
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
      return `${head} (${formatNumber(node.before)} ${ARITHMETIC_SYMBOLS[node.kind]} ${formatNumber(node.operand)}${reason})`;
    }
    case 'min':
      return `${head}${limitDetail(node.applied, node.before, `at most ${formatNumber(node.limit)}`)}`;
    case 'max':
      return `${head}${limitDetail(node.applied, node.before, `at least ${formatNumber(node.limit)}`)}`;
    case 'clamp':
      return `${head}${limitDetail(node.applied, node.before, `kept within ${formatNumber(node.min)}..${formatNumber(node.max)}`)}`;
    case 'round':
      return `${head} (${node.mode} of ${formatNumber(node.before)})`;
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

/** The node and its children as indented lines. */
export function formatTraceNode(node: TraceNode, depth = 0, inheritedUnit?: TraceUnit): string[] {
  const indent = INDENT.repeat(depth);
  const unit = node.unit ?? inheritedUnit;
  const lines = [`${indent}${describeNode(node, inheritedUnit)}`];
  if (node.kind === 'decision') {
    for (const option of node.considered) {
      const reason = option.reason === undefined ? '' : ` (${option.reason})`;
      lines.push(
        `${indent}${INDENT}- ${formatValue(option.option)}: score ${formatNumber(option.score)}${reason}`,
      );
    }
  }
  for (const child of node.children ?? []) {
    lines.push(...formatTraceNode(child, depth + 1, unit));
  }
  return lines;
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
      return `${INDENT}${INDENT}${contributor.label}: ${sign}${formatNumber(contributor.effect)}`;
    }),
  ];
  return `${lines.join('\n')}\n`;
}
