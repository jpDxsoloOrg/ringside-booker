/**
 * The zod schema for a {@link TraceNode}, used wherever a trace comes back from outside the engine:
 * a loaded save, an imported file, the Web Worker boundary.
 *
 * The schema is built one level at a time, so it enforces the same limits as the builders: at most
 * {@link TRACE_MAX_DEPTH} levels (the root is level 1) and at most {@link TRACE_MAX_NODES} nodes in
 * the whole tree. A hand-edited save therefore cannot load an unbounded tree, and the check never
 * recurses deeper than the depth limit, however deep the input is.
 *
 * See docs/design/calculation-traces.md.
 */

import { z } from 'zod';
import { ENTITY_KIND_LIST } from '../ids';
import type { RollKind, RollRecord } from '../rng/rolls';
import { TUNABLE_UNITS } from '../tunables/define';
import { countTraceNodes, TRACE_MAX_DEPTH, TRACE_MAX_NODES } from './limits';
import type { ArithmeticKind, EntityRef, TraceNode, TraceUnit, TraceValue } from './types';

/** Every roll kind. `satisfies` makes a new kind fail to compile until it is listed here. */
const ROLL_KIND_NAMES = {
  chance: 'chance',
  oneIn: 'oneIn',
  int: 'int',
  float: 'float',
  pick: 'pick',
  weighted: 'weighted',
  normal: 'normal',
} as const satisfies Record<RollKind, RollKind>;
const ROLL_KINDS = Object.values(ROLL_KIND_NAMES);

const ARITHMETIC_KIND_NAMES = {
  add: 'add',
  subtract: 'subtract',
  multiply: 'multiply',
  divide: 'divide',
} as const satisfies Record<ArithmeticKind, ArithmeticKind>;
const ARITHMETIC_KINDS = Object.values(ARITHMETIC_KIND_NAMES);

const TRACE_UNITS: readonly TraceUnit[] = [...TUNABLE_UNITS, 'stars'];

/**
 * A number a trace can hold: finite (zod rejects NaN and infinities). A `-0` is read as `0`, the
 * way the builders write it, so a trace never depends on the sign of zero.
 */
export const traceNumberSchema = z
  .number({ error: 'must be a finite number' })
  .transform((value) => (value === 0 ? 0 : value));

export const traceValueSchema: z.ZodType<TraceValue> = z.union(
  [traceNumberSchema, z.boolean(), z.string(), z.null()],
  { error: 'must be a finite number, true/false, text or null' },
);

export const traceUnitSchema: z.ZodType<TraceUnit> = z.enum(TRACE_UNITS, {
  error: 'is not a trace unit',
});

const entityRefSchema: z.ZodType<EntityRef> = z.strictObject({
  kind: z.enum(ENTITY_KIND_LIST, { error: 'is not an entity kind' }),
  id: z.string().min(1, { error: 'must not be empty' }),
});

const rollRecordSchema: z.ZodType<RollRecord> = z.strictObject({
  stream: z.string().min(1, { error: 'must not be empty' }),
  kind: z.enum(ROLL_KINDS, { error: 'is not a roll kind' }),
  label: z.string(),
  odds: traceNumberSchema.exactOptional(),
  min: traceNumberSchema.exactOptional(),
  max: traceNumberSchema.exactOptional(),
  options: z.number().int().min(0).exactOptional(),
  result: z.union([traceNumberSchema, z.boolean(), z.string()]),
});

/**
 * Children of a node at `level`. Below the last allowed level a node may not have any children;
 * a formula node there keeps its (empty) array, as the size limits leave it.
 */
function childrenSchemaAt(level: number): z.ZodType<TraceNode[]> {
  if (level >= TRACE_MAX_DEPTH) {
    return z
      .array(z.unknown())
      .max(0, {
        error: `a trace may have at most ${String(TRACE_MAX_DEPTH)} levels, so a node at level ${String(TRACE_MAX_DEPTH)} cannot have children`,
      })
      .transform((): TraceNode[] => []);
  }
  return z
    .array(traceNodeSchemaAt(level + 1))
    .max(TRACE_MAX_NODES, { error: `a trace may hold at most ${String(TRACE_MAX_NODES)} nodes` });
}

