import { cents } from '@ringside/engine';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { classNames } from '@/components/classNames';
import { EmptyState } from '@/components/EmptyState';
import { formatSignedMoney, spokenSignedMoney } from '@/components/format';
import { VisuallyHidden } from '@/components/layout';
import styles from './Finances.module.css';

/** The words behind a query that could not answer: the engine's reasons, or the transport's. */
export function queryErrorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

export interface FinanceQueryErrorProps {
  readonly error: EngineQueryError | null;
  /** What could not be shown: "The ledger can't be shown". */
  readonly title: string;
}

/** A refused finance query: the reason in words, never a crash. */
export function FinanceQueryError({ error, title }: FinanceQueryErrorProps) {
  return <EmptyState icon="warning" title={title} body={queryErrorText(error)} headingLevel={2} />;
}

export interface SignedMoneyProps {
  /** Signed cents: income positive, costs negative. */
  readonly amount: number;
  /** Put a plus sign before income. Off by default. */
  readonly showPlus?: boolean;
  /** Colour the amount by its sign (rose for costs). On by default. */
  readonly coloured?: boolean;
  readonly className?: string | undefined;
}

/**
 * An amount with its sign, in the viewer's money style: `−$30,357` drawn, "minus $30,357" read
 * out. Costs are rose and income green, always with the sign as well.
 */
export function SignedMoney({
  amount,
  showPlus = false,
  coloured = true,
  className,
}: SignedMoneyProps) {
  const style = useSettingsStore((state) => state.settings.moneyStyle);
  const text = formatSignedMoney(cents(amount), { showPlus, style });
  return (
    <span
      className={classNames(
        styles['money'],
        'tabular',
        coloured && amount < 0 && styles['negative'],
        coloured && amount > 0 && styles['positive'],
        className,
      )}
    >
      <span aria-hidden="true">{text}</span>
      <VisuallyHidden>{spokenSignedMoney(text)}</VisuallyHidden>
    </span>
  );
}
