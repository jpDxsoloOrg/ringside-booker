import { useCallback } from 'react';
import type { ChangeEvent } from 'react';
import styles from './DataTable.module.css';

export interface RowCheckboxProps {
  /** Names the checkbox, such as "Select Worker 3" or "Select all rows". */
  readonly label: string;
  readonly checked: boolean;
  /** Shown as a dash: some, not all, of the rows are checked. Header checkbox only. */
  readonly indeterminate?: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}

/**
 * A native checkbox for picking rows, styled on the tokens. Native, so it is one Tab stop with
 * Space to toggle, and screen readers announce it without extra ARIA. `indeterminate` can only be
 * set from script, so a ref callback keeps it in step.
 */
export function RowCheckbox({ label, checked, indeterminate = false, onChange }: RowCheckboxProps) {
  const syncIndeterminate = useCallback(
    (input: HTMLInputElement | null) => {
      if (input !== null) input.indeterminate = indeterminate;
    },
    [indeterminate],
  );

  // The label wrapper widens the tap target to the full cell corner without changing the box.
  return (
    <label className={styles['checkTarget']}>
      <input
        ref={syncIndeterminate}
        type="checkbox"
        className={styles['checkbox']}
        aria-label={label}
        checked={checked}
        onChange={onChange}
      />
    </label>
  );
}
