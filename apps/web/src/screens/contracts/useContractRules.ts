import { useMemo } from 'react';
import type { QueryData } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import {
  AUTO_RENEW_DAYS_KEY,
  AUTO_RENEW_KEY,
  EXPIRING_MIN_PUSH_KEY,
  EXPIRING_SOON_DAYS_KEY,
  EXPIRING_STOP_KEY,
  EXPIRING_WINDOW_KEY,
  QUIT_DAYS_KEY,
  QUIT_THRESHOLD_KEY,
} from './patiencePresets';

/** One rule as `tunables.list` describes it. */
export type TunableRow = QueryData<'tunables.list'>[number];

export const CONTRACTS_CATEGORY = 'Contracts';
const RECOVER_MARGIN_KEY = 'contracts.walkout.recoverMargin';
export const RENEWAL_WINDOW_KEY = 'contracts.renewal.windowDays';
export const MAX_LENGTH_KEY = 'contracts.offer.maxLengthMonths';
export const COUNTER_STOP_KEY = 'contracts.counter.stopSkip';

/** The contract rules the screen reads, with the engine's defaults until the answer arrives. */
export interface ContractRules {
  readonly rows: readonly TunableRow[];
  readonly loaded: boolean;
  readonly expiringWindowDays: number;
  readonly expiringSoonDays: number;
  readonly expiringStop: boolean;
  readonly expiringMinPush: string;
  readonly quitThreshold: number;
  readonly quitDays: number;
  readonly quitThresholdOverridden: boolean;
  readonly quitDaysOverridden: boolean;
  /** The morale above which a refused worker settles down: threshold + recover margin. */
  readonly settlesAbove: number;
  readonly autoRenew: boolean;
  readonly autoRenewDays: number;
  /** `contracts.renewal.windowDays`: renewal talks open this many days before the end (ECO5). */
  readonly renewalWindowDays: number;
  /** `contracts.offer.maxLengthMonths`: the longest contract an offer may run. */
  readonly maxLengthMonths: number;
  /** `contracts.counter.stopSkip`: a counter-offer stops skips until answered. */
  readonly counterStop: boolean;
}

const NO_ROWS: readonly TunableRow[] = [];

function numberOf(rows: readonly TunableRow[], key: string, fallback: number): number {
  const value = rows.find((row) => row.key === key)?.value;
  return typeof value === 'number' ? value : fallback;
}

function booleanOf(rows: readonly TunableRow[], key: string, fallback: boolean): boolean {
  const value = rows.find((row) => row.key === key)?.value;
  return typeof value === 'boolean' ? value : fallback;
}

function overridden(rows: readonly TunableRow[], key: string): boolean {
  return rows.find((row) => row.key === key)?.overridden ?? false;
}

/** Reads the rules from `tunables.list { category: 'Contracts' }` (saved with the game). */
export function contractRulesOf(rows: readonly TunableRow[], loaded: boolean): ContractRules {
  const quitThreshold = numberOf(rows, QUIT_THRESHOLD_KEY, -40);
  const minPush = rows.find((row) => row.key === EXPIRING_MIN_PUSH_KEY)?.value;
  return {
    rows,
    loaded,
    expiringWindowDays: numberOf(rows, EXPIRING_WINDOW_KEY, 60),
    expiringSoonDays: numberOf(rows, EXPIRING_SOON_DAYS_KEY, 30),
    expiringStop: booleanOf(rows, EXPIRING_STOP_KEY, true),
    expiringMinPush: typeof minPush === 'string' ? minPush : 'midCard',
    quitThreshold,
    quitDays: numberOf(rows, QUIT_DAYS_KEY, 14),
    quitThresholdOverridden: overridden(rows, QUIT_THRESHOLD_KEY),
    quitDaysOverridden: overridden(rows, QUIT_DAYS_KEY),
    settlesAbove: quitThreshold + numberOf(rows, RECOVER_MARGIN_KEY, 10),
    autoRenew: booleanOf(rows, AUTO_RENEW_KEY, false),
    autoRenewDays: numberOf(rows, AUTO_RENEW_DAYS_KEY, 365),
    renewalWindowDays: numberOf(rows, RENEWAL_WINDOW_KEY, 180),
    maxLengthMonths: numberOf(rows, MAX_LENGTH_KEY, 60),
    counterStop: booleanOf(rows, COUNTER_STOP_KEY, true),
  };
}

export function useContractRules(): ContractRules {
  const query = useEngineQuery(
    'tunables.list',
    { category: CONTRACTS_CATEGORY },
    { keepPreviousData: true },
  );
  const rows = query.status === 'success' ? (query.data ?? NO_ROWS) : NO_ROWS;
  const loaded = query.status === 'success' && query.data !== undefined;
  return useMemo(() => contractRulesOf(rows, loaded), [rows, loaded]);
}
