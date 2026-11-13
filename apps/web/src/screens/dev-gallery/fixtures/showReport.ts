/**
 * A made-up show score breakdown for the gallery, laid out the way the engine reads one from the
 * show score trace: each rated segment's share (`score × weight ÷ total weight`), each empty
 * main-card slot's penalty, then the rounding, so the rows add up to the score.
 */
import type {
  SegmentResultView,
  ShowScoreBreakdownView,
  ShowScoreRowView,
  SlotRole,
} from '@ringside/engine';

/** The default slot weights and the pre-show factor. */
const WEIGHTS: Readonly<Record<SlotRole, number>> = {
  preShow: 0.4,
  opener: 1,
  midcard: 1,
  semiMain: 1.25,
  mainEvent: 1.75,
};
const PRE_SHOW_FACTOR = 0;
const EMPTY_SLOT_PENALTY = 5;

export interface GalleryBreakdown {
  readonly breakdown: ShowScoreBreakdownView;
  /** The rounded score the rows add up to. */
  readonly score: number;
}

/** The breakdown of a card of rated segments with `emptySlots` ("Slot 3 (Midcard) is empty"). */
export function galleryBreakdown(
  segments: readonly SegmentResultView[],
  emptySlots: readonly string[] = [],
): GalleryBreakdown {
  const rated = segments.filter((segment) => segment.rating !== null);
  const counted = rated.map((segment) => {
    const slotWeight = WEIGHTS[segment.roleKey];
    return {
      segment,
      slotWeight,
      weight: segment.preShow ? slotWeight * PRE_SHOW_FACTOR : slotWeight,
    };
  });
  const totalWeight = counted.reduce((sum, entry) => sum + entry.weight, 0);
  const rows: ShowScoreRowView[] = counted.map(({ segment, slotWeight, weight }) => {
    const score = segment.rating?.score ?? 0;
    return {
      kind: 'segment',
      label: segment.roleLabel,
      segmentId: segment.segmentId,
      preShow: segment.preShow,
      score,
      slotWeight,
      weight,
      points: totalWeight > 0 ? (score * weight) / totalWeight : 0,
    };
  });
  for (const label of emptySlots) {
    rows.push({
      kind: 'emptySlot',
      label,
      segmentId: null,
      preShow: false,
      score: null,
      slotWeight: null,
      weight: null,
      points: -EMPTY_SLOT_PENALTY,
    });
  }
  const unrounded = rows.reduce((sum, row) => sum + row.points, 0);
  const score = Math.min(100, Math.max(0, Math.round(unrounded)));
  if (score !== unrounded) {
    rows.push({
      kind: 'adjustment',
      label: 'Rounded',
      segmentId: null,
      preShow: false,
      score: null,
      slotWeight: null,
      weight: null,
      points: score - unrounded,
    });
  }
  const hasPreShow = counted.some((entry) => entry.segment.preShow);
  return {
    breakdown: { rows, totalWeight, preShowFactor: hasPreShow ? PRE_SHOW_FACTOR : null },
    score,
  };
}
