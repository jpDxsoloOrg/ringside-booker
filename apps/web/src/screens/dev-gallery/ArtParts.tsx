import { useId, useState } from 'react';
import { Button } from '@/components/Button';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSlotSize, ImageSubject, PersonStyle } from '@/components/ImageSlot';
import { Cluster } from '@/components/layout';
import { artSeed } from './artSamples';
import styles from './entries/entries.module.css';

export const ALL_IMAGE_SIZES: readonly ImageSlotSize[] = ['xs', 'sm', 'md', 'lg', 'xl'];

interface ArtGridProps {
  readonly title: string;
  readonly subjects: readonly ImageSubject[];
  readonly personStyle?: PersonStyle;
  readonly size?: ImageSlotSize;
}

/** A titled grid of subjects, each with its name (and belt tier) underneath. */
export function ArtGrid({ title, subjects, personStyle = 'initials', size = 'lg' }: ArtGridProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles['example']}>
      <h3 id={headingId} className={styles['subheading']}>
        {title}
      </h3>
      <ul className={styles['artGrid']}>
        {subjects.map((subject) => (
          <li key={subject.id} className={styles['artItem']}>
            <ImageSlot subject={subject} size={size} personStyle={personStyle} decorative />
            <span className={styles['artCaption']}>
              {subject.name}
              {subject.tier === undefined ? '' : ` (${subject.tier})`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface SizeRowProps {
  readonly subject: ImageSubject;
  readonly personStyle?: PersonStyle;
}

/** One subject at every ImageSlot size. */
export function SizeRow({ subject, personStyle = 'initials' }: SizeRowProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={styles['example']}>
      <h3 id={headingId} className={styles['subheading']}>
        Sizes
      </h3>
      <ul className={styles['sizeRow']}>
        {ALL_IMAGE_SIZES.map((size) => (
          <li key={size} className={styles['artItem']}>
            <ImageSlot subject={subject} size={size} personStyle={personStyle} />
            <span className={styles['artCaption']}>{size}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The regenerate cycle: a seed number, and a control that moves to the next one. */
export function useArtCycle(): { readonly cycle: number; readonly regenerate: () => void } {
  const [cycle, setCycle] = useState(1);
  return {
    cycle,
    regenerate: () => {
      setCycle((previous) => previous + 1);
    },
  };
}

interface RegenerateControlProps {
  readonly cycle: number;
  readonly onRegenerate: () => void;
}

export function RegenerateControl({ cycle, onRegenerate }: RegenerateControlProps) {
  return (
    <Cluster gap={3}>
      <Button size="sm" iconStart="fast-forward" onClick={onRegenerate}>
        Regenerate
      </Button>
      <span className={styles['caption']}>
        Seed <span className={styles['mono']}>{artSeed(cycle)}</span>
      </span>
    </Cluster>
  );
}
