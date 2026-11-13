/**
 * The show report's numbers (EVT3-09), read from the traces show night stored, so the report and
 * every Why? panel show the same numbers and there is no second formula.
 *
 * - `showScoreBreakdown` turns the show score trace into one row per slot: its score, how much it
 *   counted and its share of the show score, with empty slots and every later step (card flow, the
 *   production cap, rounding) as their own rows. The rows add up to the score.
 * - `segmentReasons` picks a segment's top two rating factors from its score trace: how far each
 *   part of the score (work rate or talk, the crowd, the house rules bonus) pulled it from a
 *   middling 50.
 *
 * Both return nothing they cannot read for certain: a trace cut by the size limits, or one that no
 * longer has its full steps, gives `null` or no reasons rather than a guess.
 *
 * Design notes: docs/design/show-night.md#show-report.
 */

import type { SegmentId } from '../../core/ids';
import type { ArithmeticNode, TraceNode } from '../../core/trace';
import { SHOW_SCORE_TRACE_LABELS } from './formulas/showScore';

// ---------------------------------------------------------------------------------------------
// Show score breakdown

/** What a row of the breakdown stands for. */
export type ShowScoreRowKind = 'segment' | 'emptySlot' | 'adjustment';

export interface ShowScoreRowView {
  kind: ShowScoreRowKind;
  /**
   * The slot role for a segment ("Main event"), the slot for an empty one ("Slot 1 (Opener) is
   * empty"), and the step's own words for an adjustment ("Rounded").
   */
  label: string;
  /** The segment this row counts, when it could be matched to the card; else null. */
  segmentId: SegmentId | null;
  preShow: boolean;
  /** The segment's score, 0 to 100; null for other rows. */
  score: number | null;
  /** The slot's weight before the pre-show factor; null for other rows. */
  slotWeight: number | null;
  /** How much the slot counted (its weight, times the pre-show factor on the pre-show). */
  weight: number | null;
  /**
   * The row's share of the show score in points: `score × weight / total weight` for a segment, the
   * penalty (negative) for an empty slot, and the step's effect for an adjustment. The rows add up
   * to the show score.
   */
  points: number;
}

export interface ShowScoreBreakdownView {
  /** Pre-show slots first, then the main card in slot order, then empty slots, then later steps. */
  rows: ShowScoreRowView[];
  /** The sum of the counted weights; 0 when nothing counted. */
  totalWeight: number;
  /** The pre-show factor when a pre-show segment counted toward the score; else null. */
  preShowFactor: number | null;
}

/** One filled slot of the card, in card order, so the breakdown can name its segment. */
export interface BreakdownSegment {
  readonly segmentId: SegmentId;
  readonly roleLabel: string;
  readonly preShow: boolean;
}

function childAt(node: TraceNode | undefined, index: number): TraceNode | undefined {
  return node?.children?.[index];
}

function numberOf(node: TraceNode | undefined): number | null {
  return node !== undefined && typeof node.value === 'number' ? node.value : null;
}

/** True when a step stands in for steps the size limits cut: the trace is not whole. */
function isCut(node: TraceNode): boolean {
  return node.kind === 'note' && node.hiddenSteps !== undefined;
}

function hasCut(node: TraceNode): boolean {
  return isCut(node) || (node.children ?? []).some(hasCut);
}

interface SlotLine {
  readonly roleLabel: string;
  readonly score: number;
  readonly weight: number;
  readonly slotWeight: number;
  readonly preShowFactor: number | null;
}

/**
 * A slot's line: `add` of a formula that starts at "<Role> score" and multiplies by "Counts", whose
 * own trace starts at the slot weight and may multiply by the pre-show factor.
 */
function slotLineOf(node: TraceNode): SlotLine | null {
  if (node.kind !== 'add') return null;
  const line = childAt(node, 0);
  const start = childAt(line, 0);
  const counts = childAt(line, 1);
  const { slotScoreSuffix, counts: countsLabel, preShowFactor } = SHOW_SCORE_TRACE_LABELS;
  if (
    line?.kind !== 'formula' ||
    start?.kind !== 'input' ||
    !start.label.endsWith(slotScoreSuffix) ||
    counts?.kind !== 'multiply' ||
    counts.label !== countsLabel
  ) {
    return null;
  }
  const score = numberOf(start);
  if (score === null) return null;
  const countsTrace = childAt(counts, 0);
  const slotWeight = numberOf(childAt(countsTrace, 0)) ?? counts.operand;
  const factorStep = (countsTrace?.children ?? []).find(
    (step): step is ArithmeticNode => step.kind === 'multiply' && step.label === preShowFactor,
  );
  return {
    roleLabel: start.label.slice(0, -slotScoreSuffix.length),
    score,
    weight: counts.operand,
    slotWeight,
    preShowFactor: factorStep?.operand ?? null,
  };
}

/** `after − before` for a step that moves the running value, else null. */
function effectOf(node: TraceNode): number | null {
  switch (node.kind) {
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'power':
    case 'min':
    case 'max':
    case 'clamp':
    case 'round':
      return node.after - node.before;
    case 'formula':
    case 'input':
    case 'constant':
    case 'tunable':
    case 'roll':
    case 'branch':
    case 'decision':
    case 'note':
      return null;
  }
}

/** Steps too small to show as their own row (float noise). */
const NEGLIGIBLE = 1e-9;

/**
 * The show score trace as rows, or null when the trace is not a show score trace this reader
 * knows, or was cut by the size limits. `segments` are the card's rated segments in card order (the
 * pre-show first): the n-th slot line is matched to the n-th segment when their roles agree.
 */
