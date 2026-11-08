import { Button } from '@/components/Button';
import { ChamferPanel } from '@/components/ChamferPanel';
import { Stack } from '@/components/layout';
import { SegmentedMeter } from '@/components/SegmentedMeter';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import broadcast from './broadcast.module.css';

function ChamferPanelDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>With kicker, title and actions</h3>
        <ChamferPanel
          as="section"
          kicker="Live sim"
          title="Show forecast"
          headingLevel={4}
          accent="action"
          actions={<Button size="sm">Rehearse</Button>}
        >
          <Stack gap={3}>
            <SegmentedMeter label="Production ceiling" value={82} dangerFrom={100} />
            <SegmentedMeter label="Broadcast hype" value={78} dangerLabel="Hot" valueText="78%" />
          </Stack>
        </ChamferPanel>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Accents and surfaces</h3>
        <div className={broadcast['twoUp']}>
          <ChamferPanel title="Data accent" headingLevel={4} accent="data">
            <p className={broadcast['paragraph']}>Numbers and forecasts.</p>
          </ChamferPanel>
          <ChamferPanel title="Prestige accent" headingLevel={4} accent="prestige">
            <p className={broadcast['paragraph']}>Titles and records.</p>
          </ChamferPanel>
          <ChamferPanel title="Raised, no accent" headingLevel={4} surface="raised">
            <p className={broadcast['paragraph']}>An active panel.</p>
          </ChamferPanel>
          <ChamferPanel padding="none">
            <p className={broadcast['paragraph']}>No header and no padding.</p>
          </ChamferPanel>
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'chamfer-panel',
  title: 'ChamferPanel',
  group: 'Broadcast',
  notes:
    'Square corners with the top-left and bottom-right cut at --chamfer. The hairline follows the cut. The office register uses Panel instead.',
  render: () => <ChamferPanelDemo />,
};
