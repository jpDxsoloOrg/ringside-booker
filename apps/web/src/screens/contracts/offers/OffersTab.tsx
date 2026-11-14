import { useCallback, useMemo, useState } from 'react';
import type { OfferRow, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge, CountBadge } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { Switch } from '@/components/Switch';
import { WhyButton } from '@/components/Trace';
import { useSessionStore } from '@/app/session/sessionStore';
import { useIsMobile } from '@/styles/useMediaQuery';
import type { NegotiationTarget } from '../contractsParams';
import { offerDueText, offerStatusText, offerSummaryText } from '../negotiation/negotiationText';
import { useContractMoney } from '../useContractMoney';
import styles from '../ContractsScreen.module.css';

const NO_ROWS: readonly OfferRow[] = [];

export interface OffersTabProps {
  readonly promotionId: PromotionId;
  readonly openNegotiation: (target: NegotiationTarget) => void;
}

/** "Open offers" / "Closed offers": the empty state of each list. */
export const NO_OPEN_OFFERS_TEXT = 'No open offers. Make one from Free agents or Renew.';
export const NO_CLOSED_OFFERS_TEXT = 'No closed talks yet';

/**
 * Contracts › Offers (ECO5-06): your talks, open or closed, each with its state in plain words
 * ("Countered: answer by Jan 14, 2027", "Signed with Crown Pro instead"), the terms on the table,
 * the day something happens next and, once closed, the outcome's Why? (the review, with other
 * promotions' offers hidden). A row opens the Negotiation Sheet.
 */
export function OffersTab({ promotionId, openNegotiation }: OffersTabProps) {
  const money = useContractMoney();
  const isMobile = useIsMobile();
  const [closed, setClosed] = useState(false);
  const query = useEngineQuery(
    'contracts.offers',
    { promotionId, status: closed ? 'closed' : 'open' },
    { keepPreviousData: true },
  );
  const rows = (query.status === 'success' ? query.data : undefined) ?? NO_ROWS;
  const open = useCallback(
    (row: OfferRow): void => {
      openNegotiation({ kind: 'talks', negotiationId: row.negotiationId });
    },
    [openNegotiation],
  );

  const columns = useMemo<readonly ColumnDef<OfferRow>[]>(
    () => [
      {
        id: 'portrait',
        header: 'Picture',
        cell: (row) => (
          <ImageSlot
            subject={{
              kind: 'person',
              id: row.personId,
              name: row.ringName,
              ...(row.imageRef === null ? {} : { imageRef: row.imageRef }),
            }}
            size="sm"
            decorative
          />
        ),
        width: 'xs',
        card: 'media',
        headerHidden: true,
      },
      {
        id: 'worker',
        header: 'Worker',
        cell: (row) => (
          <button
            type="button"
            className={styles['nameButton']}
            aria-haspopup="dialog"
            onClick={() => {
              open(row);
            }}
          >
            {row.ringName}
          </button>
        ),
        sortValue: (row) => row.ringName,
        filterValue: (row) => row.ringName,
        width: 'lg',
        card: 'title',
      },
      {
        id: 'kind',
        header: 'Kind',
        cell: (row) => <Badge>{row.kind === 'renewal' ? 'Renewal' : 'New'}</Badge>,
        sortValue: (row) => row.kind,
        filterValue: (row) => (row.kind === 'renewal' ? 'Renewal' : 'New'),
        card: 'meta',
      },
      {
        id: 'round',
        header: 'Round',
        cell: (row) => <span className="tabular">{formatNumber(row.round)}</span>,
        sortValue: (row) => row.round,
        filterValue: () => null,
        numeric: true,
        card: 'hidden',
      },
      {
        id: 'status',
        header: 'Status',
        cell: (row) => (
          <span className={styles['badges']}>
            {offerStatusText(row)}
            {row.reviewTrace !== null && (
              <WhyButton
                label={`${row.ringName}'s decision`}
                value={offerStatusText(row)}
                source={{ trace: row.reviewTrace }}
                buttonLabel={`Why: ${offerStatusText(row)}?`}
              />
            )}
          </span>
        ),
        filterValue: (row) => offerStatusText(row),
        card: 'subtitle',
      },
      {
        id: 'terms',
        header: 'On the table',
        cell: (row) => offerSummaryText({ ...row.offerSummary, terms: row.offerSummary }, money),
        filterValue: () => null,
        card: 'stat',
      },
      {
        id: 'due',
        header: 'Next',
        cell: (row) => offerDueText(row) ?? <span className={styles['none']}>—</span>,
        filterValue: () => null,
        card: 'meta',
      },
    ],
    [money, open],
  );

  return (
    <div className={styles['panel']}>
      <div className={styles['filters']}>
        <Switch label="Closed talks" checked={closed} onCheckedChange={setClosed} />
      </div>
      <DataTable
        className={styles['table']}
        rows={rows}
        columns={columns}
        getRowId={(row) => row.negotiationId}
        getRowLabel={(row) => row.ringName}
        caption={closed ? 'Closed offers' : 'Open offers'}
        filterable
        filterLabel="Find talks"
        density="compact"
        loading={query.status === 'loading'}
        {...(isMobile ? {} : { onActivate: open })}
        emptyState={
          <EmptyState
            icon="contracts"
            title={closed ? NO_CLOSED_OFFERS_TEXT : NO_OPEN_OFFERS_TEXT}
          />
        }
      />
    </div>
  );
}

/** The Offers tab's badge: how many counter-offers wait for your answer. */
export function CounteredOffersBadge() {
  const promotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  if (promotionId === null) return null;
  return <CounteredCount promotionId={promotionId} />;
}

function CounteredCount({ promotionId }: { readonly promotionId: PromotionId }) {
  const query = useEngineQuery(
    'contracts.offers',
    { promotionId, status: 'open' },
    { keepPreviousData: true },
  );
  const countered = (query.data ?? NO_ROWS).filter((row) => row.status === 'countered').length;
  return <CountBadge count={countered} label={`${String(countered)} countered`} tone="action" />;
}
