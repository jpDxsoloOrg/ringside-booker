import { DeltaChip } from '@/components/DeltaChip';
import { Stack } from '@/components/layout';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

function DeltaChipDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Chip</h3>
        <div className={office['chipRow']}>
          <DeltaChip value={3} suffix="vs last month" />
          <DeltaChip value={-2} />
          <DeltaChip value={0} />
          <DeltaChip value={0.042} display="+4.2%" />
          <DeltaChip value={48_500} display="+$48.5K" suffix="a week" />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Better lower (payroll, injuries)</h3>
        <div className={office['chipRow']}>
          <DeltaChip value={-12_000} display="−$12K" goodWhen="down" suffix="saved" />
          <DeltaChip value={2} goodWhen="down" suffix="injured" />
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Plain, for table cells</h3>
        <div className={office['chipRow']}>
          <DeltaChip value={5} variant="plain" />
          <DeltaChip value={11} variant="plain" />
          <DeltaChip value={-4} variant="plain" />
          <DeltaChip value={0} variant="plain" />
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'delta-chip',
  title: 'DeltaChip',
  group: 'Office',
  notes:
    'Arrow, sign and colour together, never colour alone. Down is rose, not the action red, so a drop never reads as "press this".',
  render: () => <DeltaChipDemo />,
};
