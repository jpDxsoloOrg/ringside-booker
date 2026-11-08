import { Button } from '@/components/Button';
import { ChampionCard, ChampionCardList } from '@/components/ChampionCard';
import { classNames } from '@/components/classNames';
import { Stack } from '@/components/layout';
import { galleryChampionships } from '../fixtures/office';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

function ChampionCardDemo() {
  const [featured] = galleryChampionships;
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Title lineage</h3>
        <div className={office['stage']}>
          <ChampionCardList label="Champions">
            {galleryChampionships.map((championship) => (
              <ChampionCard
                key={championship.title.id}
                title={championship.title}
                reign={championship.reign}
                prestige={championship.prestige}
              />
            ))}
          </ChampionCardList>
        </div>
      </section>
      {featured === undefined ? null : (
        <section className={styles['example']}>
          <h3 className={styles['subheading']}>With a footer and a Why? chip, in a side column</h3>
          <div className={classNames(office['stage'], office['sideColumn'])}>
            <ChampionCard
              title={featured.title}
              reign={featured.reign}
              prestige={featured.prestige}
              footer="Next defence: Night of Lanterns"
              why={
                <Button size="sm" variant="ghost" iconStart="why" aria-label="Why? Prestige">
                  Why?
                </Button>
              }
            />
          </div>
        </section>
      )}
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'champion-card',
  title: 'ChampionCard',
  group: 'Office',
  notes:
    'Belt art in gold (unless the title has its own tier), the champion with their picture, reign length, defences and prestige as a number and stars. ChampionCardList is a grid on desktop and a horizontal swipe row on a phone.',
  render: () => <ChampionCardDemo />,
};
