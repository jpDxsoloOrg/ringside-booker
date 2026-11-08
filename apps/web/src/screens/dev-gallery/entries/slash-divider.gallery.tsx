import { Stack } from '@/components/layout';
import { SlashDivider } from '@/components/SlashDivider';
import type { SlashDividerTone } from '@/components/SlashDivider';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import broadcast from './broadcast.module.css';

const TONES: readonly SlashDividerTone[] = ['neutral', 'action', 'data', 'prestige'];

function SlashDividerDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Bands</h3>
        <div className={broadcast['stage']}>
          {TONES.map((tone) => (
            <Stack key={tone} gap={1}>
              <span className={styles['caption']}>{tone}</span>
              <SlashDivider tone={tone} decorative={tone !== 'neutral'} />
            </Stack>
          ))}
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Inline</h3>
        <div className={broadcast['stage']}>
          <p className={broadcast['inlineLine']}>
            <span>Up next</span>
            <SlashDivider variant="inline" tone="action" />
            <span>In 3 days</span>
            <SlashDivider variant="inline" />
            <span>Episode 128</span>
          </p>
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'slash-divider',
  title: 'SlashDivider',
  group: 'Broadcast',
  notes:
    'A band of 45° slashes between blocks (a separator unless decorative), or the // mark between items on one line, which screen readers skip.',
  render: () => <SlashDividerDemo />,
};
