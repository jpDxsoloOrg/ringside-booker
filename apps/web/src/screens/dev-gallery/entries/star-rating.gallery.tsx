import { Stack } from '@/components/layout';
import { StarRating } from '@/components/StarRating';
import type { StarRatingSize, StarRatingTone } from '@/components/StarRating';
import type { GalleryEntry } from '../galleryEntry';
import broadcast from './broadcast.module.css';
import styles from './entries.module.css';

/** 0, 0.25 … 5. */
const QUARTER_VALUES: readonly number[] = Array.from({ length: 21 }, (_, index) => index / 4);
const SIZES: readonly StarRatingSize[] = ['sm', 'md', 'lg'];
const TONES: readonly StarRatingTone[] = ['office', 'broadcast'];

function StarRatingDemo() {
  return (
    <Stack gap={5}>
      {TONES.map((tone) => (
        <section key={tone} className={styles['example']}>
          <h3 className={styles['subheading']}>Every quarter, {tone} tone</h3>
          <div className={broadcast['stage']}>
            <Stack gap={2}>
              {QUARTER_VALUES.map((value) => (
                <div key={value} className={broadcast['row']}>
                  <span className={styles['mono']}>{value.toFixed(2)}</span>
                  <StarRating value={value} tone={tone} />
                </div>
              ))}
            </Stack>
          </div>
        </section>
      ))}
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Sizes at 3.75</h3>
        <div className={broadcast['stage']}>
          {SIZES.map((size) => (
            <div key={size} className={broadcast['row']}>
              <span className={styles['mono']}>{size}</span>
              <StarRating value={3.75} size={size} />
              <StarRating value={3.75} size={size} tone="broadcast" />
            </div>
          ))}
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'star-rating',
  title: 'StarRating',
  group: 'Broadcast',
  notes:
    'Five stars filled in quarter steps by a CSS clip, no inline styles. It is an image named by the rating in words ("3.75 stars out of 5"), and 0 says "No stars" on screen. Values off the quarter grid or past 5 throw in development.',
  render: () => <StarRatingDemo />,
};
