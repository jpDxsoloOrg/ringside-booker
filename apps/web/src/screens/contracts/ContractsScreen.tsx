import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  AnswerReleaseResult,
  ContractRow,
  ContractsTab,
  EmploymentRole,
  ReleaseResult,
} from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { useEngineCommand } from '@/app/engine/useEngineCommand';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { Button } from '@/components/Button';
import { DataTable } from '@/components/DataTable';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import { Switch } from '@/components/Switch';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import { useSessionStore } from '@/app/session/sessionStore';
import { useIsMobile } from '@/styles/useMediaQuery';
import { EMPLOYMENT_ROLE_LABELS } from '@/screens/promotions/profile/tabs/RosterTab';
import { contractColumns, initialContractSort } from './contractColumns';
import type { ContractColumnContext } from './contractColumns';
import { ContractRulesSheet } from './ContractRulesSheet';
import { ContractSheet } from './ContractSheet';
import { autoRenewText } from './ContractDetailView';
import {
  CONTRACT_TAB_LABELS,
  DEFAULT_CONTRACTS_TAB,
  employmentFromSearch,
  isContractsTab,
  negotiationTargetFromSearch,
  searchWithEmployment,
  searchWithNegotiation,
  searchWithTabId,
  searchWithWantsToLeave,
  tabIdFromSearch,
  wantsToLeaveFromSearch,
} from './contractsParams';
import type { NegotiationTarget } from './contractsParams';
import './builtinTabs';
import { orderContractsTabs, useContractsTabs } from './contractsTabs';
import type { ContractsTabContext } from './contractsTabs';
import { useContractRowActions } from './rowActions';
import { useContractRules } from './useContractRules';
import styles from './ContractsScreen.module.css';
import { useContractMoney } from './useContractMoney';

const TITLE = 'Contracts';
const NO_ROWS: readonly ContractRow[] = [];
const ALL_ROLES = 'all';

/** What the screen says when the engine cannot answer at all (no world loaded). */
export const NO_GAME_TEXT = 'Start or load a game to see your contracts.';

/** The muted note on Expiring until a feature registers a Renew action (ECO5). */
export const RENEWALS_LATER_TEXT = 'Renewals arrive with contract negotiation.';

/** The Expiring tab's pointer once Renew is registered (ECO5-06): contracts no longer renew alone. */
export function renewPointerText(windowDays: number): string {
  return `Contracts end on their date unless you renew them. Press Renew to open talks: they open ${formatNumber(windowDays)} days before a contract ends.`;
}

// The sheet pulls in the offer form, the meter and the counter history: it loads when first opened.
const NegotiationSheet = lazy(async () => {
  const { NegotiationSheet: Sheet } = await import('./negotiation/NegotiationSheet');
  return { default: Sheet };
});

/** Each tab's empty state. */
export const EMPTY_TAB_TEXT: Readonly<Record<ContractsTab, string>> = {
  active: 'No contracts to show',
  expiring: 'No contracts end in the next few weeks',
  ended: 'No contracts have ended yet',
};

/** "2 contracts are close to their end date. Skips stop until you've seen them." */
export function expiringBannerText(unseen: number, stopsSkip: boolean): string {
  const lead =
    unseen === 1
      ? '1 contract is close to its end date.'
      : `${formatNumber(unseen)} contracts are close to their end date.`;
  return stopsSkip ? `${lead} Skips stop until you’ve seen them.` : lead;
}

/** "55 contracts · $1.2M a month · 1 expiring soon · 1 wants to leave". */
export function countsLineText(
  rows: readonly ContractRow[],
  monthly: string,
  expiringWindowDays: number,
  wantsToLeave: number,
): string {
  const expiring = rows.filter(
    (row) => row.daysLeft !== null && row.daysLeft <= expiringWindowDays,
  ).length;
  const parts = [
    `${formatNumber(rows.length)} ${rows.length === 1 ? 'contract' : 'contracts'}`,
    `${monthly} a month`,
    `${formatNumber(expiring)} expiring soon`,
  ];
  if (wantsToLeave > 0) {
    parts.push(`${formatNumber(wantsToLeave)} ${wantsToLeave === 1 ? 'wants' : 'want'} to leave`);
  }
  return parts.join(' · ');
}

function rowId(row: ContractRow): string {
  return row.employmentId;
}

function rowLabel(row: ContractRow): string {
  return row.ringName;
}

/** A finished action, said in the status region: "Released Big Joe. Severance $43,203". */
interface Outcome {
  readonly text: string;
  readonly ledgerLink: boolean;
}

/**
 * Business > Contracts: every contract you hold, on three tabs (Active, Expiring, Ended), with a
 * sheet for one contract where you release a worker or answer a request to leave. The tab, the
 * open contract and the "Wants to leave" filter live in the URL, which is where the day bar's
 * Contracts button sends the player to clear a contract stop.
 */
