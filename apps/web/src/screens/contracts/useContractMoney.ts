import { useCallback } from 'react';
import { cents } from '@ringside/engine';
import { useMoneyFormatter } from '@/components/format';

/** Formats a contract amount (whole cents, as the contract queries give them) in the viewer's money style. */
export type ContractMoney = (amount: number) => string;

export function useContractMoney(): ContractMoney {
  const money = useMoneyFormatter();
  return useCallback((amount: number) => money(cents(amount)), [money]);
}
