import { Stack } from '@/components/layout';
import { ChampionsPanel } from '@/screens/titles/officePanel';
import type { GalleryEntry } from '../galleryEntry';
import { galleryChampionRows } from '../fixtures/champions';
import styles from './entries.module.css';
import officeStyles from './office.module.css';

function ChampionsDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A champion, a tag team and a vacant title</h3>
        <div className={officeStyles['sideColumn']}>
          <ChampionsPanel rows={galleryChampionRows} />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>No active titles</h3>
        <div className={officeStyles['sideColumn']}>
          <ChampionsPanel rows={[]} />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'champions-office-panel',
  title: 'Champions (Office panel)',
  group: 'Office',
  notes:
    "The Office's side panel, fed by titles.list { scope: 'own', status: 'active' } across every " +
    'brand: one title card per title (name linking to the title page, champion to their profile, ' +
    'prestige with its Why?), then "All titles". On a phone the cards are a swipe row.',
  render: () => <ChampionsDemo />,
};
