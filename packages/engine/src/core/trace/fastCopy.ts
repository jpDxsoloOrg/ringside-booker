/**
 * A fast path for the trace store's record check (POL4-09).
 *
 * Every recorded trace is checked to be plain JSON (`assertJsonValue`) and parsed with the schema a
 * load uses (`traceNodeSchema`), and the parsed copy is what gets stored. On a year's skip that
 * check was the largest single cost of show night. {@link copyValidTraceContent} does both in one
 * walk with no error paths: it returns exactly the copy the schema parse would (same fields, same
 * key order, `-0` read as `0`), or null at the first thing it is not sure of. The store then falls
 * back to the full check, which throws the same error as before. So it can only ever accept what
 * the full check accepts; anything unusual (a class instance, a symbol key, an unknown field, a
 * number out of range) simply takes the slow path.
 *
 * `fastCopy.test.ts` holds it to the schema on real traces and on broken ones.
 */

import { ENTITY_KIND_LIST } from '../ids';
import { TUNABLE_UNITS } from '../tunables/define';
import { TRACE_MAX_DEPTH, TRACE_MAX_NODES } from './limits';
import type { TraceNode, TraceValue } from './types';

/** A field's check: the copied value, or {@link INVALID}. */
type FieldCheck = (value: unknown) => unknown;

/** What a field check returns for a value the fast path will not vouch for. */
const INVALID: unique symbol = Symbol('invalid');

/** One field of a node kind, in the order the schema's parse writes it. */
interface FieldSpec {
  readonly key: string;
  readonly optional: boolean;
  readonly check: FieldCheck | 'children';
}

const UNITS: ReadonlySet<unknown> = new Set(TUNABLE_UNITS);
const ENTITY_KINDS: ReadonlySet<unknown> = new Set(ENTITY_KIND_LIST);
const ROLL_KINDS: ReadonlySet<unknown> = new Set([
  'chance',
  'oneIn',
  'int',
  'float',
  'pick',
  'weighted',
  'normal',
]);
const ROUND_MODES: ReadonlySet<unknown> = new Set(['round', 'floor', 'ceil']);

function isPlainObject(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

const finiteNumber: FieldCheck = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? (value === 0 ? 0 : value) : INVALID;
const text: FieldCheck = (value) => (typeof value === 'string' ? value : INVALID);
const nonEmptyText: FieldCheck = (value) =>
  typeof value === 'string' && value.length > 0 ? value : INVALID;
const flag: FieldCheck = (value) => (typeof value === 'boolean' ? value : INVALID);
const traceValue: FieldCheck = (value) =>
  value === null || typeof value === 'boolean' || typeof value === 'string'
    ? value
    : finiteNumber(value);
const numberFlagOrText: FieldCheck = (value) =>
  typeof value === 'boolean' || typeof value === 'string' ? value : finiteNumber(value);
const textOrFlag: FieldCheck = (value) =>
  typeof value === 'boolean' || typeof value === 'string' ? value : INVALID;
const numberOrNull: FieldCheck = (value) => (value === null ? null : finiteNumber(value));
const oneOf =
  (allowed: ReadonlySet<unknown>): FieldCheck =>
  (value) =>
    allowed.has(value) ? value : INVALID;
/** Whole numbers the schema's `.int()` takes for certain: safe integers, at least `min`. */
const wholeAtLeast =
  (min: number): FieldCheck =>
  (value) =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= min
      ? value === 0
        ? 0
        : value
      : INVALID;

/** Copies a strict object: every own key must be one of `fields`, in the schema's order. */
function copyStrict(
  value: unknown,
  fields: readonly FieldSpec[],
  children: ((value: unknown) => unknown) | null,
): Record<string, unknown> | typeof INVALID {
  if (!isPlainObject(value)) {
    return INVALID;
  }
  const ownKeys = Reflect.ownKeys(value);
  let matched = 0;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.hasOwn(value, field.key)) {
      if (!field.optional) {
        return INVALID;
      }
      continue;
    }
    matched += 1;
    const raw = value[field.key];
    if (raw === undefined) {
      return INVALID;
    }
    const copied =
      field.check === 'children' ? (children === null ? INVALID : children(raw)) : field.check(raw);
    if (copied === INVALID) {
      return INVALID;
    }
    out[field.key] = copied;
  }
  // Any own key the kind does not list (a symbol key included) is the schema's or the JSON
  // check's to report.
  return matched === ownKeys.length ? out : INVALID;
}

const entityRef: FieldCheck = (value) =>
  copyStrict(
    value,
    [
      { key: 'kind', optional: false, check: oneOf(ENTITY_KINDS) },
      { key: 'id', optional: false, check: nonEmptyText },
    ],
    null,
  );

const rollRecord: FieldCheck = (value) =>
  copyStrict(
    value,
    [
      { key: 'stream', optional: false, check: nonEmptyText },
      { key: 'kind', optional: false, check: oneOf(ROLL_KINDS) },
      { key: 'label', optional: false, check: text },
      { key: 'odds', optional: true, check: finiteNumber },
      { key: 'min', optional: true, check: finiteNumber },
      { key: 'max', optional: true, check: finiteNumber },
      { key: 'options', optional: true, check: wholeAtLeast(0) },
      { key: 'result', optional: false, check: numberFlagOrText },
    ],
    null,
  );

const consideredOption: FieldCheck = (value) =>
  copyStrict(
    value,
    [
      { key: 'option', optional: false, check: textOrFlag },
      { key: 'score', optional: false, check: finiteNumber },
      { key: 'reason', optional: true, check: text },
    ],
    null,
  );

