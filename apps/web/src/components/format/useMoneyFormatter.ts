import { useCallback } from 'react';
import type { Cents } from '@ringside/engine';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { formatMoney } from './format';
import type { FormatMoneyOptions } from './format';

/** Formats an amount the way the viewer chose in Settings, unless `options.style` says otherwise. */
export type MoneyFormatter = (amount: Cents, options?: FormatMoneyOptions) => string;

/**
 * `formatMoney` with the viewer's money style (compact `$1.2M` or full `$1,234,567`) filled in.
 * Screens that show money use this rather than calling `formatMoney` directly, so a change in
 * Settings re-renders every amount at once. A caller that must always show one style (a contract
 * figure in full, say) passes `style` explicitly.
 */
export function useMoneyFormatter(): MoneyFormatter {
  const moneyStyle = useSettingsStore((state) => state.settings.moneyStyle);
  return useCallback(
    (amount, options = {}) => formatMoney(amount, { style: moneyStyle, ...options }),
    [moneyStyle],
  );
}
