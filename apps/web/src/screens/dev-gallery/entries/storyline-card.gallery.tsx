import { routes } from '@/app/routes';
import { StorylineCard } from '@/components/StorylineCard';
import type { GalleryEntry } from '../galleryEntry';
import { GALLERY_HOT_FROM, galleryStorylineRows } from '../fixtures/storylines';
import styles from './storyline-card.module.css';

function StorylineCardDemo() {
  return (
    <div className={styles['grid']}>
      {galleryStorylineRows.map((row) => (
        <StorylineCard
          key={row.id}
          row={row}
          hotFrom={GALLERY_HOT_FROM}
          href={routes.game.storyline(row.id)}
        />
      ))}
    </div>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'storyline-card',
  title: 'StorylineCard',
  group: 'Broadcast',
  notes:
    'One storyline on the Storylines desk, from storylines.list: hot with a neutral, cold, a ' +
    'member who left the promotion, ended, and a rival storyline whose heat is not public. Faces ' +
    'sit left of the slash and heels right; in the phone frame the faces stack above the heels.',
  render: () => <StorylineCardDemo />,
};
