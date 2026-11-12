import type { SegmentWarning } from '@ringside/engine';
import { Icon } from '@/components/Icon';
import styles from './MatchLab.module.css';

/** Errors before warnings, each keeping the order the engine gave. */
export function orderedWarnings(warnings: readonly SegmentWarning[]): readonly SegmentWarning[] {
  return [
    ...warnings.filter((warning) => warning.severity === 'error'),
    ...warnings.filter((warning) => warning.severity !== 'error'),
  ];
}

export interface LabWarningsProps {
  readonly warnings: readonly SegmentWarning[];
}

/**
 * What is wrong with the line-up, as the booking screens will say it: errors first. A warning never
 * stops a Run; the lab shows it so the owner can see what booking would object to. Nothing at all
 * is drawn when there is nothing to say.
 */
export function LabWarnings({ warnings }: LabWarningsProps) {
  if (warnings.length === 0) return null;
  return (
    <section className={styles['warnings']} aria-label="Warnings">
      <ul className={styles['warningList']}>
        {orderedWarnings(warnings).map((warning, index) => (
          <li
            // Two warnings can share a code (one per side), so the place breaks the tie.
            key={`${warning.code}-${String(index)}`}
            className={styles['warning']}
            data-severity={warning.severity}
          >
            <Icon name="warning" size="sm" decorative />
            <span>
              <span className={styles['warningSeverity']}>
                {warning.severity === 'error' ? 'Error' : 'Warning'}:
              </span>{' '}
              {warning.message}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
