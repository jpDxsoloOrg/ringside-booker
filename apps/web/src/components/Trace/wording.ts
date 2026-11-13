/**
 * The words for every trace row. The panel's rows and the copy-as-text export both read them from
 * here, so a bug report says exactly what the player saw.
 *
 * Rows read as sentences ("Capped 112 → 100 (maximum)"), never as formulas: the panel is for
 * players, not developers.
 */
import type {
  ArithmeticNode,
  BranchNode,
  ClampNode,
  ConstantNode,
  DecisionNode,
  FormulaNode,
  InputNode,
  LimitNode,
  NoteNode,
  RollNode,
  RoundMode,
  RoundNode,
  TraceNode,
  TunableNode,
} from '@ringside/engine';
import {
  formatTraceChange,
  formatTraceDelta,
  formatTraceNumber,
  formatTraceValue,
} from './formatTraceValue';

/** Which way a step moved the running value. Shown with a sign or word too, never colour alone. */
export type TraceTone = 'positive' | 'negative' | 'neutral';

/** One row's words, in reading order. */
export interface TraceLine {
  /** The sentence itself. */
  readonly text: string;
  /** A short chip after the sentence, such as "Custom setting". */
  readonly badge?: string;
  /** Muted detail after the sentence: before → after, a reason, a random stream. */
  readonly details: readonly string[];
  readonly tone: TraceTone;
  /**
   * True for checks that changed nothing (a limit that was not reached, a branch not taken).
   * The panel hides them until the player asks for them.
   */
  readonly hiddenByDefault: boolean;
  /** Lines listed under the row, such as the options a decision weighed. */
  readonly items: readonly string[];
}

/** Separator between a row's sentence, badge and details in plain text. */
export const TEXT_SEPARATOR = ' · ';

function line(text: string, extra: Partial<TraceLine> = {}): TraceLine {
  return {
    text,
    details: [],
    tone: 'neutral',
    hiddenByDefault: false,
    items: [],
    ...extra,
  };
}

/** A row as one line of plain text: the sentence, then its badge and details. */
export function traceLineText(traceLine: TraceLine): string {
  const parts = [traceLine.text];
  if (traceLine.badge !== undefined) parts.push(traceLine.badge);
  parts.push(...traceLine.details);
  return parts.join(TEXT_SEPARATOR);
}

function toneOf(before: number, after: number): TraceTone {
  if (after > before) return 'positive';
  if (after < before) return 'negative';
  return 'neutral';
}

function beforeAfter(node: { readonly before: number; readonly after: number } & TraceNode) {
  return formatTraceChange(node.before, node.after, node.unit);
}

/** An arithmetic step's change; a step that changes the unit shows `before` in its own unit. */
function arithmeticBeforeAfter(node: ArithmeticNode): string {
  if (node.beforeUnit === undefined) return beforeAfter(node);
  const before = formatTraceNumber(node.before, node.beforeUnit);
  return `${before} → ${formatTraceNumber(node.after, node.unit)}`;
}

export function formulaLine(node: FormulaNode): TraceLine {
  return line(`${node.label}: ${formatTraceValue(node.value, node.unit)}`);
}

export function inputLine(node: InputNode): TraceLine {
  return line(`${node.label}: ${formatTraceValue(node.value, node.unit)}`);
}

export function constantLine(node: ConstantNode): TraceLine {
  return line(`${node.label}: ${formatTraceNumber(node.value, node.unit)}`, {
    details: [`Fixed: ${node.reason}`],
  });
}

/** A setting's value: a choice setting's option in words ("Standard", not `standard`). */
function tunableValueText(value: TunableNode['value'], node: TunableNode): string {
  return typeof value === 'string' ? choiceText(value) : formatTraceValue(value, node.unit);
}

/**
 * A setting's row ends with its key, the name it goes by in the tunables list and in a balance
 * profile, so a player who wants to change the number knows what to look for.
 */
export function tunableLine(node: TunableNode): TraceLine {
  const text = `${node.label}: ${tunableValueText(node.value, node)}`;
  if (node.overridden) {
    return line(text, {
      badge: 'Custom setting',
      details: [`default ${tunableValueText(node.defaultValue, node)}`, node.key],
    });
  }
  return line(text, { details: ['Game setting', node.key] });
}

