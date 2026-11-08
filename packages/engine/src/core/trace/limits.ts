/**
 * Size limits for calculation traces.
 *
 * A trace is capped at {@link TRACE_MAX_NODES} nodes and {@link TRACE_MAX_DEPTH} levels, so a
 * pathological formula (a loop over a whole roster, say) cannot bloat a save or the worker boundary.
 * Going over a limit never throws: the steps that do not fit are replaced by one note node,
 * "N more steps not shown". The arithmetic itself is never cut short, so the traced value stays
 * exact; only the explanation is shortened.
 *
 * Counts live on each builder's {@link TraceBudget}, never in module state, so two formulas built
 * side by side cannot eat into each other's budget.
 */

import type { NoteNode, TraceNode } from './types';

/** The most nodes one trace may hold, truncation notes included. */
export const TRACE_MAX_NODES = 400;

/** The most levels one trace may have. The root is level 1. */
export const TRACE_MAX_DEPTH = 12;

/** Level of the steps a builder records: direct children of the root. */
const STEP_DEPTH = 2;

/** Counts every node in a trace, the root included. */
export function countTraceNodes(node: TraceNode): number {
  let count = 1;
  for (const child of node.children ?? []) {
    count += countTraceNodes(child);
  }
  return count;
}

/** How many levels a trace has. A node with no children has depth 1. */
export function traceDepth(node: TraceNode): number {
  let deepestChild = 0;
  for (const child of node.children ?? []) {
    deepestChild = Math.max(deepestChild, traceDepth(child));
  }
  return 1 + deepestChild;
}

/** "1 more step not shown", "12 more steps not shown". */
export function hiddenStepsLabel(hiddenSteps: number): string {
  return hiddenSteps === 1
    ? '1 more step not shown'
    : `${String(hiddenSteps)} more steps not shown`;
}

/** A note that stands in for nodes cut by the size limits. */
export function truncationNote(hiddenSteps: number, value: number | null): NoteNode {
  return { kind: 'note', label: hiddenStepsLabel(hiddenSteps), value, hiddenSteps };
}

/** True for a note made by {@link truncationNote}. */
export function isTruncationNote(node: TraceNode): node is NoteNode & { hiddenSteps: number } {
  return node.kind === 'note' && node.hiddenSteps !== undefined;
}

/** A node rebuilt to fit the limits, and how many nodes it now holds. */
export interface FittedTrace {
  node: TraceNode;
  size: number;
}

/**
 * Returns `node` with its children replaced, dropping the `children` key when there are none
 * (a formula always keeps its array).
 */
function withChildren(node: TraceNode, children: readonly TraceNode[]): TraceNode {
  if (children.length > 0 || node.kind === 'formula') {
    return { ...node, children };
  }
  // Rest destructuring is the typed way to drop a readonly key; the dropped value is not needed.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { children: droppedChildren, ...withoutChildren } = node;
  return withoutChildren;
}

/** Inside a numeric formula a truncation note carries the formula's result; elsewhere null. */
function noteValueFor(parent: TraceNode): number | null {
  return parent.kind === 'formula' && typeof parent.value === 'number' ? parent.value : null;
}

/**
 * Fits the children of a node into `maxNodes`. One slot is always kept free for the truncation
 * note. Children at the last allowed level keep their own fields but lose their children.
 */
function fitChildren(
  parent: TraceNode,
  children: readonly TraceNode[],
  childDepth: number,
  maxNodes: number,
): FittedTrace[] {
  const kept: FittedTrace[] = [];
  let used = 0;
  let hidden = 0;
  for (const [index, child] of children.entries()) {
    const room = maxNodes - used - 1;
    if (room < 1) {
      hidden += children.slice(index).reduce((total, rest) => total + countTraceNodes(rest), 0);
      break;
    }
    if (childDepth >= TRACE_MAX_DEPTH) {
      hidden += countTraceNodes(child) - 1;
      kept.push({ node: withChildren(child, []), size: 1 });
      used += 1;
    } else {
      const fitted = fitTraceNode(child, childDepth, room);
      kept.push(fitted);
      used += fitted.size;
    }
  }
  if (hidden > 0) {
    kept.push({ node: truncationNote(hidden, noteValueFor(parent)), size: 1 });
  }
  return kept;
}

/**
 * Rebuilds `node`, sitting at level `depth` of a trace, so that it holds at most `maxNodes` nodes
 * and nothing below it goes deeper than {@link TRACE_MAX_DEPTH}. Nodes that already fit are
 * returned unchanged. `maxNodes` must be at least 1.
 */
export function fitTraceNode(node: TraceNode, depth: number, maxNodes: number): FittedTrace {
  const children = node.children;
  if (children === undefined || children.length === 0) {
    return { node, size: 1 };
  }
  if (depth >= TRACE_MAX_DEPTH) {
    return { node: withChildren(node, []), size: 1 };
  }
  const fitted = fitChildren(node, children, depth + 1, maxNodes - 1);
  const unchanged =
    fitted.length === children.length &&
    fitted.every((entry, index) => entry.node === children[index]);
  const size = 1 + fitted.reduce((total, entry) => total + entry.size, 0);
  return {
    node: unchanged
      ? node
      : withChildren(
          node,
          fitted.map((entry) => entry.node),
        ),
    size,
  };
}

/** Fits a whole trace, root first, into the limits. */
export function limitTrace(node: TraceNode): TraceNode {
  return fitTraceNode(node, 1, TRACE_MAX_NODES).node;
}

/**
 * The node budget of one builder. The root takes the first slot; each recorded step is fitted into
 * what is left, keeping one slot free for the truncation note. Once one step has been cut, every
 * later step is cut too, so the note always sits at the end and the steps shown are a prefix.
 */
export interface TraceBudget {
  /** Nodes placed so far, the root included. */
  readonly usedNodes: number;
  /** Nodes cut so far. */
  readonly hiddenNodes: number;
  /** Fits a step (with its subtree) as a direct child of the root, or returns null when it is cut. */
  place(node: TraceNode): TraceNode | null;
  /** The root's final children: the placed steps, plus the truncation note when anything was cut. */
  finish(steps: readonly TraceNode[], noteValue: number | null): TraceNode[];
}

/** Creates the node budget for one builder. */
export function createTraceBudget(): TraceBudget {
  let usedNodes = 1;
  let hiddenNodes = 0;
  return {
    get usedNodes(): number {
      return usedNodes;
    },
    get hiddenNodes(): number {
      return hiddenNodes;
    },
    place(node: TraceNode): TraceNode | null {
      const room = TRACE_MAX_NODES - usedNodes - 1;
      if (hiddenNodes > 0 || room < 1) {
        hiddenNodes += countTraceNodes(node);
        return null;
      }
      const fitted = fitTraceNode(node, STEP_DEPTH, room);
      usedNodes += fitted.size;
      return fitted.node;
    },
    finish(steps: readonly TraceNode[], noteValue: number | null): TraceNode[] {
      return hiddenNodes > 0 ? [...steps, truncationNote(hiddenNodes, noteValue)] : [...steps];
    },
  };
}
