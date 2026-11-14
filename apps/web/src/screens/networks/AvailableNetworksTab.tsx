import { useMemo } from 'react';
import { cents } from '@ringside/engine';
import type { NetworkCarriedDeal, NetworkRow } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber, useMoneyFormatter } from '@/components/format';
import type { MoneyFormatter } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { VerdictBadge } from './components/VerdictBadge';
import { NETWORK_KIND_LABELS, tierText } from './networkText';
import type { NetworksTabContext } from './registry';
import styles from './Networks.module.css';

const NO_ROWS: readonly NetworkRow[] = [];

export const AVAILABLE_INTRO = 'Networks that reach places where fans know you.';

/** "Ashlar Thursday · Ashlar Pro Wrestling": a deal a network carries, by name only. */
export function carriedText(deal: NetworkCarriedDeal): string {
  return `${deal.showName} · ${deal.promotionName}`;
}

/** Everything a network carries, or "Nothing yet". Names only: never anyone's money. */
export function carriesText(row: Pick<NetworkRow, 'carries'>): string {
  return row.carries.length === 0 ? 'Nothing yet' : row.carries.map(carriedText).join('; ');
}

/** "About $45,000 per show", "About $1.80 per buy", or the loss an airing would make. */
export function bestOfferText(row: NetworkRow, money: MoneyFormatter): string {
  const offer = row.bestOffer;
  if (offer === null) return 'Nothing to offer: every show you have is already on it';
  const pay = row.kind === 'ppv' ? null : `About ${money(cents(offer.feePerShow))} per show`;
  const loss =
    offer.incomePerAiring < 0 ? `loses ${money(cents(-offer.incomePerAiring))} an airing` : null;
  return [pay ?? 'Paid per buy', loss].filter((part) => part !== null).join(', ');
}

function rowId(row: NetworkRow): string {
  return row.networkId;
}

function rowLabel(row: NetworkRow): string {
  return row.name;
}

function availableColumns(
  money: MoneyFormatter,
  openPropose: NetworksTabContext['openPropose'],
): readonly ColumnDef<NetworkRow>[] {
  return [
    {
      id: 'logo',
      header: 'Logo',
      cell: (row) => (
        <ImageSlot
          subject={{
            kind: 'network',
            id: row.networkId,
            name: row.name,
            ...(row.logoRef === null ? {} : { imageRef: row.logoRef }),
          }}
          size="sm"
          decorative
        />
      ),
      width: 'xs',
      card: 'media',
      headerHidden: true,
      hideable: false,
    },
    {
      id: 'name',
      header: 'Network',
      cell: (row) => <span className={styles['strong']}>{row.name}</span>,
      sortValue: (row) => row.name,
      width: 'md',
      card: 'title',
    },
    {
      id: 'kind',
      header: 'Kind',
      cell: (row) => (
        <span className={styles['nowrap']}>
          {NETWORK_KIND_LABELS[row.kind]} · {tierText(row.reachTier)}
        </span>
      ),
      sortValue: (row) => row.reachTier,
      card: 'subtitle',
    },
    {
      id: 'coverage',
      header: 'Reaches',
      cell: (row) => `${row.coverageLabel} · ${formatNumber(row.coveredPopulation)} people`,
      sortValue: (row) => row.coveredPopulation,
      card: 'meta',
    },
    {
      id: 'carries',
      header: 'Carries',
      cell: (row) => <span className={styles['wrap']}>{carriesText(row)}</span>,
      card: 'meta',
    },
    {
      id: 'offer',
      header: 'Best offer',
      cell: (row) => (
        <span className={styles['offer']}>
          <span>{bestOfferText(row, money)}</span>
          {row.bestOffer !== null && (
            <VerdictBadge
              verdict={row.bestOffer.verdict}
              refusals={row.bestOffer.firstRefusal === null ? [] : [row.bestOffer.firstRefusal]}
              networkName={row.name}
            />
          )}
        </span>
      ),
      sortValue: (row) => row.bestOffer?.incomePerAiring ?? null,
      width: 'lg',
      card: 'stat',
    },
    {
      id: 'propose',
      header: 'Propose',
      cell: (row) => (
        <Button
          variant="secondary"
          size="sm"
          aria-haspopup="dialog"
          data-propose={row.networkId}
          onClick={() => {
            openPropose(row.networkId);
          }}
        >
          Propose
        </Button>
      ),
      card: 'meta',
      headerHidden: true,
      hideable: false,
    },
  ];
}

/**
 * Available networks: only networks that reach the promotion's regions, what each already carries
 * (rival shows by name, never their money), and the best offer it would make with its verdict.
 * Propose opens the Propose sheet (`?propose=`).
 */
export function AvailableNetworksTab({ promotionId, openPropose }: NetworksTabContext) {
  const networks = useEngineQuery(
    'broadcast.networks',
    { promotionId },
    { keepPreviousData: true },
  );
  const money = useMoneyFormatter();
  const columns = useMemo(() => availableColumns(money, openPropose), [money, openPropose]);

  if (networks.status === 'error') {
    return (
      <EmptyState
        icon="tv"
        title="The networks can't be shown"
        body={networks.error?.kind === 'rejected' ? networks.error.reasons[0]?.message : undefined}
        headingLevel={2}
      />
    );
  }

  return (
    <div className={styles['panel']}>
      <p className={styles['lead']}>{AVAILABLE_INTRO}</p>
      <DataTable
        rows={networks.data ?? NO_ROWS}
        columns={columns}
        getRowId={rowId}
        getRowLabel={rowLabel}
        caption="Available networks"
        loading={networks.status === 'loading'}
        emptyState={
          <EmptyState
            icon="tv"
            title="No network reaches your fans yet"
            body="Networks only deal with promotions that are known where they broadcast. Grow your popularity in a region to open its networks."
            headingLevel={2}
          />
        }
      />
    </div>
  );
}
