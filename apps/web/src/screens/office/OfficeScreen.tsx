import { Link } from 'react-router-dom';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { routes } from '@/app/routes';
import { AlignmentChip } from '@/components/AlignmentChip';
import { Badge } from '@/components/Badge';
import { CardSlot } from '@/components/CardSlot';
import { ChamferPanel } from '@/components/ChamferPanel';
import { ChampionCard, ChampionCardList } from '@/components/ChampionCard';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { DeltaChip } from '@/components/DeltaChip';
import { formatPercent } from '@/components/format';
import { Icon } from '@/components/Icon';
import { ImageSlot } from '@/components/ImageSlot';
import { KpiCard, KpiCardGrid } from '@/components/KpiCard';
import { LowerThird } from '@/components/LowerThird';
import { Panel } from '@/components/Panel';
import { ScoreBug } from '@/components/ScoreBug';
import { SegmentedMeter } from '@/components/SegmentedMeter';
import styles from './OfficeScreen.module.css';
import {
  sampleCard,
  sampleChampionships,
  sampleKpis,
  sampleLastShow,
  sampleRosterLeaders,
  sampleShow,
} from './sampleDashboard';
import type { SampleKpi, SampleRosterLeader } from './sampleDashboard';

const SCREEN_TITLE = 'Dashboard';

const TREND_FORMATS = {
  share: (value: number) => formatPercent(value),
  millions: (value: number) => `${value.toFixed(2)}M`,
} as const;

function SampleKpiCard({ kpi }: { readonly kpi: SampleKpi }) {
  return (
    <KpiCard
      label={kpi.label}
      value={kpi.value}
      icon={kpi.icon}
      footer={kpi.footer}
      delta={{
        value: kpi.delta.value,
        ...(kpi.delta.display === undefined ? {} : { display: kpi.delta.display }),
        ...(kpi.delta.suffix === undefined ? {} : { suffix: kpi.delta.suffix }),
        ...(kpi.delta.goodWhen === undefined ? {} : { goodWhen: kpi.delta.goodWhen }),
      }}
      {...(kpi.unit === undefined ? {} : { unit: kpi.unit })}
      {...(kpi.trend === undefined
        ? {}
        : {
            trend: {
              values: kpi.trend.values,
              period: 'last 8 weeks',
              formatValue: TREND_FORMATS[kpi.trend.unit],
            },
          })}
    />
  );
}

const leaderColumns: readonly ColumnDef<SampleRosterLeader>[] = [
  {
    id: 'avatar',
    header: 'Picture',
    cell: (leader) => <ImageSlot subject={leader.person} size="sm" decorative />,
    width: 'xs',
    card: 'media',
    hideable: false,
  },
  {
    id: 'name',
    header: 'Wrestler',
    cell: (leader) => leader.person.name,
    sortValue: (leader) => leader.person.name,
    width: 'md',
    card: 'title',
  },
  {
    id: 'alignment',
    header: 'Side',
    cell: (leader) => <AlignmentChip alignment={leader.alignment} size="sm" />,
    sortValue: (leader) => leader.alignment,
    width: 'sm',
    card: 'subtitle',
  },
  {
    id: 'position',
    header: 'Role',
    cell: (leader) => leader.cardPosition,
    sortValue: (leader) => leader.cardPosition,
    width: 'sm',
    card: 'subtitle',
  },
  {
    id: 'popularity',
    header: 'Pop',
    cardLabel: 'Popularity',
    cell: (leader) => leader.popularity,
    sortValue: (leader) => leader.popularity,
    numeric: true,
    width: 'xs',
    card: 'stat',
  },
  {
    id: 'momentum',
    header: 'Mom',
    cardLabel: 'Momentum',
    cell: (leader) => <DeltaChip value={leader.momentum} variant="plain" />,
    sortValue: (leader) => leader.momentum,
    numeric: true,
    width: 'xs',
    card: 'stat',
  },
  {
    id: 'morale',
    header: 'Morale',
    cell: (leader) => leader.morale,
    sortValue: (leader) => leader.morale,
    numeric: true,
    width: 'xs',
    card: 'stat',
  },
  {
    id: 'contract',
    header: 'Deal',
    cardLabel: 'Deal left',
    cell: (leader) => `${String(leader.contractMonths)} mos`,
    sortValue: (leader) => leader.contractMonths,
    numeric: true,
    width: 'sm',
    card: 'stat',
  },
];

const getLeaderId = (leader: SampleRosterLeader): string => leader.id;

