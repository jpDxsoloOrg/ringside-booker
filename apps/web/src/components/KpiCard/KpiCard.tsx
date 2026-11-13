import { useId } from 'react';
import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import { DeltaChip } from '../DeltaChip';
import type { DeltaGoodWhen } from '../DeltaChip';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { Sparkline } from '../Sparkline';
import type { SparklineTone } from '../Sparkline';
import styles from './KpiCard.module.css';

/**
 * Colour of the big number. Most KPIs are plain text; gold for a record, cyan for a live figure,
 * rose for a figure in the red (pair it with a minus sign or words, never colour alone).
 */
export type KpiCardTone = 'neutral' | 'data' | 'prestige' | 'negative';

/** The change shown in the card's delta chip. */
export interface KpiCardDelta {
  /** The change, such as `3` or `-12000`. Its sign picks the arrow. */
  readonly value: number;
  /** The change already formatted, sign included, such as `+4.2%`. */
  readonly display?: string;
  /** Small text after the number, such as "vs last month". */
  readonly suffix?: ReactNode;
  /** `up` by default; `down` for numbers that are better lower, such as payroll. */
  readonly goodWhen?: DeltaGoodWhen;
}

/** The recent series drawn as a sparkline next to the number. */
export interface KpiCardTrend {
  /** Oldest first. */
  readonly values: readonly number[];
  /** What the line covers, such as "last 8 weeks". Added to the card's label for the line's name. */
  readonly period: string;
  /** `data` by default. */
  readonly tone?: SparklineTone;
  /** Formats the first and last values for the line's accessible name. */
  readonly formatValue?: (value: number) => string;
}

export interface KpiCardProps {
  /** What the number is, such as "Avg show score". Shown in condensed capitals and names the card. */
  readonly label: string;
  /** The big number, already formatted, such as `74`, `92%` or `$410K`. */
  readonly value: ReactNode;
  /** Small text right after the number, such as `/100`. */
  readonly unit?: ReactNode;
  /** `neutral` by default. */
  readonly tone?: KpiCardTone;
  /** The change since the last period, drawn as a delta chip. */
  readonly delta?: KpiCardDelta;
  /** The recent series, drawn as a sparkline. */
  readonly trend?: KpiCardTrend;
  /** A small icon in the corner that repeats the label. */
  readonly icon?: IconName;
  /** A muted line under a hairline, such as "Regional benchmark 68". The Why? chip sits beside it. */
  readonly footer?: ReactNode;
  /** Slot for a Why? chip that opens the number's calculation trace. */
  readonly why?: ReactNode;
  readonly className?: string | undefined;
}

/**
 * An office-register stat card: a label in condensed capitals, a big tabular number, an optional
 * delta chip and sparkline, and a footer line. It is a group named by its label, so a screen
 * reader hears "Avg show score, 74, +3 vs last month". Lay several out with `KpiCardGrid`.
 */
export function KpiCard({
  label,
  value,
  unit,
  tone = 'neutral',
  delta,
  trend,
  icon,
  footer,
  why,
  className,
}: KpiCardProps) {
  const labelId = useId();
  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className={classNames(styles['kpiCard'], className)}
    >
      <div className={styles['header']}>
        <span id={labelId} className={styles['label']}>
          {label}
        </span>
        {icon !== undefined && <Icon name={icon} size="sm" className={styles['icon']} decorative />}
      </div>
      <div className={styles['body']}>
        <span className={classNames(styles['value'], styles[`tone-${tone}`])}>
          {value}
          {unit !== undefined && <span className={styles['unit']}>{unit}</span>}
        </span>
        {delta !== undefined && (
          <DeltaChip
            value={delta.value}
            {...(delta.display === undefined ? {} : { display: delta.display })}
            {...(delta.suffix === undefined ? {} : { suffix: delta.suffix })}
            {...(delta.goodWhen === undefined ? {} : { goodWhen: delta.goodWhen })}
            className={styles['delta']}
          />
        )}
        {trend !== undefined && (
          <Sparkline
            values={trend.values}
            label={`${label}, ${trend.period}`}
            tone={trend.tone ?? 'data'}
            {...(trend.formatValue === undefined ? {} : { formatValue: trend.formatValue })}
            className={styles['sparkline']}
          />
        )}
      </div>
      {(footer !== undefined || why !== undefined) && (
        <div className={styles['footer']}>
          {footer !== undefined && <span className={styles['footerText']}>{footer}</span>}
          {why !== undefined && <span className={styles['why']}>{why}</span>}
        </div>
      )}
    </div>
  );
}

export interface KpiCardGridProps {
  /** Names the row of cards for screen readers, such as "Key numbers". */
  readonly label: string;
  /** The `KpiCard`s. */
  readonly children: ReactNode;
  readonly className?: string | undefined;
}

/**
 * Lays KPI cards out: as many columns as fit on desktop (each at least 12rem wide), and two
 * columns below `--bp-mobile`, so a phone shows them 2-up.
 */
export function KpiCardGrid({ label, children, className }: KpiCardGridProps) {
  return (
    <div role="group" aria-label={label} className={classNames(styles['grid'], className)}>
      {children}
    </div>
  );
}
