import { useEffect, useState } from 'react';
import type {
  ContentKey,
  FinishOption,
  FinishOutcomeKind,
  FinishesArgs,
  PlannedWinner,
} from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { Select } from '@/components/Select';
import type { SelectOption } from '@/components/Select';
import styles from './Result.module.css';
import {
  AUTO_FINISH_LABEL,
  AUTO_FINISH_VALUE,
  FINISH_RESET_MESSAGE,
  finishOptionLabel,
} from './resultText';

/** The outcome kind a winner choice narrows the finishes to: none for Auto, so every kind stays. */
export function outcomeKindOf(winner: PlannedWinner): FinishOutcomeKind | undefined {
  if (winner === 'auto') return undefined;
  return winner === 'draw' ? 'draw' : 'win';
}

/** The `match.finishes` arguments for a match type, side count and winner choice. */
export function finishesArgsOf(
  matchTypeKey: ContentKey,
  sideCount: number,
  winner: PlannedWinner,
): FinishesArgs {
  const outcomeKind = outcomeKindOf(winner);
  return outcomeKind === undefined
    ? { matchTypeKey, sideCount }
    : { matchTypeKey, sideCount, outcomeKind };
}

export interface FinishSelectViewProps {
  /** The finishes the match may end with, or null while they load. */
  readonly finishes: readonly FinishOption[] | null;
  /** The booked finish, or null for Auto. */
  readonly value: ContentKey | null;
  readonly onValueChange: (finishKey: ContentKey | null) => void;
  /** Said in the polite live region under the select, such as the reset message. */
  readonly notice?: string | null;
  readonly disabled?: boolean;
}

/**
 * The Finish select as drawn: Auto first, then each finish ("(no title change)" when a title on
 * the line would stay put), the chosen finish's summary under it, and a polite live region.
 */
export function FinishSelectView({
  finishes,
  value,
  onValueChange,
  notice = null,
  disabled = false,
}: FinishSelectViewProps) {
  const list = finishes ?? [];
  const options: readonly SelectOption[] = [
    { value: AUTO_FINISH_VALUE, label: AUTO_FINISH_LABEL },
    ...list.map((finish) => ({ value: finish.key, label: finishOptionLabel(finish) })),
  ];
  const chosen = value === null ? undefined : list.find((finish) => finish.key === value);
  return (
    <div className={styles['finish']}>
      <Select
        label="Finish"
        options={options}
        value={chosen === undefined ? AUTO_FINISH_VALUE : chosen.key}
        disabled={disabled || finishes === null}
        onValueChange={(picked) => {
          if (picked === AUTO_FINISH_VALUE) {
            onValueChange(null);
            return;
          }
          const finish = list.find((option) => option.key === picked);
          if (finish !== undefined) onValueChange(finish.key);
        }}
      />
      {chosen !== undefined && <p className={styles['summary']}>{chosen.summary}</p>}
      <p className={styles['notice']} role="status" aria-live="polite">
        {notice ?? ''}
      </p>
    </div>
  );
}

export interface FinishSelectProps {
  readonly matchTypeKey: ContentKey;
  /** The sides built. */
  readonly sideCount: number;
  readonly winner: PlannedWinner;
  readonly value: ContentKey | null;
  readonly onValueChange: (finishKey: ContentKey | null) => void;
  readonly disabled?: boolean;
}

/**
 * The Finish select fed by `match.finishes` for the match type, side count and winner choice.
 * When a change leaves the booked finish out of the list, it goes back to Auto and says so.
 */
export function FinishSelect({
  matchTypeKey,
  sideCount,
  winner,
  value,
  onValueChange,
  disabled = false,
}: FinishSelectProps) {
  const query = useEngineQuery('match.finishes', finishesArgsOf(matchTypeKey, sideCount, winner));
  const [notice, setNotice] = useState<string | null>(null);
  const finishes = query.data ?? null;
  const settled = finishes !== null && !query.isStale;

  useEffect(() => {
    if (!settled || value === null) return;
    if (!finishes.some((finish) => finish.key === value)) {
      onValueChange(null);
      setNotice(FINISH_RESET_MESSAGE);
    }
  }, [finishes, onValueChange, settled, value]);

  useEffect(() => {
    // A new booked finish clears an old reset message.
    if (value !== null) setNotice(null);
  }, [value]);

  if (query.error !== null && query.error.kind === 'rejected') {
    return (
      <p className={styles['unavailable']} role="status">
        {query.error.reasons.map((reason) => reason.message).join(' ')}
      </p>
    );
  }
  return (
    <FinishSelectView
      finishes={finishes}
      value={value}
      notice={notice}
      disabled={disabled}
      onValueChange={onValueChange}
    />
  );
}