/** The schema of one node sitting at `level` of a trace (the root is level 1). */
function traceNodeSchemaAt(level: number): z.ZodType<TraceNode> {
  const children = childrenSchemaAt(level);
  const base = {
    label: z.string(),
    unit: traceUnitSchema.exactOptional(),
    docRef: z.string().min(1, { error: 'must not be empty' }).exactOptional(),
    children: children.exactOptional(),
  };
  return z.discriminatedUnion(
    'kind',
    [
      z.strictObject({ ...base, kind: z.literal('formula'), value: traceValueSchema, children }),
      z.strictObject({
        ...base,
        kind: z.literal('input'),
        value: traceValueSchema,
        ref: entityRefSchema.exactOptional(),
      }),
      z.strictObject({
        ...base,
        kind: z.literal('constant'),
        value: traceNumberSchema,
        reason: z.string(),
      }),
      z.strictObject({
        ...base,
        kind: z.literal('tunable'),
        key: z.string().min(1, { error: 'must not be empty' }),
        value: z.union([traceNumberSchema, z.boolean(), z.string()]),
        defaultValue: z.union([traceNumberSchema, z.boolean(), z.string()]),
        overridden: z.boolean(),
      }),
      z.strictObject({
        ...base,
        kind: z.enum(ARITHMETIC_KINDS),
        value: traceNumberSchema,
        operand: traceNumberSchema,
        before: traceNumberSchema,
        after: traceNumberSchema,
        reason: z.string().exactOptional(),
      }),
      z.strictObject({
        ...base,
        kind: z.enum(['min', 'max']),
        value: traceNumberSchema,
        limit: traceNumberSchema,
        before: traceNumberSchema,
        after: traceNumberSchema,
        applied: z.boolean(),
      }),
      z.strictObject({
        ...base,
        kind: z.literal('clamp'),
        value: traceNumberSchema,
        min: traceNumberSchema,
        max: traceNumberSchema,
        before: traceNumberSchema,
        after: traceNumberSchema,
        applied: z.boolean(),
      }),
      z.strictObject({
        ...base,
        kind: z.literal('round'),
        value: traceNumberSchema,
        mode: z.enum(['round', 'floor', 'ceil']),
        before: traceNumberSchema,
        after: traceNumberSchema,
      }),
      z.strictObject({
        ...base,
        kind: z.literal('roll'),
        value: z.union([traceNumberSchema, z.boolean(), z.string()]),
        roll: rollRecordSchema,
      }),
      z.strictObject({
        ...base,
        kind: z.literal('branch'),
        value: z.boolean(),
        condition: z.string(),
        taken: z.boolean(),
      }),
      z.strictObject({
        ...base,
        kind: z.literal('decision'),
        value: z.union([z.string(), z.boolean()]),
        chosen: z.union([z.string(), z.boolean()]),
        reason: z.string(),
        considered: z.array(
          z.strictObject({
            option: z.union([z.string(), z.boolean()]),
            score: traceNumberSchema,
            reason: z.string().exactOptional(),
          }),
        ),
      }),
      z.strictObject({
        ...base,
        kind: z.literal('note'),
        value: traceNumberSchema.nullable(),
        hiddenSteps: z.number().int().min(1).exactOptional(),
      }),
    ],
    { error: 'is not a trace node of a known kind' },
  );
}

/**
 * Zod schema for a whole {@link TraceNode} tree: every node's fields by kind, at most
 * {@link TRACE_MAX_DEPTH} levels and at most {@link TRACE_MAX_NODES} nodes. Unknown kinds and
 * unknown fields are rejected.
 */
export const traceNodeSchema: z.ZodType<TraceNode> = traceNodeSchemaAt(1).superRefine(
  (node, ctx) => {
    const nodeCount = countTraceNodes(node);
    if (nodeCount > TRACE_MAX_NODES) {
      ctx.addIssue({
        code: 'custom',
        message: `a trace may hold at most ${String(TRACE_MAX_NODES)} nodes, this one holds ${String(nodeCount)}`,
      });
    }
  },
);
