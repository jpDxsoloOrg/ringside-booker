import { useState } from 'react';
import { NEWS_ITEM_NOT_FOUND } from '@ringside/engine';
import { Button } from '@/components/Button';
import { Cluster } from '@/components/layout';
import { NewsStorySheet } from '@/screens/news/NewsStorySheet';
import type { NewsStoryState } from '@/screens/news/NewsStorySheet';
import type { GalleryEntry } from '../galleryEntry';
import {
  GALLERY_BUZZ_TRACE,
  GALLERY_NEWS_NAMES,
  GALLERY_RECORD_STORY,
  GALLERY_RIVALRY_STORY,
} from '../fixtures/news';

const STORIES: Readonly<Record<string, NewsStoryState>> = {
  'A record story': { status: 'found', item: GALLERY_RECORD_STORY, names: GALLERY_NEWS_NAMES },
  'A story that leaves the archive': {
    status: 'found',
    item: GALLERY_RIVALRY_STORY,
    names: GALLERY_NEWS_NAMES,
  },
  'A story that has gone': { status: 'notFound', reason: NEWS_ITEM_NOT_FOUND },
};

function NewsStorySheetDemo() {
  const [open, setOpen] = useState<string | null>(null);
  const story = open === null ? undefined : STORIES[open];
  return (
    <>
      <Cluster gap={2}>
        {Object.keys(STORIES).map((label) => (
          <Button
            key={label}
            variant="secondary"
            onClick={() => {
              setOpen(label);
            }}
          >
            {label}
          </Button>
        ))}
      </Cluster>
      <NewsStorySheet
        open={story !== undefined}
        onClose={() => {
          setOpen(null);
        }}
        story={story ?? { status: 'loading' }}
        buzzTrace={GALLERY_BUZZ_TRACE}
      />
    </>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'news-story-sheet',
  title: 'News story sheet',
  group: 'Overlays',
  notes:
    'One story: a side sheet on desktop and a bottom sheet on a phone. The last one shows the reason the engine gives for a story that has gone.',
  render: () => <NewsStorySheetDemo />,
};