/**
 * Multiplying and dividing factors and exponents are plain numbers, whatever the running value's
 * unit, except on the step that turns the value into its calculation's unit, whose factor can
 * name a unit of its own (`×$15 Spent per fan`).
 */
function factor(operand: number, operandUnit?: ArithmeticNode['operandUnit']): string {
  return formatTraceNumber(operand, operandUnit ?? 'ratio');
}

function arithmeticSentence(node: ArithmeticNode): string {
  switch (node.kind) {
    case 'add':
      return `${formatTraceDelta(node.operand, node.unit)} ${node.label}`;
    case 'subtract':
      return `${formatTraceDelta(-node.operand, node.unit)} ${node.label}`;
    case 'multiply':
      return `×${factor(node.operand, node.operandUnit)} ${node.label}`;
    case 'divide':
      return `÷${factor(node.operand, node.operandUnit)} ${node.label}`;
    case 'power':
      return `raised to the power ${factor(node.operand)} (${node.label})`;
  }
}

export function arithmeticLine(node: ArithmeticNode): TraceLine {
  const details = [arithmeticBeforeAfter(node)];
  if (node.reason !== undefined) details.push(node.reason);
  // A step that changes the unit compares two different things, so it is neither up nor down.
  const tone = node.beforeUnit === undefined ? toneOf(node.before, node.after) : 'neutral';
  return line(arithmeticSentence(node), { details, tone });
}

function appliedLimitSentence(node: LimitNode | ClampNode): string {
  const change = beforeAfter(node);
  return node.after < node.before ? `Capped ${change} (maximum)` : `Raised ${change} (minimum)`;
}

function unappliedLimitSentence(node: LimitNode | ClampNode): string {
  const checked = formatTraceNumber(node.before, node.unit);
  switch (node.kind) {
    case 'clamp':
      return `Checked ${checked} against ${formatTraceNumber(node.min, node.unit)}–${formatTraceNumber(node.max, node.unit)}: already in range`;
    case 'min':
      return `Checked ${checked} against a maximum of ${formatTraceNumber(node.limit, node.unit)}: not reached`;
    case 'max':
      return `Checked ${checked} against a minimum of ${formatTraceNumber(node.limit, node.unit)}: not reached`;
  }
}

export function limitLine(node: LimitNode | ClampNode): TraceLine {
  if (node.applied) {
    return line(appliedLimitSentence(node), {
      details: [node.label],
      tone: toneOf(node.before, node.after),
    });
  }
  return line(unappliedLimitSentence(node), { details: [node.label], hiddenByDefault: true });
}

/** The engine's default labels for each rounding mode, which double as the sentence's verb. */
export const ROUND_WORDS: Readonly<Record<RoundMode, string>> = {
  round: 'Rounded',
  floor: 'Rounded down',
  ceil: 'Rounded up',
};

export function roundLine(node: RoundNode): TraceLine {
  const word = ROUND_WORDS[node.mode];
  return line(`${word} ${beforeAfter(node)}`, {
    details: node.label === word ? [] : [node.label],
    tone: toneOf(node.before, node.after),
  });
}

function outcomeWord(result: number | boolean | string): string {
  if (typeof result === 'boolean') return result ? 'yes' : 'no';
  return formatTraceValue(result);
}

/** A range end as it was rolled: plain numbers, since a roll's range has no unit of its own. */
function rangeEnd(value: number | undefined): string {
  return value === undefined ? '?' : formatTraceNumber(value);
}

/** `0–100`, or `−3 to 3` when a minus sign would sit next to the dash. */
function rangeText(min: number | undefined, max: number | undefined): string {
  const separator = (min ?? 0) < 0 || (max ?? 0) < 0 ? ' to ' : '–';
  return `${rangeEnd(min)}${separator}${rangeEnd(max)}`;
}

