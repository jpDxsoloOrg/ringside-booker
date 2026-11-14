import type { StorylineSide } from '@ringside/engine';
import { classNames } from '../classNames';
import styles from './StorylineSideChip.module.css';

export type StorylineSideChipSize = 'sm' | 'md';

/** The word on the chip for each side of a story. The chip always shows it: colour is never alone. */
export const STORYLINE_SIDE_LABELS: Readonly<Record<StorylineSide, string>> = {
  face: 'Face',
  heel: 'Heel',
  neutral: 'Neutral',
};

export interface StorylineSideChipProps {
  /** The person's side in this story (not their overall alignment). */
  readonly side: StorylineSide;
  /** `sm` by default, to sit beside a name; `md` for a heading. */
  readonly size?: StorylineSideChipSize;
  readonly className?: string | undefined;
}

/**
 * FACE, HEEL or NEUTRAL: someone's side in one storyline, as an outlined pill. Face and heel use
 * the alignment colours (`AlignmentChip`), neutral a quiet grey. The word is always on the chip.
 */
export function StorylineSideChip({ side, size = 'sm', className }: StorylineSideChipProps) {
  return (
    <span
      className={classNames(
        styles['sideChip'],
        styles[`size-${size}`],
        styles[`side-${side}`],
        className,
      )}
      data-side={side}
    >
      {STORYLINE_SIDE_LABELS[side]}
    </span>
  );
}
