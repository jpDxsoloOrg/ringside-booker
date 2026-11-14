import { useCallback, useMemo, useState } from 'react';
import { STYLE_LABELS } from '@ringside/engine';
import type { EmploymentRole, FreeAgentRow, PromotionId } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Badge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import type { ColumnDef } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Explained, traceQuery } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import { EMPLOYMENT_ROLE_LABELS } from '@/screens/promotions/profile/tabs/RosterTab';
import { WORKER_ROLE_LABELS } from '@/screens/workers/workerLabels';
import { useIsMobile } from '@/styles/useMediaQuery';
import type { NegotiationTarget } from '../contractsParams';
import { cooldownReason, situationText, talksStateText } from '../negotiation/negotiationText';
import { useContractMoney } from '../useContractMoney';
import type { ContractMoney } from '../useContractMoney';
import styles from '../ContractsScreen.module.css';

/** What the tab says when nobody matches. */
export const NO_FREE_AGENTS_TEXT = 'No free agents match';

const ALL = 'all';
const ROLE_FILTERS: readonly EmploymentRole[] = [
  'wrestler',
  'manager',
  'presenter',
  'announcer',
  'referee',
  'producer',
];
const NO_ROWS: readonly FreeAgentRow[] = [];

export interface FreeAgentsTabProps {
  readonly promotionId: PromotionId;
  readonly openNegotiation: (target: NegotiationTarget) => void;
}

/** "$41,300/mo" or "$600 an appearance", by the kind you may offer first; null when neither. */
export function askText(row: FreeAgentRow, money: ContractMoney): string | null {
  if (row.bestKind === 'perAppearance' && row.askPerAppearance !== null) {
    return `${money(row.askPerAppearance)} an appearance`;
  }
  if (row.askMonthly !== null) return `${money(row.askMonthly)}/mo`;
  if (row.askPerAppearance !== null) return `${money(row.askPerAppearance)} an appearance`;
  return null;
}

/** The target a row's button opens: their talks with you, or a new offer. */
function targetOf(row: FreeAgentRow): NegotiationTarget {
  return row.openNegotiationId === null
    ? { kind: 'signing', personId: row.personId }
    : { kind: 'talks', negotiationId: row.openNegotiationId };
}

function AskCell({
  row,
  promotionId,
  money,
}: {
  readonly row: FreeAgentRow;
  readonly promotionId: PromotionId;
  readonly money: ContractMoney;
}) {
  const text = askText(row, money);
  if (text === null) return <span className={styles['none']}>None you can offer</span>;
  const perAppearance =
    row.bestKind === 'perAppearance' || (row.askMonthly === null && row.askPerAppearance !== null);
  return (
    <span className={styles['nowrap']}>
      <Explained
        value={text}
        label={`${row.ringName}'s ask`}
        traceQuery={traceQuery(
          'contracts.askingTerms',
          {
            promotionId,
            personId: row.personId,
            kind: perAppearance ? 'perAppearance' : 'written',
          },
          (ask) => (perAppearance ? ask.perAppearanceFee.trace : ask.monthlyWage.trace),
        )}
      />
    </span>
  );
}

function ActionCell({
  row,
  onOpen,
}: {
  readonly row: FreeAgentRow;
  readonly onOpen: (row: FreeAgentRow) => void;
}) {
  if (row.openNegotiationId !== null) {
    return (
      <Button
        size="sm"
        variant="secondary"
        className={styles['nowrap']}
        onClick={() => {
          onOpen(row);
        }}
      >
        Open talks
      </Button>
    );
  }
  if (row.cooldownUntil !== null) {
    return (
      <span className={styles['disabledAction']}>
        <Button size="sm" variant="secondary" disabled className={styles['nowrap']}>
          Make offer
        </Button>
        <span className={styles['reason']}>{cooldownReason(row.cooldownUntil)}</span>
      </span>
    );
  }
  return (
    <Button
      size="sm"
      variant="primary"
      className={styles['nowrap']}
      onClick={() => {
        onOpen(row);
      }}
    >
      Make offer
    </Button>
  );
}

/**
 * Contracts › Free agents (ECO5-06): everyone your promotion may talk to, with what they would
 * ask of you (a Why? loads the breakdown when opened), where they are now, whether you are talking
 * or they are cooling off, how many other promotions are bidding (never what those offer), and
 * Make offer or Open talks.
 */
