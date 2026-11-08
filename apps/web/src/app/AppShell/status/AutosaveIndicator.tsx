import { forwardRef } from 'react';
import type { ButtonHTMLAttributes } from 'react';
import type { StorageErrorCode } from '@/storage';
import { Icon } from '@/components/Icon';
import { Popover } from '@/components/Popover';
import type { AutosaveState } from '../day/DayAdvanceProvider';
import styles from './StatusChips.module.css';

/** What the warning chip calls each storage problem. */
const FAILURE_TITLES: Readonly<Record<StorageErrorCode, string>> = {
  quota: 'No room for saves',
  unavailable: 'Saves unavailable',
  blocked: 'Saves blocked by another tab',
  notFound: 'Save slot missing',
  tooLarge: 'Save too large',
  readFailed: 'Autosave failed',
  writeFailed: 'Autosave failed',
};

/** The warning chip's label for a failed autosave. */
export function autosaveFailureTitle(code: StorageErrorCode | null): string {
  return code === null ? 'Autosave failed' : FAILURE_TITLES[code];
}

type WarningChipProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style' | 'children'> & {
  readonly label: string;
};

/** The warning chip itself; it forwards its ref so it can open the popover. */
const WarningChip = forwardRef<HTMLButtonElement, WarningChipProps>(function WarningChip(
  { label, ...buttonAttributes },
  ref,
) {
  return (
    <button {...buttonAttributes} ref={ref} type="button" className={styles['saveWarning']}>
      <Icon name="warning" decorative />
      {label}
    </button>
  );
});

export interface AutosaveIndicatorProps {
  readonly state: AutosaveState;
}

/**
 * The autosave's micro-state beside the date: "Saving…", then "Saved" for a moment. A save that
 * failed leaves a warning chip that opens the storage error, so a full disk is never silent.
 */
export function AutosaveIndicator({ state }: AutosaveIndicatorProps) {
  switch (state.kind) {
    case 'idle':
      return null;
    case 'saving':
      return (
        <span className={styles['saveState']} role="status">
          Saving…
        </span>
      );
    case 'saved':
      return (
        <span className={styles['saveState']} role="status">
          <Icon name="check" decorative />
          Saved
        </span>
      );
    case 'failed': {
      const title = autosaveFailureTitle(state.code);
      return (
        <Popover title={title} trigger={<WarningChip label={title} />} align="end">
          <p className={styles['saveErrorText']}>{state.message}</p>
          <p className={styles['saveErrorHint']}>
            The game keeps running. The next autosave tries again; deleting or exporting old saves
            frees up room.
          </p>
        </Popover>
      );
    }
  }
}
