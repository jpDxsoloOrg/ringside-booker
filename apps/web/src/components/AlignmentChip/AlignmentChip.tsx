import type { Alignment } from '@ringside/engine';
import { classNames } from '../classNames';
import styles from './AlignmentChip.module.css';

/** `soft` (outlined, the default) for dense rows; `solid` for a profile header. */
export type AlignmentChipVariant = 'soft' | 'solid';

export type AlignmentChipSize = 'sm' | 'md';

/** The word on the chip for each alignment. The chip always shows it: colour is never alone. */
export const ALIGNMENT_LABELS: Readonly<Record<Alignment, string>> = {
  face: 'Face',
  heel: 'Heel',
  tweener: 'Tweener',
};

export interface AlignmentChipProps {
  readonly alignment: Alignment;
  /** `soft` by default. */
  readonly variant?: AlignmentChipVariant;
  /** `md` by default; `sm` for table rows and card subtitles. */
  readonly size?: AlignmentChipSize;
  readonly className?: string | undefined;
}

/**
 * FACE, HEEL or TWEENER as a pill in that alignment's colour: cyan for the cool side, red-orange
 * for the hot side, violet in between. The word is always on the chip.
 */
export function AlignmentChip({
  alignment,
  variant = 'soft',
  size = 'md',
  className,
}: AlignmentChipProps) {
  return (
    <span
      className={classNames(
        styles['alignmentChip'],
        styles[variant],
        styles[`size-${size}`],
        styles[`alignment-${alignment}`],
        className,
      )}
      data-alignment={alignment}
    >
      {ALIGNMENT_LABELS[alignment]}
    </span>
  );
}
