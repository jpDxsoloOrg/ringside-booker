import { Stack } from '@/components/layout';
import { RivalRulesChip, RivalRulesList } from '@/screens/promotions/RivalRulesChip';
import type { GalleryEntry } from '../galleryEntry';
import { galleryLevelRules, galleryRules } from '../fixtures/rivalDesk';
import styles from './entries.module.css';

function RivalRulesChipDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>The chip: five shortcuts on, one turned off</h3>
        <p className={styles['caption']}>
          Opens the list in a popover on desktop and a bottom sheet on a phone.
        </p>
        <div>
          <RivalRulesChip rules={galleryRules} />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A game with the level playing field</h3>
        <div>
          <RivalRulesChip rules={galleryLevelRules} />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>The list it opens</h3>
        <RivalRulesList rules={galleryRules} />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'rival-rules-chip',
  title: 'Rival rules chip',
  group: 'Office',
  notes:
    'Beside the Promotions heading: how many of the computer’s shortcuts are on, or "Level playing field". The list shows each shortcut’s state (the score bonus as "+3"), its setting key and, while no feature acts on it yet, when it takes effect.',
  render: () => <RivalRulesChipDemo />,
};