export function FreeAgentsTab({ promotionId, openNegotiation }: FreeAgentsTabProps) {
  const money = useContractMoney();
  const isMobile = useIsMobile();
  const [role, setRole] = useState<string>(ALL);
  const [situation, setSituation] = useState<'freeAgent' | 'all'>('all');
  const pickedRole = ROLE_FILTERS.find((entry) => entry === role);
  const query = useEngineQuery(
    'contracts.freeAgents',
    {
      promotionId,
      situation,
      ...(pickedRole === undefined ? {} : { role: pickedRole }),
    },
    { keepPreviousData: true },
  );
  const rows = (query.status === 'success' ? query.data : undefined) ?? NO_ROWS;

  const open = useCallback(
    (row: FreeAgentRow): void => {
      if (row.cooldownUntil !== null && row.openNegotiationId === null) return;
      openNegotiation(targetOf(row));
    },
    [openNegotiation],
  );

  const roleOptions: readonly SelectOption[] = [
    { value: ALL, label: 'All roles' },
    ...ROLE_FILTERS.map((value) => ({ value, label: EMPLOYMENT_ROLE_LABELS[value] })),
  ];
  const situationOptions: readonly SelectOption[] = [
    { value: 'freeAgent', label: 'Free agents' },
    { value: 'all', label: 'Include ending soon' },
  ];

  const columns = useMemo<readonly ColumnDef<FreeAgentRow>[]>(
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
        id: 'ringName',
        header: 'Name',
        cell: (row) => (
          <span className={styles['name']}>
            <WorkerLink personId={row.personId} name={row.ringName} truncate />
          </span>
        ),
        sortValue: (row) => row.ringName,
        filterValue: (row) => row.ringName,
        width: 'lg',
        card: 'title',
      },
      {
        id: 'situation',
        header: 'Situation',
        cell: (row) => (
          <Badge
            tone={row.situation === 'freeAgent' ? 'data' : 'neutral'}
            className={styles['wrapBadge']}
          >
            {situationText(row)}
          </Badge>
        ),
        sortValue: (row) => row.situation,
        filterValue: (row) => situationText(row),
        card: 'subtitle',
      },
      {
        id: 'roles',
        header: 'Roles',
        cell: (row) => row.roles.map((entry) => WORKER_ROLE_LABELS[entry]).join(', '),
        filterValue: (row) => row.roles.map((entry) => WORKER_ROLE_LABELS[entry]).join(' '),
        card: 'meta',
      },
      {
        id: 'age',
        header: 'Age',
        cell: (row) => <span className="tabular">{formatNumber(row.age)}</span>,
        sortValue: (row) => row.age,
        filterValue: () => null,
        numeric: true,
        card: 'meta',
      },
      {
        id: 'style',
        header: 'Style',
        cell: (row) => STYLE_LABELS[row.style],
        sortValue: (row) => STYLE_LABELS[row.style],
        filterValue: () => null,
        card: 'hidden',
      },
      {
        id: 'peakPop',
        header: 'Peak popularity',
        cell: (row) => <span className="tabular">{formatNumber(Math.round(row.peakPop))}</span>,
        sortValue: (row) => row.peakPop,
        filterValue: () => null,
        numeric: true,
        card: 'hidden',
      },
      {
        id: 'rating',
        header: 'Rating',
        cell: (row) => (
          <span className={styles['nowrap']}>
            <span className="tabular">{formatNumber(Math.round(row.rating))}</span>{' '}
            <Badge tone="data">{row.grade}</Badge>
          </span>
        ),
        sortValue: (row) => row.rating,
        filterValue: () => null,
        numeric: true,
        card: 'meta',
      },
      {
        id: 'ask',
        header: 'Ask',
        cell: (row) => <AskCell row={row} promotionId={promotionId} money={money} />,
        sortValue: (row) => row.askMonthly ?? (row.askPerAppearance ?? 0) * 4,
        filterValue: () => null,
        numeric: true,
        card: 'stat',
      },
      {
        id: 'talks',
        header: 'Talks',
        cell: (row) => talksStateText(row),
        filterValue: () => null,
        card: 'meta',
      },
      {
        id: 'action',
        header: 'Action',
        cell: (row) => <ActionCell row={row} onOpen={open} />,
        filterValue: () => null,
        card: 'meta',
        headerHidden: true,
      },
    ],
    [promotionId, money, open],
  );

  return (
    <div className={styles['panel']}>
      <div className={styles['filters']}>
        <Select label="Role" options={roleOptions} value={role} onValueChange={setRole} />
        <Select
          label="Situation"
          options={situationOptions}
          value={situation}
          onValueChange={(value) => {
            setSituation(value === 'freeAgent' ? 'freeAgent' : 'all');
          }}
        />
      </div>
      <DataTable
        className={styles['table']}
        rows={rows}
        columns={columns}
        getRowId={(row) => row.personId}
        getRowLabel={(row) => row.ringName}
        caption="Free agents"
        filterable
        filterLabel="Find a worker"
        density="compact"
        loading={query.status === 'loading'}
        {...(isMobile ? {} : { onActivate: open })}
        emptyState={<EmptyState icon="contracts" title={NO_FREE_AGENTS_TEXT} />}
      />
    </div>
  );
}
