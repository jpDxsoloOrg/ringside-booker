import { useMemo, useState } from 'react';
import { PUSH_LABELS } from '@ringside/engine';
import type {
  BrandId,
  EmploymentRole,
  PromotionRoster,
  PromotionRosterRow,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { AlignmentChip } from '@/components/AlignmentChip';
import { AvailabilityChip } from '@/components/AvailabilityChip';
import { Badge } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSubject } from '@/components/ImageSlot';
import { Select } from '@/components/Select';
import { StatBar } from '@/components/StatBar';
import { Explained } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import type { PromotionTabContext } from '../promotionTabs';
import styles from '../PromotionProfile.module.css';

/** The roles as the roster names them. */
export const EMPLOYMENT_ROLE_LABELS: Readonly<Record<EmploymentRole, string>> = {
  wrestler: 'Wrestler',
  manager: 'Manager',
  presenter: 'Presenter',
  announcer: 'Announcer',
  referee: 'Referee',
  producer: 'Producer',
  booker: 'Booker',
};

const NONE = '—';
const WHOLE_PROMOTION = 'all';
const NO_ROWS: readonly PromotionRosterRow[] = [];
const DEFAULT_SORT = { columnId: 'cardValue', direction: 'desc' } as const;

function portraitOf(row: PromotionRosterRow): ImageSubject {
  return {
    kind: 'person',
    id: row.personId,
    name: row.ringName,
    ...(row.imageRef === null ? {} : { imageRef: row.imageRef }),
  };
}

function rowId(row: PromotionRosterRow): string {
  return row.employmentId;
}

function rowLabel(row: PromotionRosterRow): string {
  return row.ringName;
}

/** The roster's columns; built per promotion, since the card value's Why? names it. */
function rosterColumns(promotionName: string): readonly ColumnDef<PromotionRosterRow>[] {
  return [
    {
      id: 'portrait',
      header: 'Picture',
      cell: (row) => <ImageSlot subject={portraitOf(row)} size="sm" decorative />,
      width: 'xs',
      card: 'media',
    },
    {
      id: 'ringName',
      header: 'Name',
      cell: (row) => (
        <span className={styles['nameCell']}>
          <WorkerLink personId={row.personId} name={row.ringName} truncate />
        </span>
      ),
      sortValue: (row) => row.ringName,
      width: 'lg',
      card: 'title',
    },
    {
      id: 'role',
      header: 'Role',
      cell: (row) => EMPLOYMENT_ROLE_LABELS[row.role],
      sortValue: (row) => EMPLOYMENT_ROLE_LABELS[row.role],
      card: 'subtitle',
    },
    {
      id: 'push',
      header: 'Push',
      cell: (row) => (row.push === 'none' ? NONE : PUSH_LABELS[row.push]),
      card: 'meta',
    },
    {
      id: 'alignment',
      header: 'Alignment',
      cell: (row) => (row.role === 'wrestler' ? <AlignmentChip alignment={row.alignment} /> : NONE),
      card: 'meta',
    },
    {
      id: 'availability',
      header: 'Availability',
      cell: (row) => <AvailabilityChip availability={row.availability} />,
      card: 'meta',
    },
    {
      id: 'overall',
      header: 'Overall',
      cell: (row) => formatNumber(row.overall.value, { maximumFractionDigits: 1 }),
      sortValue: (row) => row.overall.value,
      numeric: true,
      width: 'sm',
      card: 'stat',
    },
    {
      id: 'cardValue',
      header: 'Card value',
      cell: (row) =>
        row.cardValue === null ? (
          <span className={styles['none']}>{NONE}</span>
        ) : (
          <Explained
            value={Math.round(row.cardValue.value * 10) / 10}
            label={`Card value at ${promotionName}`}
            trace={row.cardValue.trace}
          />
        ),
      sortValue: (row) => row.cardValue?.value ?? null,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'champion',
      header: 'Champion',
      cell: (row) =>
        row.isChampion ? (
          <Badge tone="prestige">Champion</Badge>
        ) : (
          <span className={styles['none']}>{NONE}</span>
        ),
      sortValue: (row) => (row.isChampion ? 1 : 0),
      card: 'meta',
    },
    {
      id: 'endsOn',
      header: 'Contract ends',
      cardLabel: 'Ends',
      cell: (row) => (row.endsOn === null ? 'Open-ended' : formatGameDate(row.endsOn, 'short')),
      sortValue: (row) => row.endsOn,
      card: 'stat',
    },
  ];
}

function TasteStrip({ taste }: { readonly taste: PromotionRoster['taste'] }) {
  return (
    <section className={styles['taste']} aria-label="Taste">
      <h2 className={styles['factLabel']}>{taste.label}</h2>
      <ul className={styles['tasteAxes']}>
        {taste.axes.map((axis) => (
          <li key={axis.axis} className={styles['tasteAxis']}>
            <StatBar value={axis.value} label={axis.label} showValue={false} tone="data" />
            <Explained
              value={Math.round(axis.value)}
              label={`${axis.label} taste`}
              trace={axis.trace}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Everyone under contract with the promotion (or one brand), each with the card value the
 * promotion puts on them and its Why?, below the taste those values are weighed by. Most valued
 * first; crew have no card value. A phone shows the rows as cards with card value as a stat.
 */
export function RosterTab({ profile, promotionId }: PromotionTabContext) {
  const brands = profile.header.brands;
  const [brand, setBrand] = useState<string>(WHOLE_PROMOTION);
  const brandId = brands.find((option) => option.brandId === brand)?.brandId ?? null;
  const args = useMemo(
    (): { promotionId: typeof promotionId; brandId?: BrandId } =>
      brandId === null ? { promotionId } : { promotionId, brandId },
    [promotionId, brandId],
  );
  const roster = useEngineQuery('promotions.roster', args, { keepPreviousData: true });
  const columns = useMemo(() => rosterColumns(profile.header.name), [profile.header.name]);

  if (roster.status === 'error') {
    return (
      <div className={styles['tab']}>
        <EmptyState icon="users" size="inline" title="The roster could not be loaded" />
      </div>
    );
  }

  return (
    <div className={styles['tab']}>
      {brands.length > 0 && (
        <div className={styles['toolbar']}>
          <Select
            label="Brand"
            value={brand}
            onValueChange={setBrand}
            options={[
              { value: WHOLE_PROMOTION, label: 'Whole promotion' },
              ...brands.map((option) => ({ value: option.brandId, label: option.name })),
            ]}
          />
        </div>
      )}
      {roster.data !== undefined && <TasteStrip taste={roster.data.taste} />}
      <DataTable
        className={styles['rosterTable']}
        rows={roster.data?.rows ?? NO_ROWS}
        columns={columns}
        getRowId={rowId}
        getRowLabel={rowLabel}
        caption={`${profile.header.name} roster`}
        initialSort={DEFAULT_SORT}
        loading={roster.status === 'loading'}
        emptyState={
          <EmptyState
            icon="users"
            title="Nobody under contract"
            body="This promotion has no active contracts."
          />
        }
      />
    </div>
  );
}
