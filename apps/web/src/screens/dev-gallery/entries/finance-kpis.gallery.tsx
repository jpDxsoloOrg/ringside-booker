import { KpiCardGrid } from '@/components/KpiCard';
import { Stack } from '@/components/layout';
import {
  CashKpiCard,
  CompanySizeKpiCard,
  PayrollKpiCard,
  ThisMonthKpiCard,
} from '@/screens/finances/kpis';
import {
  GALLERY_RED_START_MONTH,
  galleryCompanyLocal,
  galleryCompanyNational,
  galleryOverviewInTheBlack,
  galleryOverviewInTheRed,
} from '../fixtures/finance';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

function FinanceKpisDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A national company in the black, a year in</h3>
        <div className={office['stage']}>
          <KpiCardGrid label="Key numbers, in the black">
            <CashKpiCard overview={galleryOverviewInTheBlack} startMonth={null} />
            <ThisMonthKpiCard overview={galleryOverviewInTheBlack} />
            <PayrollKpiCard overview={galleryOverviewInTheBlack} />
            <CompanySizeKpiCard company={galleryCompanyNational} />
          </KpiCardGrid>
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>A local company in the red, nobody on a wage</h3>
        <div className={office['stage']}>
          <KpiCardGrid label="Key numbers, in the red">
            <CashKpiCard overview={galleryOverviewInTheRed} startMonth={GALLERY_RED_START_MONTH} />
            <ThisMonthKpiCard overview={galleryOverviewInTheRed} />
            <PayrollKpiCard overview={galleryOverviewInTheRed} />
            <CompanySizeKpiCard company={galleryCompanyLocal} />
          </KpiCardGrid>
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'finance-kpis',
  title: 'Finance KPIs',
  group: 'Office',
  notes:
    'The four built-in cards of Business > Finances > Overview, from hand-written answers (no engine). ' +
    'Negative cash is rose with its minus sign; a game under two months old says "No trend yet". ' +
    'The cash card has no Why? here because its breakdown is stored in the engine.',
  render: () => <FinanceKpisDemo />,
};
