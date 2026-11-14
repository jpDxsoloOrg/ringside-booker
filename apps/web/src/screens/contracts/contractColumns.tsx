import type { ContractRow, ContractsTab } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { ContractStatusChip } from '@/components/ContractStatusChip';
import type { ColumnDef, SortState } from '@/components/DataTable';
import { formatGameDate, formatNumber } from '@/components/format';
import { Icon } from '@/components/Icon';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSubject } from '@/components/ImageSlot';
import { Explained } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import { EMPLOYMENT_ROLE_LABELS } from '@/screens/promotions/profile/tabs/RosterTab';
import { NO_VALUE, pushLabel } from '@/screens/roster/labels';
import {
  CONTRACT_KIND_LABELS,
  CONTRACT_PERK_LABELS,
  contractStatusesOf,
  NO_END_DATE,
  pushRank,
} from './contractLabels';
import styles from './ContractsScreen.module.css';
import type { ContractMoney } from './useContractMoney';

/** What the columns need besides the row. */
export interface ContractColumnContext {
  readonly money: ContractMoney;
  /** `contracts.expiringSoon.days`: an end this close draws in the warning tone. */
  readonly expiringSoonDays: number;
  /** `contracts.expiring.windowDays`: the Expiring tab's window. */
  readonly expiringWindowDays: number;
  /**
   * On a phone the name is a button that opens the contract and stretches over its card (the card
   * itself is not a button, so its Why? and Got it buttons are not nested in one). On desktop the
   * row opens it and the name links to the profile.
   */
  readonly isMobile: boolean;
  readonly onOpen: (row: ContractRow) => void;
  /** Marks one expiry notice as seen (the Expiring tab's Got it). */
  readonly onAcknowledge: (row: ContractRow) => void;
}

function portraitOf(row: ContractRow): ImageSubject {
  return {
    kind: 'person',
    id: row.personId,
    name: row.ringName,
    ...(row.imageRef === null ? {} : { imageRef: row.imageRef }),
  };
}

/** "$8,000/mo", "$300 per show", or both for a contract that pays a wage and a fee. */
export function wageText(
  row: Pick<ContractRow, 'monthlyWage' | 'perAppearanceFee'>,
  money: ContractMoney,
): string {
  const parts: string[] = [];
  if (row.monthlyWage > 0) parts.push(`${money(row.monthlyWage)}/mo`);
  if (row.perAppearanceFee > 0) parts.push(`${money(row.perAppearanceFee)} per show`);
  return parts.length === 0 ? money(0) : parts.join(' + ');
}

/** The date, and the days left under it (beside it on a phone card). */
function EndsCell({ row }: { readonly row: ContractRow }) {
  if (row.endsOn === null) return <span className={styles['none']}>{NO_END_DATE}</span>;
  return (
    <span className={styles['ends']}>
      <span className="tabular">{formatGameDate(row.endsOn)}</span>
      {row.daysLeft !== null && (
        <span className={styles['endsIn']}>
          {`${formatNumber(row.daysLeft)} ${row.daysLeft === 1 ? 'day' : 'days'}`}
        </span>
      )}
    </span>
  );
}

/** "Mid card wrestler", "Referee". */
export function roleText(row: Pick<ContractRow, 'role' | 'push'>): string {
  const role = EMPLOYMENT_ROLE_LABELS[row.role];
  const push = pushLabel(row.push);
  return push === NO_VALUE ? role : `${push} ${role.toLowerCase()}`;
}

/** The kind, with "Exclusive" after it when it rules out other promotions. */
function kindCell(row: ContractRow) {
  return (
    <span className={styles['kind']}>
      {CONTRACT_KIND_LABELS[row.kind]}
      {row.exclusive && <Badge tone="data">Exclusive</Badge>}
    </span>
  );
}

function perksCell(row: ContractRow) {
  if (row.perks.length === 0) return <span className={styles['none']}>No perks</span>;
  return (
    <span className={styles['badges']}>
      {row.perks.map((perk) => (
        <Badge key={perk}>{CONTRACT_PERK_LABELS[perk]}</Badge>
      ))}
    </span>
  );
}

function titlesCell(row: ContractRow) {
  if (row.titles.length === 0) return <span className={styles['none']}>{NO_VALUE}</span>;
  return (
    <span className={styles['badges']}>
      {row.titles.map((title) => (
        <Badge key={title.id} tone="prestige">
          <Icon name="titles" decorative size="sm" />
          {title.name}
        </Badge>
      ))}
    </span>
  );
}

function statusCell(row: ContractRow, context: ContractColumnContext) {
  const statuses = contractStatusesOf(row, context.expiringSoonDays, context.expiringWindowDays);
  return (
    <span className={styles['badges']}>
      {statuses.map((status) => (
        <ContractStatusChip key={status.kind} status={status} />
      ))}
    </span>
  );
}

