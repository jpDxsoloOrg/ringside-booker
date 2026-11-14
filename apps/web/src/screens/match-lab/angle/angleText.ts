import type { PreviewAngleBeat, SegmentWarning, TraceNode } from '@ringside/engine';
import { BEAT_STAT_LABELS, CLOSING_BEAT_LABEL } from '@ringside/engine';
import { findTraceNode } from './angleDraft';

/** One person's line in the per-beat table, from the engine's beat result. */
type BeatPerson = PreviewAngleBeat['groups'][number]['people'][number];

/**
 * "Mic 78" or "Mic 70 via Rex Halden": the stat a person was scored on, their value and who
 * talked for them.
 */
export function personStatText(person: BeatPerson): string {
  const stat = BEAT_STAT_LABELS[person.stat];
  const value = `${stat} ${String(Math.round(person.value.value))}`;
  if (!person.viaManager) return value;
  const prefix = `${stat} via manager `;
  const manager = person.statLabel.startsWith(prefix)
    ? person.statLabel.slice(prefix.length)
    : 'their manager';
  return `${value} via ${manager}`;
}

/** How a counted beat weighs in the angle's delivered score, read off its trace. */
export interface BeatWeight {
  /** The beat's weight, times the closing weight for the last beat. */
  readonly weight: number;
  readonly closing: boolean;
  /** The repeat factor applied to its score (0.85 for a second beat of a kind), or null. */
  readonly repeat: number | null;
  /** The beat's weighted share, for its Why?. */
  readonly trace: TraceNode;
}

/** The label of a beat's share in the delivered trace: "Promo (beat 2)". */
export function beatTermLabel(beat: Pick<PreviewAngleBeat, 'name' | 'index'>): string {
  return `${beat.name} (beat ${String(beat.index + 1)})`;
}

function operandOf(node: TraceNode): number | null {
  return 'operand' in node && typeof node.operand === 'number' ? node.operand : null;
}

/**
 * A counted beat's weight, closing flag and repeat factor from the delivered trace, or null when
 * the trace doesn't hold its share (an uncounted beat, or a trace cut short).
 */
export function beatWeightOf(delivered: TraceNode, beat: PreviewAngleBeat): BeatWeight | null {
  const term = findTraceNode(delivered, beatTermLabel(beat));
  if (term === null) return null;
  let weight: number | null = null;
  let closing = false;
  let repeat: number | null = null;
  for (const step of term.children ?? []) {
    const operand = operandOf(step);
    if (operand === null) continue;
    if (step.label === 'Beat weight') weight = (weight ?? 1) * operand;
    else if (step.label === CLOSING_BEAT_LABEL) {
      closing = true;
      weight = (weight ?? 1) * operand;
    } else if (step.label.includes('beat in this angle ×')) repeat = operand;
  }
  if (weight === null) return null;
  return { weight, closing, repeat, trace: term };
}

/** "×0.85". */
export function factorText(factor: number): string {
  return `×${String(Math.round(factor * 100) / 100)}`;
}

/** The warning's words, with what a sides conflict means for booking. */
export function angleWarningText(warning: SegmentWarning): string {
  if (warning.code === 'angle.sidesConflict') {
    return `${warning.message}. You can preview it here, but it can't be booked like this.`;
  }
  return warning.message;
}