export function ContractsScreen() {
  useDocumentTitle(TITLE);
  const [searchParams, setSearchParams] = useSearchParams();
  const isMobile = useIsMobile();
  const money = useContractMoney();
  const rules = useContractRules();
  const rowActions = useContractRowActions();

  const registeredTabs = useContractsTabs();
  const tabs = useMemo(() => orderContractsTabs(registeredTabs), [registeredTabs]);
  const requestedTab = tabIdFromSearch(searchParams);
  const tabId = tabs.find((entry) => entry.id === requestedTab)?.id ?? DEFAULT_CONTRACTS_TAB;
  // The contract lists' own state; the other tabs keep the Active list's counts line current.
  const tab: ContractsTab = isContractsTab(tabId) ? tabId : DEFAULT_CONTRACTS_TAB;
  const promotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  const negotiationTarget = negotiationTargetFromSearch(searchParams);
  // The sheet stays mounted once used, so it can slide away and hand focus back when it closes.
  const [negotiationUsed, setNegotiationUsed] = useState(false);
  if (negotiationTarget !== null && !negotiationUsed) setNegotiationUsed(true);
  const openEmployment = employmentFromSearch(searchParams);
  const wantsToLeave = wantsToLeaveFromSearch(searchParams) && tab !== 'ended';
  const [role, setRole] = useState<string>(ALL_ROLES);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const listArgs = wantsToLeave ? { tab, wantsToLeave: true } : { tab };
  const listQuery = useEngineQuery('contracts.list', listArgs, { keepPreviousData: true });
  const activeQuery = useEngineQuery(
    'contracts.list',
    { tab: 'active' },
    { keepPreviousData: true },
  );
  const countsQuery = useEngineQuery('contracts.counts', {}, { keepPreviousData: true });
  const acknowledge = useEngineCommand('contracts.acknowledgeExpiries');

  // The list the rows on screen were fetched for. Kept data carries a list across a day passing,
  // but rows kept from another tab or the Wants to leave filter are not this list: after a switch
  // the table shows its loading rows until this list's own rows arrive.
  const listKey = `${tab}:${wantsToLeave ? 'leaving' : 'all'}`;
  const [rowsKey, setRowsKey] = useState<string | null>(null);
  if (listQuery.status !== 'loading' && !listQuery.isStale && rowsKey !== listKey) {
    setRowsKey(listKey);
  }
  const listLoading = listQuery.status === 'loading' || rowsKey !== listKey;
  const rows =
    (listQuery.status === 'success' && !listLoading ? listQuery.data : undefined) ?? NO_ROWS;
  const activeRows = (activeQuery.status === 'success' ? activeQuery.data : undefined) ?? NO_ROWS;
  const counts = countsQuery.status === 'success' ? countsQuery.data : undefined;
  const unseen = counts?.unseenExpiring ?? 0;

  const shownRows = useMemo(
    () => (role === ALL_ROLES ? rows : rows.filter((row) => row.role === role)),
    [rows, role],
  );
  const roleOptions = useMemo<readonly SelectOption[]>(() => {
    const present = new Set<EmploymentRole>(activeRows.map((row) => row.role));
    return [
      { value: ALL_ROLES, label: 'All roles' },
      ...[...present].sort().map((value) => ({ value, label: EMPLOYMENT_ROLE_LABELS[value] })),
    ];
  }, [activeRows]);

  const changeTab = useCallback(
    (next: string): void => {
      setSearchParams((current) => searchWithTabId(current, next), { replace: true });
    },
    [setSearchParams],
  );
  const openNegotiation = useCallback(
    (target: NegotiationTarget): void => {
      setSearchParams((current) =>
        searchWithNegotiation(searchWithEmployment(current, null), target),
      );
    },
    [setSearchParams],
  );
  const closeNegotiation = useCallback((): void => {
    setSearchParams((current) => searchWithNegotiation(current, null), { replace: true });
  }, [setSearchParams]);
  const openRow = useCallback(
    (row: ContractRow): void => {
      setOutcome(null);
      setSearchParams((current) => searchWithEmployment(current, row.employmentId));
    },
    [setSearchParams],
  );
  const closeSheet = useCallback((): void => {
    setSearchParams((current) => searchWithEmployment(current, null), { replace: true });
  }, [setSearchParams]);
  const acknowledgeRow = useCallback(
    (row: ContractRow): void => {
      void acknowledge.run({ employmentIds: [row.employmentId] });
    },
    [acknowledge],
  );

  const columnContext: ContractColumnContext = {
    money,
    expiringSoonDays: rules.expiringSoonDays,
    expiringWindowDays: rules.expiringWindowDays,
    isMobile,
    onOpen: openRow,
    onAcknowledge: acknowledgeRow,
    rowActions,
  };

  const released = (ringName: string, result: ReleaseResult): void => {
    closeSheet();
    setOutcome({
      text: `Released ${ringName}. Severance ${money(result.severance)}`,
      ledgerLink: result.severance > 0,
    });
  };
  const answered = (ringName: string, result: AnswerReleaseResult): void => {
    if (result.answer === 'grant') {
      closeSheet();
      setOutcome({
        text: `Let ${ringName} go. Severance ${money(result.severance)}`,
        ledgerLink: result.severance > 0,
      });
    } else {
      setOutcome({ text: `Refused ${ringName}'s request to leave.`, ledgerLink: false });
    }
  };

  const openRowData = rows.find((row) => row.employmentId === openEmployment) ?? null;
  const failed = listQuery.status === 'error';

  const filters = (
    <div className={styles['filters']}>
      <Select label="Role" options={roleOptions} value={role} onValueChange={setRole} />
      {tab !== 'ended' && (
        <Switch
          label="Wants to leave"
          checked={wantsToLeave}
          onCheckedChange={(checked) => {
            setSearchParams((current) => searchWithWantsToLeave(current, checked), {
              replace: true,
            });
          }}
        />
      )}
    </div>
  );

  const expiringIntro: ReactNode = (
    <>
      {unseen > 0 && (
        <div className={styles['banner']} role="region" aria-label="New expiry notices">
          <p>{expiringBannerText(unseen, rules.expiringStop)}</p>
          <Button
            variant="primary"
            loading={acknowledge.pending}
            onClick={() => {
              void acknowledge.run({ employmentIds: 'all' });
            }}
          >
            Mark all seen
          </Button>
        </div>
      )}
      <p className={styles['muted']}>
        {rowActions.some((action) => action.id === 'renew')
          ? renewPointerText(rules.renewalWindowDays)
          : RENEWALS_LATER_TEXT}
        {rules.autoRenew && ` ${autoRenewText(rules.autoRenewDays)}`}
      </p>
    </>
  );

  const contractList = (value: ContractsTab): ReactNode => (
    <div className={styles['panel']}>
      {value === 'expiring' && expiringIntro}
      {filters}
      <DataTable
        className={styles['table']}
        rows={shownRows}
        columns={contractColumns(value, columnContext)}
        getRowId={rowId}
        getRowLabel={rowLabel}
        caption={`${CONTRACT_TAB_LABELS[value]} contracts`}
        initialSort={initialContractSort(value)}
        filterable
        filterLabel="Find a contract"
        density="compact"
        loading={listLoading}
        {...(isMobile ? {} : { onActivate: openRow })}
        emptyState={
          <EmptyState
            icon="contracts"
            title={wantsToLeave ? 'Nobody wants to leave' : EMPTY_TAB_TEXT[value]}
          />
        }
      />
    </div>
  );
  const tabContext: ContractsTabContext = { promotionId, openNegotiation, contractList };

  let body: ReactNode;
  if (failed) {
    body = <EmptyState size="page" icon="contracts" title={NO_GAME_TEXT} />;
  } else {
    body = (
      <Tabs value={tabId} onChange={changeTab}>
        <TabList label="Contract lists">
          {tabs.map((entry) => {
            const Badge = entry.badge;
            return (
              <Tab key={entry.id} value={entry.id}>
                {entry.label}
                {Badge !== undefined && <Badge />}
              </Tab>
            );
          })}
        </TabList>
        {tabs.map((entry) => (
          <TabPanel key={entry.id} value={entry.id}>
            {entry.id === tabId && entry.render(tabContext)}
          </TabPanel>
        ))}
      </Tabs>
    );
  }

  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{TITLE}</RouteHeading>
        {activeQuery.status === 'success' && (
          <p className={styles['count']}>
            {countsLineText(
              activeRows,
              money(activeRows.reduce((total, row) => total + row.monthlyWage, 0)),
              rules.expiringWindowDays,
              counts?.wantsToLeave ?? 0,
            )}
          </p>
        )}
        <Button
          variant="secondary"
          iconStart="settings"
          className={styles['rulesButton']}
          onClick={() => {
            setRulesOpen(true);
          }}
        >
          Rules
        </Button>
      </div>
      <div role="status" className={styles['outcome']}>
        {outcome !== null && (
          <p>
            {outcome.text}
            {outcome.ledgerLink && (
              <>
                {' '}
                <Link to={routes.game.finances({ tab: 'ledger' })}>See it in the ledger</Link>
              </>
            )}
          </p>
        )}
      </div>
      {body}
      <ContractSheet
        employmentId={openEmployment}
        row={openRowData}
        rules={rules}
        onClose={closeSheet}
        onReleased={released}
        onAnswered={answered}
      />
      {negotiationUsed && (
        <Suspense fallback={null}>
          <NegotiationSheet
            target={negotiationTarget}
            onClose={closeNegotiation}
            onOpen={openNegotiation}
          />
        </Suspense>
      )}
      <ContractRulesSheet
        open={rulesOpen}
        onClose={() => {
          setRulesOpen(false);
        }}
        rules={rules}
      />
    </div>
  );
}