function rollSentence(node: RollNode): string {
  const { roll } = node;
  const result = outcomeWord(roll.result);
  const odds = roll.odds === undefined ? '?' : formatTraceNumber(roll.odds, 'probability');
  const options = roll.options === undefined ? '?' : formatTraceNumber(roll.options);
  switch (roll.kind) {
    case 'int':
      return `rolled ${result} on ${rangeText(roll.min, roll.max)} (both ends possible)`;
    case 'float':
      return `rolled ${result} on ${rangeText(roll.min, roll.max)} (${rangeEnd(roll.min)} possible, ${rangeEnd(roll.max)} not)`;
    case 'chance':
      return `${odds} chance, came up ${result}`;
    case 'oneIn':
      return `1 in ${options} chance, came up ${result}`;
    case 'normal':
      return `rolled ${result} on a bell curve`;
    case 'pick':
      return `picked ${result} from ${options} options (1 in ${options} each)`;
    case 'weighted':
      return `picked ${result} from ${options} options (${odds} chance)`;
  }
}

export function rollLine(node: RollNode): TraceLine {
  return line(`${node.label}: ${rollSentence(node)}`, {
    details: [`Random stream ${node.roll.stream}`],
  });
}

export function branchLine(node: BranchNode): TraceLine {
  const details = node.label === node.condition ? [] : [node.label];
  if (node.taken) return line(`Because ${node.condition}`, { details });
  return line(`Did not apply: ${node.condition}`, { details, hiddenByDefault: true });
}

/** An option the engine names with a code: one word, or several run together in camelCase. */
const CHOICE_CODE_PATTERN = /^[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)*$/;

/**
 * A decision's option as the player reads it. The engine names options with the same codes the
 * data uses (`mainEvent`, `lightHeavyweight`); they read as words here ("Main event", "Light
 * heavyweight"). Text that is not a code (a name, a sentence) is left as it is.
 */
export function choiceText(option: string | boolean): string {
  if (typeof option === 'boolean') return option ? 'yes' : 'no';
  if (!CHOICE_CODE_PATTERN.test(option)) return option;
  const words = option.replace(/[A-Z]/g, (letter) => ` ${letter.toLowerCase()}`);
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/** A trace's own value as the headline shows it: a decision's choice in words, a number in its unit. */
export function traceValueText(node: TraceNode): string {
  if (node.kind === 'decision') return choiceText(node.chosen);
  return formatTraceValue(node.value, node.unit);
}

export function decisionLine(node: DecisionNode): TraceLine {
  const chosen = node.considered.filter((option) => option.option === node.chosen);
  const others = node.considered.filter((option) => option.option !== node.chosen);
  const describe = (prefix: string, option: DecisionNode['considered'][number]): string => {
    const base = `${prefix}: ${choiceText(option.option)}, score ${formatTraceNumber(option.score)}`;
    return option.reason === undefined ? base : `${base}${TEXT_SEPARATOR}${option.reason}`;
  };
  return line(`${node.label}: ${choiceText(node.chosen)}`, {
    details: [node.reason],
    items: [
      ...chosen.map((option) => describe('Chosen', option)),
      ...others.map((option) => describe('Also considered', option)),
    ],
  });
}

export function noteLine(node: NoteNode): TraceLine {
  if (node.value === null) return line(node.label);
  return line(node.label, {
    details: [`running value ${formatTraceNumber(node.value, node.unit)}`],
  });
}

/**
 * The words for one node. The switch covers every kind the engine defines; a new kind fails the
 * typecheck here until it has its wording.
 */
export function describeTraceNode(node: TraceNode): TraceLine {
  switch (node.kind) {
    case 'formula':
      return formulaLine(node);
    case 'input':
      return inputLine(node);
    case 'constant':
      return constantLine(node);
    case 'tunable':
      return tunableLine(node);
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'power':
      return arithmeticLine(node);
    case 'min':
    case 'max':
    case 'clamp':
      return limitLine(node);
    case 'round':
      return roundLine(node);
    case 'roll':
      return rollLine(node);
    case 'branch':
      return branchLine(node);
    case 'decision':
      return decisionLine(node);
    case 'note':
      return noteLine(node);
    default:
      return unknownKind(node);
  }
}

function unknownKind(node: never): never {
  throw new Error(`No wording for trace node ${JSON.stringify(node)}`);
}
