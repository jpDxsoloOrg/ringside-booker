import { Stack } from '@/components/layout';
import { StorylineLinkPicker } from '@/components/StorylineLinkPicker';
import { GALLERY_LINK_STATES } from '../fixtures/storylineLinks';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';

const noop = (): void => undefined;

function StorylineLinkPickerDemo() {
  return (
    <Stack gap={5}>
      {GALLERY_LINK_STATES.map(({ title, state }) => (
        <section key={title} className={styles['example']}>
          <h3 className={styles['subheading']}>{title}</h3>
          <StorylineLinkPicker {...state} onLink={noop} onUnlink={noop} onSetFinale={noop} />
        </section>
      ))}
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'storyline-link-picker',
  title: 'StorylineLinkPicker',
  group: 'Office',
  notes:
    "The Booking editor's Storyline section: one-tap suggestions for storylines with people in " +
    'the segment, the linked list with heat, Unlink and (for matches) the Finale switch, and a ' +
    'picker for the rest. Warnings and the read-only reason are visible text. On a phone the ' +
    'chips wrap and each linked row stacks.',
  render: () => <StorylineLinkPickerDemo />,
};
