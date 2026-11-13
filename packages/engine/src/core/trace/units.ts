/**
 * The unit every step of a trace is read in.
 *
 * A calculation records its unit once, on the formula (`startCalc(..., { unit: 'money' })`), and
 * its steps leave it out so stored traces stay small. Anything that shows a step on its own (the
 * Why? panel rows, the sim-runner's `--trace`) needs that unit on the step, or a money step reads
 * as raw cents. {@link withStepUnits} hands every step its unit at read time, by these rules:
 *
 * - the steps of a formula are in the formula's unit;
 * - except while the running value is still in its starting value's own unit (a crowd `count` at
 *   the start of a `money` formula): steps until the first multiply or divide stay in that unit,
 *   and that multiply or divide is the step that changes it. It gets `beforeUnit` (the unit it
 *   started from) and, when its factor names a unit of its own, `operandUnit` (`×$15 Spent per
 *   fan`, not `×1,500`);
 * - an amount added, subtracted or used as a floor or ceiling is in the same unit as the value it
 *   changes, so its own trace inherits that unit;
 * - a factor (multiply, divide, power) is a plain number whatever the running value measures, and
 *   the inside of an input, decision, roll or branch measures something else, so nothing is passed
 *   down there;
 * - a node that names its own unit keeps it, and passes that unit on instead.
 */

import type { ArithmeticNode, FormulaNode, TraceNode, TraceUnit } from './types';

/** Kinds whose children are in the same unit as the node itself. */
const SAME_UNIT_PARENTS: ReadonlySet<TraceNode['kind']> = new Set<TraceNode['kind']>([
  'add',
  'subtract',
  'min',
  'max',
]);

/**
 * Kinds that measure a number and take the unit they sit in. Tunables carry their definition's
 * unit; rolls, branches and decisions are not in a calculation's unit.
 */
const UNIT_TAKERS: ReadonlySet<TraceNode['kind']> = new Set<TraceNode['kind']>([
  'formula',
  'input',
  'constant',
  'add',
  'subtract',
  'multiply',
  'divide',
  'power',
  'min',
  'max',
  'clamp',
  'round',
  'note',
]);

/** Factor units: a step multiplied by one of these is still a plain factor. */
const FACTOR_UNITS: ReadonlySet<TraceUnit> = new Set<TraceUnit>(['ratio', 'multiplier']);

/** Whether `node` is a step that can change the running value's unit. */
function isScalingStep(node: TraceNode): node is ArithmeticNode {
  return node.kind === 'multiply' || node.kind === 'divide';
}

/** The unit the factor of a scaling step names, when it is not a plain factor. */
function operandUnitOf(step: ArithmeticNode): TraceUnit | undefined {
  // The traced amount is recorded last, after any setting reads attached to the step.
  const operand = step.children?.[step.children.length - 1];
  const unit = operand?.unit;
  return unit === undefined || FACTOR_UNITS.has(unit) ? undefined : unit;
}

/** Fills in `unit` when the node leaves it out and can take one. */
function withOwnUnit(node: TraceNode, unit: TraceUnit | undefined): TraceNode {
  if (node.unit !== undefined || unit === undefined || !UNIT_TAKERS.has(node.kind)) return node;
  return { ...node, unit };
}

/** The node with its children read in `childUnit`, or the node itself when nothing changes. */
function withChildUnits(node: TraceNode, childUnit: TraceUnit | undefined): TraceNode {
  if (node.children === undefined || childUnit === undefined) return node;
  const children = node.children.map((child) => withStepUnits(child, childUnit));
  if (children.every((child, index) => child === node.children?.[index])) return node;
  return { ...node, children };
}

/** A formula's steps, each in the unit the running value is in at that step. */
function formulaSteps(formula: FormulaNode, unit: TraceUnit | undefined): readonly TraceNode[] {
  const [start, ...steps] = formula.children;
  if (start === undefined) return formula.children;
  const readStart = withStepUnits(start, unit);
  let running = readStart.unit ?? unit;
  const readSteps = steps.map((step) => {
    if (unit !== undefined && running !== undefined && running !== unit && isScalingStep(step)) {
      const operandUnit = operandUnitOf(step);
      // A factor's own trace is not in the calculation's unit, so its children stay as they are.
      const read: ArithmeticNode = {
        ...step,
        unit: step.unit ?? unit,
        beforeUnit: running,
        ...(operandUnit === undefined ? {} : { operandUnit }),
      };
      running = unit;
      return read;
    }
    return withStepUnits(step, running);
  });
  const children = [readStart, ...readSteps];
  return children.every((child, index) => child === formula.children[index])
    ? formula.children
    : children;
}

/**
 * A copy of `node` in which every step that leaves its unit out carries the unit it is read in
 * (see the rules above). `inheritedUnit` is the unit `node` sits in; leave it out for a root.
 * Nodes that already say their unit, or have nothing to inherit, are returned as they are, so an
 * unchanged subtree keeps its identity. The stored trace is never changed.
 */
export function withStepUnits(node: TraceNode, inheritedUnit?: TraceUnit): TraceNode {
  const own = withOwnUnit(node, inheritedUnit);
  if (own.kind === 'formula') {
    const children = formulaSteps(own, own.unit);
    return children === own.children ? own : { ...own, children };
  }
  return withChildUnits(own, SAME_UNIT_PARENTS.has(own.kind) ? own.unit : undefined);
}
