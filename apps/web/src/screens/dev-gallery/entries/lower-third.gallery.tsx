import { Stack } from '@/components/layout';
import { LiveBugButton } from '@/components/LiveBugButton';
import { LowerThird } from '@/components/LowerThird';
import { SegmentedMeter } from '@/components/SegmentedMeter';
import type { GalleryEntry } from '../galleryEntry';
import { BROADCAST_SIDES } from '../broadcastFixtures';
import styles from './entries.module.css';
import broadcast from './broadcast.module.css';

function LowerThirdDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Up next show card, with wedge</h3>
        <LowerThird
          kicker="Up next // In 3 days"
          title="Summit Thursday Night"
          headingLevel={4}
          badge="Episode 128"
          wedge
          meta={[
            { id: 'venue', icon: 'building', label: 'Harbor Arena' },
            { id: 'capacity', icon: 'ticket', label: 'Capacity 8,500' },
            { id: 'slot', icon: 'tv', label: 'Prime-time slot' },
          ]}
          footer={
            <>
              <span className={broadcast['footerFacts']}>Projected gate $340,000</span>
              <LiveBugButton live={false}>Manage card</LiveBugButton>
            </>
          }
        >
          <div className={broadcast['twoUp']}>
            <SegmentedMeter
              label="Card progress"
              value={4}
              max={6}
              segments={6}
              dangerFrom={6}
              valueText="4 / 6 slots"
            />
            <SegmentedMeter
              label="Broadcast hype"
              value={88}
              segments={8}
              dangerLabel="Hot"
              valueText="88%"
            />
          </div>
          <div className={broadcast['feud']}>
            <span className={broadcast['feudKicker']}>Hot feud // Main event</span>
            <span className={broadcast['feudLine']}>
              {`${BROADCAST_SIDES.mainChampion.name} vs ${BROADCAST_SIDES.mainChallenger.name}`}
            </span>
          </div>
        </LowerThird>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Results header (data accent, no wedge)</h3>
        <LowerThird
          kicker="Results // Taped in Denver"
          title="Saturday Night Slam 44"
          headingLevel={4}
          accent="data"
          meta={[
            { id: 'rating', label: 'Rating 78 / 100' },
            { id: 'crowd', label: 'Crowd 6,420' },
          ]}
        />
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Title change (prestige accent)</h3>
        <LowerThird
          kicker="And new"
          title={BROADCAST_SIDES.mainChallenger.name}
          headingLevel={4}
          accent="prestige"
          wedge
          meta={[{ id: 'title', icon: 'titles', label: 'Coastal Crown Champion' }]}
        />
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'lower-third',
  title: 'LowerThird',
  group: 'Broadcast',
  notes:
    'Kicker, big condensed title and a meta row split by //. Body and footer are slots: here they hold meters, a feud line and the main action.',
  render: () => <LowerThirdDemo />,
};
