import { Button } from '@/components/Button';
import { Stack } from '@/components/layout';
import { ScoreBug } from '@/components/ScoreBug';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import broadcast from './broadcast.module.css';

function WhyChip({ about }: { readonly about: string }) {
  return (
    <Button size="sm" variant="ghost" iconStart="why" aria-label={`Why? ${about}`}>
      Why?
    </Button>
  );
}

function ScoreBugDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Four stats with Why? chips</h3>
        <div className={broadcast['stage']}>
          <ScoreBug
            label="Last show"
            stats={[
              {
                id: 'overall',
                label: 'Overall',
                value: '78',
                subValue: '3.75 stars',
                why: <WhyChip about="Overall" />,
              },
              {
                id: 'gate',
                label: 'Gate',
                value: '91.7%',
                subValue: '6,420 / 7,000',
                why: <WhyChip about="Gate" />,
              },
              {
                id: 'viewers',
                label: 'Viewers',
                value: '1.1M',
                subValue: 'Best this season',
                tone: 'prestige',
                highlight: true,
                why: <WhyChip about="Viewers" />,
              },
              { id: 'net', label: 'Net revenue', value: '+$218K', tone: 'neutral' },
            ]}
          />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Three stats</h3>
        <div className={broadcast['stage']}>
          <ScoreBug
            label="Forecast"
            stats={[
              { id: 'score', label: 'Predicted score', value: '74', subValue: 'Range 68–80' },
              { id: 'grade', label: 'Grade', value: 'B−', tone: 'prestige' },
              { id: 'risk', label: 'Injury risk', value: 'High', tone: 'action' },
            ]}
          />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Two stats</h3>
        <div className={broadcast['stage']}>
          <ScoreBug
            label="Projection"
            stats={[
              { id: 'rating', label: 'Projected rating', value: '2.45M' },
              { id: 'card', label: 'Card completion', value: '67%', tone: 'prestige' },
            ]}
          />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'score-bug',
  title: 'ScoreBug',
  group: 'Broadcast',
  notes:
    'Two to four numbers (the type refuses more). On a phone four stats wrap to 2×2. The Why? chip is a slot; these chips are stand-ins until the Why? panel lands.',
  render: () => <ScoreBugDemo />,
};
