/**
 * Making a stored trace smaller without changing what it says (AIP5-06, shared with MTCH4-04).
 *
 * Results stored for every show (rival results, every worker's physical toll) would fill a save if
 * kept with every step of every formula. `compactTrace` cuts a tree below a depth, leaving a "N
 * more steps not shown" note that carries the cut node's number, and `leanTrace` drops what a
 * stored trace repeats. Both keep the value, and the trace still replays.
 *
 * See docs/design/calculation-traces.md#retention.
 */

import { countTraceNodes, truncationNote } from './limits';
import type { Traced, TraceNode, TraceValue } from './types';

/**
 * Cuts a trace below `maxDepth` levels (the root is level 1): a node on the last kept level keeps
 * its own value but its explanation becomes one "N more steps not shown" note, which carries the
 * node's number so the trace still replays. Rival results are stored for every rival show, so
 * the deep parts (each tunable's wording, how a taste or a prestige was worked out) are left to the
 * formulas' own Why?s and the docs. See docs/design/rival-booking.md#how-a-rival-shows-results-are-decided.
 */
export function compactTrace<T extends TraceValue>(traced: Traced<T>, maxDepth: number): Traced<T> {
  return { value: traced.value, trace: cutBelow(traced.trace, 1, maxDepth) };
}

function cutBelow(node: TraceNode, depth: number, maxDepth: number): TraceNode {
  const children = node.children;
  if (children === undefined || children.length === 0) {
    return node;
  }
  if (depth < maxDepth) {
    return { ...node, children: children.map((child) => cutBelow(child, depth + 1, maxDepth)) };
  }
  const hidden = children.reduce((sum, child) => sum + countTraceNodes(child), 0);
  const value = typeof node.value === 'number' ? node.value : null;
  return { ...node, children: [truncationNote(hidden, value)] };
}

/**
 * Trims what a stored rival result repeats (AIP5-06), so 28 days of them fit the save: a `docRef`
 * the nearest ancestor already gives is dropped, and a roll keeps its record but not the steps
 * under it (the record has the range and the result). Values, labels and every other step stay, so
 * the trace still replays and reads the same.
 */
export function leanTrace<T extends TraceValue>(traced: Traced<T>): Traced<T> {
  return { value: traced.value, trace: leanNode(traced.trace, undefined) };
}

function leanNode(node: TraceNode, inheritedDocRef: string | undefined): TraceNode {
  const docRef = node.docRef ?? inheritedDocRef;
  let lean: TraceNode = node;
  if (node.docRef !== undefined && node.docRef === inheritedDocRef) {
    // Rest destructuring is the typed way to drop a readonly key.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { docRef: _repeated, ...rest } = node;
    lean = rest;
  }
  const children = lean.children;
  if (children === undefined) {
    return lean;
  }
  if (lean.kind === 'roll') {
    // Rest destructuring is the typed way to drop a readonly key.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { children: _steps, ...rest } = lean;
    return rest;
  }
  return { ...lean, children: children.map((child) => leanNode(child, docRef)) };
}
