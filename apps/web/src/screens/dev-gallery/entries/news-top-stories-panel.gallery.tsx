import { Stack } from '@/components/layout';
import { TopStoriesPanel } from '@/screens/news/officePanel';
import type { GalleryEntry } from '../galleryEntry';
import {
  GALLERY_ANNIVERSARY_STORY,
  GALLERY_BUZZ_TRACE,
  GALLERY_NEWS_NAMES,
  GALLERY_RECORD_STORY,
  GALLERY_RIVALRY_STORY,
} from '../fixtures/news';
import styles from './entries.module.css';

function TopStoriesPanelDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Three stories</h3>
        <TopStoriesPanel
          stories={[GALLERY_RECORD_STORY, GALLERY_RIVALRY_STORY, GALLERY_ANNIVERSARY_STORY]}
          names={GALLERY_NEWS_NAMES}
          buzzTrace={GALLERY_BUZZ_TRACE}
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>No news yet</h3>
        <TopStoriesPanel stories={[]} names={GALLERY_NEWS_NAMES} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'news-top-stories-panel',
  title: 'Top stories panel',
  group: 'Office',
  notes:
    "The Office's Top stories (DAY1-06): the front page's stories with kind, headline link and buzz, then Open news; No news yet before the first story.",
  render: () => <TopStoriesPanelDemo />,
};
