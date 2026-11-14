import { KpiCardGrid } from '@/components/KpiCard';
import { Stack } from '@/components/layout';
import { CashRunwayBannerView, CashRunwayCardView } from '@/screens/production/cashRunway';
import { galleryCashRunway } from '../fixtures/production';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

const STATUSES = ['tooEarly', 'makingMoney', 'losingMoney', 'runningOut', 'outOfCash'] as const;

function CashRunwayDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>
          The card in each state: before a week of play, making money, losing money, running out,
          out of cash
        </h3>
        <div className={office['stage']}>
          <KpiCardGrid label="Cash runway in each state">
            {STATUSES.map((status) => (
              <CashRunwayCardView key={status} runway={galleryCashRunway(status)} />
            ))}
          </KpiCardGrid>
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>The warning strip: losing money, running out</h3>
        <div className={office['stage']}>
          <Stack gap={3}>
            <CashRunwayBannerView runway={galleryCashRunway('losingMoney')} />
            <CashRunwayBannerView runway={galleryCashRunway('runningOut')} />
            <CashRunwayBannerView runway={galleryCashRunway('outOfCash')} />
          </Stack>
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'cash-runway',
  title: 'Cash runway',
  group: 'Office',
  notes:
    'The Cash runway card (Production header and Finances Overview) and the warning strip at the ' +
    'top of both screens, from hand-written answers (no engine). Each number has a Why?; the strip ' +
    'only shows while money goes out faster than it comes in.',
  render: () => <CashRunwayDemo />,
};