const considered: FieldCheck = (value) => {
  if (!isPlainArray(value)) {
    return INVALID;
  }
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) {
      return INVALID;
    }
    const copied = consideredOption(value[index]);
    if (copied === INVALID) {
      return INVALID;
    }
    out.push(copied);
  }
  return out;
};

/**
 * The fields of each node kind after the shared ones, in the order the schema's parse writes them.
 * The shared ones come first: label, unit, docRef, children (a formula's children are required and
 * keep the shared position).
 */
function kindFields(kind: unknown): readonly FieldSpec[] | null {
  const field = (key: string, check: FieldCheck, optional = false): FieldSpec => ({
    key,
    optional,
    check,
  });
  switch (kind) {
    case 'formula':
      return [field('kind', text), field('value', traceValue)];
    case 'input':
      return [field('kind', text), field('value', traceValue), field('ref', entityRef, true)];
    case 'constant':
      return [field('kind', text), field('value', finiteNumber), field('reason', text)];
    case 'tunable':
      return [
        field('kind', text),
        field('key', nonEmptyText),
        field('value', numberFlagOrText),
        field('defaultValue', numberFlagOrText),
        field('overridden', flag),
      ];
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'power':
      return [
        field('kind', text),
        field('value', finiteNumber),
        field('operand', finiteNumber),
        field('before', finiteNumber),
        field('after', finiteNumber),
        field('reason', text, true),
      ];
    case 'min':
    case 'max':
      return [
        field('kind', text),
        field('value', finiteNumber),
        field('limit', finiteNumber),
        field('before', finiteNumber),
        field('after', finiteNumber),
        field('applied', flag),
      ];
    case 'clamp':
      return [
        field('kind', text),
        field('value', finiteNumber),
        field('min', finiteNumber),
        field('max', finiteNumber),
        field('before', finiteNumber),
        field('after', finiteNumber),
        field('applied', flag),
      ];
    case 'round':
      return [
        field('kind', text),
        field('value', finiteNumber),
        field('mode', oneOf(ROUND_MODES)),
        field('before', finiteNumber),
        field('after', finiteNumber),
      ];
    case 'roll':
      return [field('kind', text), field('value', numberFlagOrText), field('roll', rollRecord)];
    case 'branch':
      return [
        field('kind', text),
        field('value', flag),
        field('condition', text),
        field('taken', flag),
      ];
    case 'decision':
      return [
        field('kind', text),
        field('value', textOrFlag),
        field('chosen', textOrFlag),
        field('reason', text),
        field('considered', considered),
      ];
    case 'note':
      return [
        field('kind', text),
        field('value', numberOrNull),
        field('hiddenSteps', wholeAtLeast(1), true),
      ];
    default:
      return null;
  }
}

const KIND_FIELDS = new Map<unknown, readonly FieldSpec[]>();
for (const kind of [
  'formula',
  'input',
  'constant',
  'tunable',
  'add',
  'subtract',
  'multiply',
  'divide',
  'power',
  'min',
  'max',
  'clamp',
  'round',
  'roll',
  'branch',
  'decision',
  'note',
]) {
  const own = kindFields(kind);
  if (own !== null) {
    KIND_FIELDS.set(kind, [
      { key: 'label', optional: false, check: text },
      { key: 'unit', optional: true, check: oneOf(UNITS) },
      { key: 'docRef', optional: true, check: nonEmptyText },
      { key: 'children', optional: kind !== 'formula', check: 'children' },
      ...own,
    ]);
  }
}

/** Counts nodes as they are copied, so the whole-tree limit is checked in the same walk. */
interface Counter {
  nodes: number;
}

function copyNode(value: unknown, level: number, counter: Counter): unknown {
  counter.nodes += 1;
  if (counter.nodes > TRACE_MAX_NODES || !isPlainObject(value)) {
    return INVALID;
  }
  const fields = KIND_FIELDS.get(value['kind']);
  if (fields === undefined) {
    return INVALID;
  }
  return copyStrict(value, fields, (children) => copyChildren(children, level, counter));
}

function copyChildren(value: unknown, level: number, counter: Counter): unknown {
  if (!isPlainArray(value)) {
    return INVALID;
  }
  if (level >= TRACE_MAX_DEPTH) {
    // The schema takes only an empty list at the last level.
    return value.length === 0 ? [] : INVALID;
  }
  if (value.length > TRACE_MAX_NODES) {
    return INVALID;
  }
  const out: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    if (!(index in value)) {
      return INVALID;
    }
    const copied = copyNode(value[index], level + 1, counter);
    if (copied === INVALID) {
      return INVALID;
    }
    out.push(copied);
  }
  return out;
}

/**
 * The checked copy of a recorded trace and its value, exactly as `assertJsonValue` plus the store's
 * schema parse would give it, or null when the fast path is not sure (the caller then runs the
 * full check). The trace must already be fitted into the size limits.
 */
export function copyValidTraceContent(
  trace: unknown,
  value: unknown,
): { readonly trace: TraceNode; readonly value: TraceValue } | null {
  const copiedValue = traceValue(value);
  if (copiedValue === INVALID) {
    return null;
  }
  const copiedTrace = copyNode(trace, 1, { nodes: 0 });
  if (copiedTrace === INVALID) {
    return null;
  }
  return {
    // The walk checked every field against the schema; the casts name what it built.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    trace: copiedTrace as TraceNode,
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    value: copiedValue as TraceValue,
  };
}
