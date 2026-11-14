import { Stack } from '@/components/layout';
import { NewsHeroCard } from '@/screens/news/NewsHeroCard';
import type { GalleryEntry } from '../galleryEntry';
import {
  GALLERY_ANNIVERSARY_STORY,
  GALLERY_BUZZ_TRACE,
  GALLERY_NEWS_NAMES,
  GALLERY_RECORD_STORY,
  GALLERY_RIVALRY_STORY,
  GALLERY_SEASON_STORY,
} from '../fixtures/news';
import styles from './entries.module.css';

/** The gallery's links go nowhere: the story sheet has its own entry. */
const STORY_LINK = { search: '' };

function NewsHeroCardDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Large: the lead story (prestige)</h3>
        <NewsHeroCard
          item={GALLERY_RECORD_STORY}
          names={GALLERY_NEWS_NAMES}
          storyLink={STORY_LINK}
          size="large"
          buzzTrace={GALLERY_BUZZ_TRACE}
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Small: action and data</h3>
        <Stack gap={3}>
          <NewsHeroCard
            item={GALLERY_RIVALRY_STORY}
            names={GALLERY_NEWS_NAMES}
            storyLink={STORY_LINK}
            buzzTrace={GALLERY_BUZZ_TRACE}
          />
          <NewsHeroCard
            item={GALLERY_ANNIVERSARY_STORY}
            names={GALLERY_NEWS_NAMES}
            storyLink={STORY_LINK}
            buzzTrace={GALLERY_BUZZ_TRACE}
          />
        </Stack>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>No subject image</h3>
        <p className={styles['caption']}>A season story names nobody, so it has no picture.</p>
        <NewsHeroCard
          item={GALLERY_SEASON_STORY}
          names={GALLERY_NEWS_NAMES}
          storyLink={STORY_LINK}
          buzzTrace={GALLERY_BUZZ_TRACE}
        />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'news-hero-card',
  title: 'News hero card',
  group: 'Broadcast',
  notes:
    'A front-page story: kind tag in its tone, headline link, two lines of the body and buzz with its Why?.',
  render: () => <NewsHeroCardDemo />,
};
