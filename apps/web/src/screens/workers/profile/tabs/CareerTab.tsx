import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { PUSH_LABELS, RATING_ROLE_LABELS } from '@ringside/engine';
import type {
  EmploymentStatus,
  GameDate,
  ReignEndReason,
  TeamKind,
  TeamStatus,
  WorkerProfileContract,
  WorkerProfilePartner,
  WorkerProfileReign,
  WorkerProfileTeam,
} from '@ringside/engine';
import { AlignmentChip } from '@/components/AlignmentChip';
import { Badge } from '@/components/Badge';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatNumber, formatSigned, useMoneyFormatter } from '@/components/format';
import type { MoneyFormatter } from '@/components/format';
import { Panel } from '@/components/Panel';
import { WorkerLink } from '@/components/WorkerLink';
import type { ProfileTabContext } from '../profileTabs';
import styles from '../WorkerProfile.module.css';

/** What a figure the viewer may not see reads as. */
export const PRIVATE_TEXT = 'Private';

const NO_VALUE = '—';

const CONTRACT_STATUS_LABELS: Readonly<Record<EmploymentStatus, string>> = {
  offered: 'Offered',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  signed: 'Signed',
  active: 'Active',
  expired: 'Expired',
  released: 'Released',
  quit: 'Quit',
};

const REIGN_END_LABELS: Readonly<Record<ReignEndReason, string>> = {
  lost: 'Lost the title',
  vacated: 'Vacated',
  stripped: 'Stripped',
  retired: 'Title retired',
  unified: 'Title unified',
};

const TEAM_KIND_LABELS: Readonly<Record<TeamKind, string>> = { tag: 'Tag team', trio: 'Trio' };

const TEAM_STATUS_LABELS: Readonly<Record<TeamStatus, string>> = {
  active: 'Active',
  inactive: 'Inactive',
  split: 'Split',
};

function dateText(date: GameDate | null, whenNull: string): string {
  return date === null ? whenNull : formatGameDate(date);
}

/** What a contract pays, or "Private" when the viewer may not know. */
export function wageText(contract: WorkerProfileContract, formatMoney: MoneyFormatter): string {
  const { terms } = contract;
  if (terms === null) return PRIVATE_TEXT;
  if (terms.kind === 'perAppearance') {
    return `${formatMoney(terms.perAppearanceFee, { style: 'full' })} per show`;
  }
  return `${formatMoney(terms.monthlyWage, { style: 'full' })} per month`;
}

/** The day a contract stopped, or is due to: ended, else its end date, else open-ended. */
function contractEndText(contract: WorkerProfileContract): string {
  if (contract.endedOn !== null) return formatGameDate(contract.endedOn);
  return dateText(contract.endsOn, 'Open-ended');
}

function partnerLinks(partners: readonly WorkerProfilePartner[]): ReactNode {
  if (partners.length === 0) return NO_VALUE;
  return (
    <span className={styles['partners']}>
      {partners.map((partner) => (
        <WorkerLink key={partner.personId} personId={partner.personId} name={partner.name} />
      ))}
    </span>
  );
}

function partnerNames(partners: readonly WorkerProfilePartner[]): string {
  return partners.map((partner) => partner.name).join(', ');
}

function contractColumns(formatMoney: MoneyFormatter): readonly ColumnDef<WorkerProfileContract>[] {
  return [
    {
      id: 'promotion',
      header: 'Promotion',
      card: 'title',
      cell: (contract) => contract.promotionName,
      filterValue: (contract) => contract.promotionName,
    },
    {
      id: 'role',
      header: 'Role',
      card: 'subtitle',
      cell: (contract) => `${RATING_ROLE_LABELS[contract.role]} as ${contract.ringName}`,
    },
    {
      id: 'status',
      header: 'Status',
      card: 'meta',
      cell: (contract) => (
        <Badge tone={contract.status === 'active' ? 'positive' : 'neutral'}>
          {CONTRACT_STATUS_LABELS[contract.status]}
        </Badge>
      ),
    },
    {
      id: 'from',
      header: 'From',
      card: 'stat',
      cell: (contract) => formatGameDate(contract.startsOn),
    },
    {
      id: 'until',
      header: 'Until',
      card: 'stat',
      cell: (contract) => contractEndText(contract),
    },
    {
      id: 'push',
      header: 'Push',
      card: 'stat',
      cell: (contract) => PUSH_LABELS[contract.push],
    },
    {
      id: 'alignment',
      header: 'Alignment',
      card: 'meta',
      cell: (contract) => <AlignmentChip alignment={contract.alignment} size="sm" />,
    },
    {
      id: 'wage',
      header: 'Wage',
      card: 'stat',
      cell: (contract) => wageText(contract, formatMoney),
    },
    {
      id: 'morale',
      header: 'Morale',
      card: 'stat',
      cell: (contract) =>
        contract.morale === null ? PRIVATE_TEXT : formatSigned(Math.round(contract.morale)),
    },
    {
      id: 'momentum',
      header: 'Momentum',
      card: 'stat',
      cell: (contract) =>
        contract.momentum === null ? NO_VALUE : formatSigned(Math.round(contract.momentum)),
    },
  ];
}

