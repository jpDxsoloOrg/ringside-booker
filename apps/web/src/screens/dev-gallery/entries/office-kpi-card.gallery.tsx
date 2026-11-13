import { KpiCardGrid } from '@/components/KpiCard';
import { Stack } from '@/components/layout';
import { OfficeKpiCard } from '@/screens/office/OfficeKpiCard';
import {
  galleryCashKpi,
  galleryFirstDayPrestigeKpi,
  galleryNoMoraleKpi,
  galleryPopularityKpi,
  galleryRosterKpi,
} from '../fixtures/officeDashboard';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

function OfficeKpiCardDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>The Office&apos;s key numbers</h3>
        <div className={office['stage']}>
          <KpiCardGrid label="Office key numbers">
            <OfficeKpiCard kpi={galleryCashKpi} />
            <OfficeKpiCard kpi={galleryPopularityKpi} />
            <OfficeKpiCard kpi={galleryRosterKpi} />
            <OfficeKpiCard kpi={galleryNoMoraleKpi} />
            <OfficeKpiCard kpi={galleryFirstDayPrestigeKpi} />
          </KpiCardGrid>
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'office-kpi-card',
  title: 'OfficeKpiCard',
  group: 'Office',
  notes:
    'One office.dashboard KPI as a KpiCard, from hand-written answers (no engine): money in the ' +
    "viewer's money style, points to one decimal, counts whole. The change since last week has its " +
    'own Why?; the sparkline appears once there are two points. Nobody under contract shows "–" ' +
    'with no Why?, and a first-day card has no change and no line yet.',
  render: () => <OfficeKpiCardDemo />,
};