function severanceCell(row: ContractRow) {
  if (row.severancePaid === null || row.severancePaid === 0) {
    return <span className={styles['none']}>None</span>;
  }
  return (
    <Explained
      value={row.severancePaid}
      unit="money"
      label={`${row.ringName}'s severance`}
      traceRef={row.severanceTraceRef}
    />
  );
}

/** The columns of one tab. Ended swaps the wage and the end date for how and when it ended. */
export function contractColumns(
  tab: ContractsTab,
  context: ContractColumnContext,
): readonly ColumnDef<ContractRow>[] {
  const { money } = context;
  const shared: ColumnDef<ContractRow>[] = [
    {
      id: 'portrait',
      header: 'Picture',
      cell: (row) => <ImageSlot subject={portraitOf(row)} size="sm" decorative />,
      width: 'xs',
      card: 'media',
      headerHidden: true,
    },
    {
      id: 'ringName',
      header: 'Name',
      cell: (row) => (
        <span className={styles['name']}>
          {context.isMobile ? (
            <button
              type="button"
              className={styles['nameButton']}
              aria-haspopup="dialog"
              onClick={() => {
                context.onOpen(row);
              }}
            >
              {row.ringName}
            </button>
          ) : (
            <WorkerLink personId={row.personId} name={row.ringName} truncate />
          )}
        </span>
      ),
      sortValue: (row) => row.ringName,
      filterValue: (row) => row.ringName,
      width: 'lg',
      card: 'title',
    },
    {
      id: 'role',
      header: 'Role',
      cell: (row) => <span className={styles['nowrap']}>{roleText(row)}</span>,
      sortValue: (row) => pushRank(row.push),
      filterValue: (row) => roleText(row),
      card: 'subtitle',
    },
    {
      id: 'kind',
      header: 'Kind',
      cell: kindCell,
      sortValue: (row) => CONTRACT_KIND_LABELS[row.kind],
      filterValue: () => null,
      card: 'meta',
    },
  ];
  if (tab === 'ended') {
    return [
      ...shared,
      {
        id: 'endedOn',
        header: 'Ended',
        cell: (row) => (row.endedOn === null ? NO_VALUE : `Ended ${formatGameDate(row.endedOn)}`),
        sortValue: (row) => row.endedOn,
        filterValue: () => null,
        card: 'stat',
      },
      {
        id: 'how',
        header: 'How',
        cell: (row) => statusCell(row, context),
        filterValue: () => null,
        card: 'stat',
      },
      {
        id: 'severance',
        header: 'Severance paid',
        cell: severanceCell,
        sortValue: (row) => row.severancePaid,
        filterValue: () => null,
        numeric: true,
        card: 'stat',
      },
    ];
  }
  const gotIt: ColumnDef<ContractRow>[] =
    tab === 'expiring'
      ? [
          {
            id: 'notice',
            header: 'Notice',
            cell: (row) =>
              row.notice === 'unseen' ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className={styles['nowrap']}
                  onClick={() => {
                    context.onAcknowledge(row);
                  }}
                >
                  Got it
                </Button>
              ) : (
                <span className={styles['none']}>Seen</span>
              ),
            filterValue: () => null,
            card: 'meta',
          },
        ]
      : [];
  return [
    ...shared,
    {
      id: 'wage',
      header: 'Wage',
      cell: (row) => (
        <span className={`tabular ${styles['nowrap'] ?? ''}`}>{wageText(row, money)}</span>
      ),
      sortValue: (row) => row.monthlyWage + row.perAppearanceFee * 4,
      filterValue: () => null,
      numeric: true,
      card: 'stat',
    },
    {
      id: 'endsOn',
      header: 'Ends',
      cell: (row) => <EndsCell row={row} />,
      sortValue: (row) => row.daysLeft,
      filterValue: () => null,
      card: 'stat',
    },
    {
      id: 'status',
      header: 'Status',
      cell: (row) => statusCell(row, context),
      filterValue: () => null,
      card: 'meta',
    },
    {
      id: 'perks',
      header: 'Perks',
      cell: perksCell,
      filterValue: () => null,
      card: 'meta',
    },
    {
      id: 'titles',
      header: 'Titles',
      cell: titlesCell,
      filterValue: (row) =>
        row.titles.length === 0 ? null : row.titles.map((title) => title.name).join(' '),
      card: 'meta',
    },
    ...gotIt,
  ];
}

/** Active by name, Expiring soonest first, Ended newest first (the engine's own orders). */
export function initialContractSort(tab: ContractsTab): SortState {
  switch (tab) {
    case 'active':
      return { columnId: 'ringName', direction: 'asc' };
    case 'expiring':
      return { columnId: 'endsOn', direction: 'asc' };
    case 'ended':
      return { columnId: 'endedOn', direction: 'desc' };
  }
}
