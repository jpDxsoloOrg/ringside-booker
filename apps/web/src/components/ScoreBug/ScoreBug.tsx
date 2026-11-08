import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import styles from './ScoreBug.module.css';

export type ScoreBugTone = 'neutral' | 'data' | 'prestige' | 'action';

/** One number on the bug. */
export interface ScoreBugStat {
  /** Stable key for the list. */
  readonly id: string;
  /** What the number is, such as "Overall" or "Gate". */
  readonly label: string;
  /** The big number, already formatted. */
  readonly value: ReactNode;
  /** A small line under the value, such as "3.75 stars" or "6,420 / 7,000". */
  readonly subValue?: ReactNode;
  /** Colour of the value. `data` (cyan) by default; `prestige` for a record or a best. */
  readonly tone?: ScoreBugTone;
  /** Outlines this stat, for the one number the bug is about. */
  readonly highlight?: boolean;
  /** Slot for a Why? chip that opens the number's calculation trace. */
  readonly why?: ReactNode;
}

/** Two to four stats. A score bug with more stops being glanceable, so the type refuses it. */
export type ScoreBugStats =
  | readonly [ScoreBugStat, ScoreBugStat]
  | readonly [ScoreBugStat, ScoreBugStat, ScoreBugStat]
  | readonly [ScoreBugStat, ScoreBugStat, ScoreBugStat, ScoreBugStat];

export interface ScoreBugProps {
  /** Names the strip for screen readers, such as "Last show". */
  readonly label: string;
  readonly stats: ScoreBugStats;
  readonly className?: string | undefined;
}

/**
 * A compact strip of 2–4 key numbers, each with a label, a big value, an optional sub-value and
 * an optional Why? chip. It is a named group holding a description list, so a screen reader
 * hears each label with its value. Below `--bp-mobile` it wraps to two columns (2×2 for four).
 */
export function ScoreBug({ label, stats, className }: ScoreBugProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={classNames(styles['scoreBug'], className)}
      data-count={stats.length}
    >
      <dl className={classNames(styles['stats'], styles[`count-${String(stats.length)}`])}>
        {stats.map((stat) => (
          <div
            key={stat.id}
            className={classNames(styles['stat'], stat.highlight === true && styles['highlight'])}
          >
            <dt className={styles['label']}>{stat.label}</dt>
            <dd className={classNames(styles['value'], styles[`tone-${stat.tone ?? 'data'}`])}>
              {stat.value}
            </dd>
            {stat.subValue !== undefined && <dd className={styles['subValue']}>{stat.subValue}</dd>}
            {stat.why !== undefined && <dd className={styles['why']}>{stat.why}</dd>}
          </div>
        ))}
      </dl>
    </div>
  );
}
