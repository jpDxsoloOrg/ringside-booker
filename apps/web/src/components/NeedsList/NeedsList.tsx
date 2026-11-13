import type { AipNeeds } from '@ringside/engine';
import { renderTemplatedText } from '@/text/renderTemplatedText';
import '@/text/catalogs/aip';
import { classNames } from '../classNames';
import { EmptyState } from '../EmptyState';
import { StatBar } from '../StatBar';
import { Explained } from '../Trace';
import styles from './NeedsList.module.css';

export interface NeedsListProps {
  /** The `aip.needs` answer: the slots the roster is measured against and the needs. */
  readonly needs: Pick<AipNeeds, 'slotsDemanded' | 'needs'>;
  readonly className?: string | undefined;
}

/** A severity at or above this reads as pressing: the bar turns red-orange. */
const PRESSING_FROM = 50;

/**
 * What a roster is short of, as a rival desk sees it (`aip.needs`): the wrestlers its largest show
 * calls for, with its Why?, then one row per need, most pressing first: the need in words, a
 * severity bar from 0 to 100 and the severity with its Why?. "No pressing needs" when there are
 * none. Needs talk about show slots, never match lengths.
 */
export function NeedsList({ needs, className }: NeedsListProps) {
  const demanded = needs.slotsDemanded;
  return (
    <div className={classNames(styles['needsList'], className)}>
      <p className={styles['demanded']}>
        <span className={styles['demandedLabel']}>Wrestlers its largest show calls for</span>
        <Explained
          value={demanded.value}
          label="Wrestlers its largest show calls for"
          trace={demanded.trace}
        />
      </p>
      {needs.needs.length === 0 ? (
        <EmptyState
          icon="check"
          size="inline"
          headingLevel={4}
          title="No pressing needs"
          body="The roster covers every card position, alignment, division, title and crew role."
        />
      ) : (
        <ul className={styles['rows']} aria-label="Needs, most pressing first">
          {needs.needs.map((need) => {
            const text = renderTemplatedText(need.summary);
            const severity = need.severity.value;
            return (
              <li key={need.key} className={styles['row']} data-need-kind={need.kind}>
                <span className={styles['summary']}>{text}</span>
                <StatBar
                  className={styles['bar']}
                  value={severity}
                  label={`Severity of ${text}`}
                  hideLabel
                  showValue={false}
                  tone={severity >= PRESSING_FROM ? 'action' : 'data'}
                />
                <Explained
                  className={classNames(styles['severity'])}
                  value={Math.round(severity)}
                  label={`Severity of ${text}`}
                  trace={need.severity.trace}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
