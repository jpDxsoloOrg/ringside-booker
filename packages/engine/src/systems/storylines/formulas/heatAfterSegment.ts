/**
 * Heat after a linked segment (CRTV4-02): how far one segment moves a storyline's heat.
 *
 * Heat moves toward the segment's score: a share (`storylines.heat.pull`) of the gap between them.
 * A further segment of the same storyline on the same show counts for less
 * (`storylines.heat.repeatFactor` per extra segment), and so does a pre-show segment
 * (`storylines.heat.preShowFactor`). One segment never moves heat by more than
 * `storylines.heat.maxStep`, and heat stays within 0 to 100. No rolls.
 *
 * Design: docs/design/storylines.md#heat-after-segment.
 */

import { startCalc } from '../../../core/trace/calc';
import type { Traced } from '../../../core/trace/types';
import type { EngineTunables } from '../../tunables';

export const HEAT_AFTER_SEGMENT_DOC_REF = 'docs/design/storylines.md#heat-after-segment';

export interface HeatAfterSegmentInputs {
  /** The storyline's heat walking into the segment, 0–100. */
  readonly heatBefore: number;
  /** The segment's score, 0–100. */
  readonly segmentScore: number;
  readonly storylineName: string;
  /** How the segment is named in the trace: "Opener", "Main event", "Slot 3". */
  readonly segmentLabel: string;
  /** 1 for this storyline's first counted segment on the show, 2 for its second, and so on. */
  readonly nthOnShow: number;
  readonly preShow: boolean;
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'] as const;

/** "Second", "Third", … then "7th". */
function ordinal(nth: number): string {
  return ORDINALS[nth - 1] ?? `${String(nth)}th`;
}

/**
 * The storyline's heat after the segment: `heatBefore` plus `(segmentScore − heatBefore) × pull ×
 * repeatFactor^(nthOnShow − 1) × (preShow ? preShowFactor : 1)`, the change kept within
 * ±`maxStep` and the heat within 0–100.
 */
export function heatAfterSegment(
  inputs: HeatAfterSegmentInputs,
  deps: { tunables: EngineTunables },
): Traced<number> {
  const { tunables } = deps;
  const gap = startCalc("Gap to the segment's score", inputs.segmentScore, {
    unit: 'points',
    startLabel: "Segment's score",
  })
    .subtract('Heat before the segment', inputs.heatBefore)
    .done();

  const step = startCalc('Heat change', gap, { unit: 'points' });
  step.multiply(
    'Pull per segment',
    step.tunable(tunables, 'storylines.heat.pull', 'Share of the gap one segment closes'),
  );
  const nth = Math.max(1, Math.floor(inputs.nthOnShow));
  const repeated = nth > 1;
  step.branch(`${ordinal(nth)} linked segment for this story tonight`, repeated);
  if (repeated) {
    const factor = step.tunable(
      tunables,
      'storylines.heat.repeatFactor',
      'Each further segment of the story on one show',
    );
    step.multiply(
      `${ordinal(nth)} segment tonight`,
      factor ** (nth - 1),
      nth > 2 ? `Reduced ${String(nth - 1)} times` : undefined,
    );
  }
  step.branch('Pre-show segment', inputs.preShow);
  if (inputs.preShow) {
    step.multiply(
      'Pre-show',
      step.tunable(tunables, 'storylines.heat.preShowFactor', 'Pre-show segments count for'),
    );
  }
  const maxStep = step.tunable(tunables, 'storylines.heat.maxStep');
  step.clamp(-maxStep, maxStep, 'Most heat one segment can move');

  return startCalc(`Heat after '${inputs.segmentLabel}'`, inputs.heatBefore, {
    unit: 'points',
    docRef: HEAT_AFTER_SEGMENT_DOC_REF,
    startLabel: `Heat before '${inputs.segmentLabel}'`,
  })
    .note(`Storyline: ${inputs.storylineName}`)
    .add('Heat change', step.done())
    .clamp(0, 100)
    .done();
}