function UpNextCard() {
  return (
    <LowerThird
      kicker={sampleShow.kicker}
      title={sampleShow.title}
      badge={sampleShow.episode}
      wedge
      meta={[
        { id: 'venue', label: sampleShow.venue, icon: 'building' },
        { id: 'capacity', label: sampleShow.capacity, icon: 'ticket' },
        { id: 'slot', label: sampleShow.slot, icon: 'tv' },
      ]}
      footer={
        <div className={styles['upNextFooter']}>
          <p className={styles['projection']}>
            Projected gate{' '}
            <strong className={styles['projectionValue']}>{sampleShow.projectedGate}</strong>
          </p>
          <Link to={routes.game.booking()} className={styles['manageCard']}>
            <Icon name="booking" size="md" decorative />
            Manage card
          </Link>
        </div>
      }
    >
      <SegmentedMeter label="Card hype" value={sampleShow.hype} dangerFrom={75} dangerLabel="Hot" />
      <ol className={styles['slots']} aria-label="Card">
        {sampleCard.map((slot) => (
          <li key={slot.slotNumber}>
            <CardSlot
              slotNumber={slot.slotNumber}
              slotRole={slot.slotRole}
              chips={slot.chips}
              emptyHint="Book a match or a promo here."
              {...(slot.roleLabel === undefined ? {} : { roleLabel: slot.roleLabel })}
              {...(slot.sideA === undefined ? {} : { sideA: slot.sideA })}
              {...(slot.sideB === undefined ? {} : { sideB: slot.sideB })}
            />
          </li>
        ))}
      </ol>
    </LowerThird>
  );
}

function LastShow() {
  return (
    <ChamferPanel
      as="section"
      kicker={sampleLastShow.kicker}
      title={sampleLastShow.title}
      accent="data"
    >
      <ScoreBug
        label="Last show"
        stats={[
          {
            id: 'rating',
            label: 'Overall',
            value: sampleLastShow.rating,
            subValue: sampleLastShow.stars,
            tone: 'prestige',
            highlight: true,
          },
          {
            id: 'gate',
            label: 'Gate',
            value: sampleLastShow.gate,
            subValue: sampleLastShow.gateDetail,
          },
          {
            id: 'viewers',
            label: 'Viewers',
            value: sampleLastShow.viewers,
            subValue: sampleLastShow.viewersDetail,
          },
        ]}
      />
    </ChamferPanel>
  );
}

/**
 * The office dashboard, for now a placeholder built from the office and broadcast kits with
 * invented figures, so the look can be judged before real data arrives. A banner at the top says
 * so. The real dashboard replaces it screen by screen as its feature epics land.
 */
export function OfficeScreen() {
  useDocumentTitle(SCREEN_TITLE);

  return (
    <div className={styles['screen']} data-placeholder="true">
      <div className={styles['header']}>
        <div className={styles['headingGroup']}>
          <RouteHeading className={styles['heading']}>{SCREEN_TITLE}</RouteHeading>
          <p className={styles['subtitle']}>Week 11 · Season 2 · Front office overview</p>
        </div>
        <Badge tone="prestige">Placeholder</Badge>
      </div>

      <p className={styles['sampleNote']} role="note">
        <Icon name="info" size="md" className={styles['sampleNoteIcon']} decorative />
        <span>
          <strong>Sample data.</strong> Every name and number on this page is invented, so the look
          can be judged before your promotion&apos;s real figures arrive.
        </span>
      </p>

      <KpiCardGrid label="Key numbers">
        {sampleKpis.map((kpi) => (
          <SampleKpiCard key={kpi.id} kpi={kpi} />
        ))}
      </KpiCardGrid>

      <div className={styles['columns']}>
        <div className={styles['mainColumn']}>
          <UpNextCard />
          <LastShow />
        </div>
        <Panel title="Championships" className={styles['sideColumn']}>
          <ChampionCardList label="Champions">
            {sampleChampionships.map((championship) => (
              <ChampionCard
                key={championship.title.id}
                title={championship.title}
                reign={championship.reign}
                prestige={championship.prestige}
              />
            ))}
          </ChampionCardList>
        </Panel>
      </div>

      <Panel title="Roster leaders" padding="none">
        <DataTable
          rows={sampleRosterLeaders}
          columns={leaderColumns}
          getRowId={getLeaderId}
          caption="Roster leaders"
          density="compact"
          striped
          initialSort={{ columnId: 'popularity', direction: 'desc' }}
        />
      </Panel>
    </div>
  );
}
