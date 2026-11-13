/**
 * The rival results' trace kinds (AIP5).
 *
 * - `aip.winner`, by segment id: why the rival booker picked a match's winner;
 * - `aip.title`, by `<segmentId>|<titleId>`: why it kept or moved one title on that match.
 *
 * Both kinds are rival-only, so `sim.traceRetentionPerKind` counts them apart from the player's
 * own breakdowns (`segment.rating` and the rest) and a busy rival schedule never pushes those out.
 * Like the card's slot traces, they are kept in full for `history.keepDetailDays` and then
 * demoted to a summary by `aip.pruneCardDetail`. So that those days fit on a busy world, both kinds
 * have store limits of their own (`aip.results.fullTraces` and `aip.results.fullTraceChars`, each
 * kind apart) instead of the `sim.*` per-kind ones (AIP5-06). See
 * docs/design/rival-booking.md#winners.
 */

import type { SegmentId, TitleId } from '../../../core/ids';
import type { Traced, TraceNode, TraceValue } from '../../../core/trace';
import { countTraceNodes, truncationNote } from '../../../core/trace/limits';
import type { TraceRef } from '../../../core/trace/store';
import { methodsOf } from '../../../model/catalogs';
import type { GameWorldView } from '../../../model/tables';
import { winPlanKey } from '../formulas/matchWinner';
import { registerTraceKindLimits } from '../../traceKindLimits';

/** One rival match's winner decision, by segment id. */
export const WINNER_TRACE_KIND = 'aip.winner';
/** One title decision on a rival match, by `<segmentId>|<titleId>`. */
export const TITLE_TRACE_KIND = 'aip.title';

/** Both kinds' store limits come from the results tunables, so 28 days of detail fit. */
export const RESULT_TRACE_LIMITS_ID = 'aip.results';

registerTraceKindLimits({
  id: RESULT_TRACE_LIMITS_ID,
  kinds: [WINNER_TRACE_KIND, TITLE_TRACE_KIND],
  limits: (tunables) => ({
    retentionPerKind: tunables.get('aip.results.fullTraces'),
    bytesPerKind: tunables.get('aip.results.fullTraceChars'),
  }),
});

/** The ref of a rival match's winner decision. */
export function winnerTraceRef(segmentId: SegmentId): TraceRef {
  return { kind: WINNER_TRACE_KIND, id: segmentId };
}

/** The ref of the decision about one title on a rival match. */
export function titleTraceRef(segmentId: SegmentId, titleId: TitleId): TraceRef {
  return { kind: TITLE_TRACE_KIND, id: `${segmentId}|${titleId}` };
}

/** Levels kept in a stored `aip.winner` trace: the result, who wins, each side's value and its steps. */
export const WINNER_TRACE_DEPTH = 4;
/** Levels kept in a stored `aip.title` trace: the decision, the chance and pool, and their steps. */
export const TITLE_TRACE_DEPTH = 3;

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

/** One side of a match, for {@link optionWords}. */
export interface WordedSide {
  readonly side: number;
  readonly label: string;
}

/**
 * The words for the plan codes a rival result's decisions choose between: `side:<n>` reads as the
 * side's names (with "(side n)" after when two sides share them) and a method's content key as
 * its name. Everything else (`retain`, `draw`, `noContest`) the Why? panel already words.
 */
export function optionWords(
  read: GameWorldView,
  sides: readonly WordedSide[],
): ReadonlyMap<string, string> {
  const words = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const side of sides) {
    counts.set(side.label, (counts.get(side.label) ?? 0) + 1);
  }
  for (const side of sides) {
    const shared = (counts.get(side.label) ?? 0) > 1;
    words.set(
      winPlanKey(side.side),
      shared ? `${side.label} (side ${String(side.side + 1)})` : side.label,
    );
  }
  for (const method of methodsOf(read)) {
    words.set(method.key, method.name);
  }
  return words;
}

/**
 * The trace with every decision's chosen and considered options put in words (`words`); an
 * option's reason that only repeated the words is dropped. The returned value is unchanged, so
 * callers still read the plan code.
 */
export function wordedOptions<T extends TraceValue>(
  traced: Traced<T>,
  words: ReadonlyMap<string, string>,
): Traced<T> {
  return { value: traced.value, trace: wordNode(traced.trace, words) };
}

function wordNode(node: TraceNode, words: ReadonlyMap<string, string>): TraceNode {
  const children = node.children?.map((child) => wordNode(child, words));
  const withChildren: TraceNode = children === undefined ? node : { ...node, children };
  if (withChildren.kind !== 'decision') {
    return withChildren;
  }
  const word = (option: string | boolean): string | boolean =>
    typeof option === 'string' ? (words.get(option) ?? option) : option;
  return {
    ...withChildren,
    value: word(withChildren.value),
    chosen: word(withChildren.chosen),
    considered: withChildren.considered.map((entry) => {
      const option = word(entry.option);
      if (option !== entry.option && entry.reason === option) {
        return { option, score: entry.score };
      }
      return { ...entry, option };
    }),
  };
}