export function showScoreBreakdown(
  trace: TraceNode,
  segments: readonly BreakdownSegment[],
): ShowScoreBreakdownView | null {
  if (trace.kind !== 'formula' || hasCut(trace)) return null;
  const [start, ...steps] = trace.children;
  if (start === undefined) return null;

  const lines: SlotLine[] = [];
  let index = 0;
  for (; index < steps.length; index += 1) {
    const step = steps[index];
    const line = step === undefined ? null : slotLineOf(step);
    if (line === null) break;
    lines.push(line);
  }

  // The mean: a divide by the total weight, or a note when nothing counted.
  let totalWeight = 0;
  const divide = steps[index];
  if (divide?.kind === 'divide' && divide.label === SHOW_SCORE_TRACE_LABELS.divide) {
    totalWeight = divide.operand;
    index += 1;
  } else if (divide?.kind === 'note') {
    index += 1;
  } else if (lines.length > 0) {
    return null;
  }

  const matched = lines.length === segments.length;
  const rows: ShowScoreRowView[] = lines.map((line, position) => {
    const segment = matched ? segments[position] : undefined;
    return {
      kind: 'segment',
      label: line.roleLabel,
      segmentId: segment?.roleLabel === line.roleLabel ? segment.segmentId : null,
      preShow: line.preShowFactor !== null,
      score: line.score,
      slotWeight: line.slotWeight,
      weight: line.weight,
      points: totalWeight > 0 ? (line.score * line.weight) / totalWeight : 0,
    };
  });
  const preShowFactor = lines.find((line) => line.preShowFactor !== null)?.preShowFactor ?? null;

  for (const step of steps.slice(index)) {
    if (
      step.kind === 'subtract' &&
      step.label.startsWith(SHOW_SCORE_TRACE_LABELS.emptySlotsPrefix)
    ) {
      const slots = (childAt(step, 0)?.children ?? []).filter(
        (slot): slot is ArithmeticNode => slot.kind === 'add',
      );
      for (const slot of slots) {
        rows.push(emptyRow(slot.label, -slot.operand));
      }
      continue;
    }
    const effect = effectOf(step);
    if (effect !== null && Math.abs(effect) > NEGLIGIBLE) {
      rows.push({ ...emptyRow(step.label, effect), kind: 'adjustment' });
    }
  }
  return { rows, totalWeight, preShowFactor };
}

function emptyRow(label: string, points: number): ShowScoreRowView {
  return {
    kind: 'emptySlot',
    label,
    segmentId: null,
    preShow: false,
    score: null,
    slotWeight: null,
    weight: null,
    points,
  };
}

// ---------------------------------------------------------------------------------------------
// Segment reasons

/** The middle of the 0–100 scale: the score a segment of middling parts would get. */
export const SEGMENT_REASON_BASELINE = 50;

/** How many reasons a segment card shows. */
export const SEGMENT_REASON_LIMIT = 2;

/** Reasons smaller than this round to nothing and are left out. */
const SMALLEST_REASON = 0.5;

export interface SegmentReasonView {
  /** "Strong work rate", "Quiet crowd", "Same rules for every promotion". */
  label: string;
  /** How far it moved the segment score, in points (signed). */
  effect: number;
}

/** The words for a part of the score that pulled the segment up, and down. */
const PART_WORDS: Readonly<Record<string, readonly [up: string, down: string]>> = {
  'Work rate': ['Strong work rate', 'Weak work rate'],
  Talk: ['Strong talking', 'Weak talking'],
  Crowd: ['Hot crowd', 'Quiet crowd'],
};

function partWords(label: string, effect: number): string {
  const words = PART_WORDS[label];
  if (words !== undefined) return effect > 0 ? words[0] : words[1];
  const lower = label.toLowerCase();
  return effect > 0 ? `Strong ${lower}` : `Weak ${lower}`;
}

/** "Same rules for every promotion +0" → "Same rules for every promotion". */
function withoutSignedNumber(label: string): string {
  return label.replace(/\s[+−-][\d.,]+$/u, '');
}

/**
 * A segment's top rating factors, largest first, at most {@link SEGMENT_REASON_LIMIT}. Each
 * weighted part of the score (`part × share`) counts by how far it sits from the middle of the
 * scale (`(part − 50) × share`), and a flat bonus by itself; together they are how far the score
 * sits from 50 before rounding. Empty for a trace this reader does not know.
 */
export function segmentReasons(trace: TraceNode): SegmentReasonView[] {
  if (trace.kind !== 'formula' || hasCut(trace)) return [];
  const reasons: (SegmentReasonView & { index: number })[] = [];
  for (const [index, step] of trace.children.entries()) {
    if (step.kind !== 'add') continue;
    const part = childAt(step, 0);
    const value = childAt(part, 0);
    const share = childAt(part, 1);
    if (part?.kind === 'formula' && value?.kind === 'input' && share?.kind === 'multiply') {
      const partValue = numberOf(value);
      if (partValue === null) continue;
      const effect = (partValue - SEGMENT_REASON_BASELINE) * share.operand;
      reasons.push({ label: partWords(value.label, effect), effect, index });
    } else {
      reasons.push({ label: withoutSignedNumber(step.label), effect: step.operand, index });
    }
  }
  return reasons
    .filter((reason) => Math.abs(reason.effect) >= SMALLEST_REASON)
    .sort(
      (left, right) => Math.abs(right.effect) - Math.abs(left.effect) || left.index - right.index,
    )
    .slice(0, SEGMENT_REASON_LIMIT)
    .map(({ label, effect }) => ({ label, effect }));
}
