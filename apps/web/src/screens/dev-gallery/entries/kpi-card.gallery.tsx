import { Button } from '@/components/Button';
import { formatPercent } from '@/components/format';
import { KpiCard, KpiCardGrid } from '@/components/KpiCard';
import { Stack } from '@/components/layout';
import {
  GALLERY_ATTENDANCE_WEEKS,
  GALLERY_MORALE_WEEKS,
  GALLERY_VIEWER_WEEKS,
} from '../fixtures/office';
import type { GalleryEntry } from '../galleryEntry';
import styles from './entries.module.css';
import office from './office.module.css';

function WhyChip({ about }: { readonly about: string }) {
  return (
    <Button size="sm" variant="ghost" iconStart="why" aria-label={`Why? ${about}`}>
      Why?
    </Button>
  );
}

function formatMillions(millions: number): string {
  return `${millions.toFixed(2)}M`;
}

function formatShare(share: number): string {
  return formatPercent(share);
}

function KpiCardDemo() {
  return (
    <Stack gap={5}>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Office dashboard row</h3>
        <div className={office['stage']}>
          <KpiCardGrid label="Key numbers">
            <KpiCard
              label="Avg show score"
              value="74"
              icon="star"
              delta={{
                value: 3,
                suffix: 'vs last month',
                why: <WhyChip about="the change in avg show score" />,
              }}
              footer="Regional benchmark 68"
              why={<WhyChip about="Avg show score" />}
            />
            <KpiCard
              label="Avg attendance"
              value="92%"
              icon="ticket"
              delta={{ value: 0.042, display: '+4.2%' }}
              trend={{
                values: GALLERY_ATTENDANCE_WEEKS,
                period: 'last 8 weeks',
                formatValue: formatShare,
              }}
              footer="8,280 / 9,000 seats"
            />
            <KpiCard
              label="TV viewers"
              value="1.1M"
              icon="tv"
              delta={{ value: 0.08, display: '+8%' }}
              trend={{
                values: GALLERY_VIEWER_WEEKS,
                period: 'last 8 weeks',
                tone: 'positive',
                formatValue: formatMillions,
              }}
              footer="Thursday prime time"
            />
            <KpiCard
              label="Monthly payroll"
              value="$410K"
              icon="money"
              delta={{ value: -12_000, display: '−$12K', goodWhen: 'down' }}
              footer="Budget cap $550K"
            />
            <KpiCard
              label="Locker room morale"
              value="81"
              unit="/100"
              icon="users"
              delta={{ value: -1 }}
              trend={{ values: GALLERY_MORALE_WEEKS, period: 'last 8 weeks', tone: 'auto' }}
              footer="Settled"
            />
          </KpiCardGrid>
        </div>
      </section>
      <section className={styles['example']}>
        <h3 className={styles['subheading']}>Tones, no change, and a bare card</h3>
        <div className={office['stage']}>
          <KpiCardGrid label="More examples">
            <KpiCard label="Best rating" value="91" tone="prestige" footer="Season record" />
            <KpiCard label="Live viewers" value="48,210" tone="data" delta={{ value: 0 }} />
            <KpiCard label="Cash" value="$1.24M" />
          </KpiCardGrid>
        </div>
      </section>
    </Stack>
  );
}

export const galleryEntry: GalleryEntry = {
  id: 'kpi-card',
  title: 'KpiCard',
  group: 'Office',
  notes:
    'Label, big tabular number, delta chip and an optional sparkline. KpiCardGrid fits as many as the row allows on desktop and goes 2-up on a phone. Payroll shows "better lower": a fall in the positive colour. The first card has a Why? for its change as well (delta.why).',
  render: () => <KpiCardDemo />,
};