const REIGN_COLUMNS: readonly ColumnDef<WorkerProfileReign>[] = [
  {
    id: 'title',
    header: 'Title',
    card: 'title',
    cell: (reign) => reign.titleName,
    filterValue: (reign) => reign.titleName,
  },
  {
    id: 'promotion',
    header: 'Promotion',
    card: 'subtitle',
    cell: (reign) => reign.promotionName,
  },
  { id: 'won', header: 'Won', card: 'stat', cell: (reign) => formatGameDate(reign.wonOn) },
  {
    id: 'lost',
    header: 'Lost',
    card: 'stat',
    cell: (reign) => dateText(reign.lostOn, 'Current champion'),
  },
  {
    id: 'days',
    header: 'Days held',
    cardLabel: 'Days',
    card: 'stat',
    numeric: true,
    cell: (reign) => formatNumber(reign.daysHeld),
  },
  {
    id: 'defences',
    header: 'Defences',
    card: 'stat',
    numeric: true,
    cell: (reign) => formatNumber(reign.defences),
  },
  {
    id: 'ended',
    header: 'How it ended',
    cardLabel: 'Ended',
    card: 'stat',
    cell: (reign) =>
      reign.endReason === null ? 'Still champion' : REIGN_END_LABELS[reign.endReason],
  },
  {
    id: 'partners',
    header: 'With',
    card: 'meta',
    cell: (reign) => partnerLinks(reign.partners),
    filterValue: (reign) => partnerNames(reign.partners),
  },
];

const TEAM_COLUMNS: readonly ColumnDef<WorkerProfileTeam>[] = [
  {
    id: 'name',
    header: 'Team',
    card: 'title',
    cell: (team) => team.name,
    filterValue: (team) => team.name,
  },
  { id: 'kind', header: 'Kind', card: 'subtitle', cell: (team) => TEAM_KIND_LABELS[team.kind] },
  {
    id: 'status',
    header: 'Status',
    card: 'meta',
    cell: (team) => (
      <Badge tone={team.status === 'active' ? 'positive' : 'neutral'}>
        {TEAM_STATUS_LABELS[team.status]}
      </Badge>
    ),
  },
  {
    id: 'partners',
    header: 'With',
    card: 'stat',
    cell: (team) => partnerLinks(team.partners),
    filterValue: (team) => partnerNames(team.partners),
  },
  { id: 'formed', header: 'Formed', card: 'stat', cell: (team) => formatGameDate(team.formedOn) },
  {
    id: 'split',
    header: 'Split',
    card: 'stat',
    cell: (team) => dateText(team.splitOn, NO_VALUE),
  },
];

/** Contracts, title reigns and teams, each newest first. */
export function CareerTab({ profile }: ProfileTabContext) {
  const formatMoney = useMoneyFormatter();
  const { contracts, reigns, teams } = profile.career;
  const { ringName } = profile.header;
  const columns = useMemo(() => contractColumns(formatMoney), [formatMoney]);
  const somethingPrivate = profile.hidden.length > 0;

  return (
    <div className={styles['career']}>
      <Panel
        title="Contracts"
        headingLevel={2}
        padding="none"
        {...(somethingPrivate
          ? { subtitle: 'Other promotions keep their wages and morale to themselves.' }
          : {})}
      >
        {contracts.length === 0 ? (
          <EmptyState title="No contracts yet" body="They have never been under contract." />
        ) : (
          <DataTable
            rows={contracts}
            columns={columns}
            getRowId={(contract) => contract.employmentId}
            caption={`Contracts of ${ringName}`}
            sortable={false}
            density="compact"
          />
        )}
      </Panel>

      <Panel title="Title reigns" headingLevel={2} padding="none">
        {reigns.length === 0 ? (
          <EmptyState title="No title reigns yet" />
        ) : (
          <DataTable
            rows={reigns}
            columns={REIGN_COLUMNS}
            getRowId={(reign) => reign.reignId}
            caption={`Title reigns of ${ringName}`}
            sortable={false}
            density="compact"
          />
        )}
      </Panel>

      <Panel title="Teams" headingLevel={2} padding="none">
        {teams.length === 0 ? (
          <EmptyState title="No teams yet" />
        ) : (
          <DataTable
            rows={teams}
            columns={TEAM_COLUMNS}
            getRowId={(team) => team.teamId}
            caption={`Teams of ${ringName}`}
            sortable={false}
            density="compact"
          />
        )}
      </Panel>
    </div>
  );
}
