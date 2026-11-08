import { classNames } from '../classNames';
import { formatNumber } from '../format';
import { Icon } from '../Icon';
import styles from './SegmentedMeter.module.css';

/** One tick of the meter. */
export interface MeterSegment {
  readonly filled: boolean;
  /** The tick sits past the danger threshold, so it fills red-orange instead of cyan. */
  readonly danger: boolean;
}

export interface SegmentedMeterLayout {
  readonly segments: readonly MeterSegment[];
  /** How many ticks are filled. */
  readonly filledCount: number;
  /** The value has reached the danger threshold. */
  readonly inDanger: boolean;
}

/** The meter's tick count when none is given. */
export const DEFAULT_METER_SEGMENTS = 10;
/** Where the danger zone starts when no threshold is given, as a share of `max`. */
export const DEFAULT_DANGER_SHARE = 0.8;

/**
 * Splits 0..max into `segmentCount` equal ticks and fills them up to `value` (rounded to the
 * nearest tick, clamped to the scale). A tick is a danger tick when the top of its range is past
 * `dangerFrom`, so with ten ticks on 0–100 and danger from 80, the last two ticks are danger.
 *
 * The ticks always agree with the danger state: a value in the danger zone lights at least the
 * first danger tick, and a value below it never lights one, whatever the rounding says.
 */
export function layoutSegments(
  value: number,
  max: number,
  segmentCount: number,
  dangerFrom: number,
): SegmentedMeterLayout {
  const count = Math.max(1, Math.floor(segmentCount));
  const safeValue = Number.isFinite(value) ? value : 0;
  const clamped = max > 0 ? Math.min(Math.max(safeValue, 0), max) : 0;
  const tickSize = max > 0 ? max / count : 0;
  const inDanger = max > 0 && clamped >= dangerFrom;

  const isDangerTick = (index: number): boolean => (index + 1) * tickSize > dangerFrom;
  const firstDangerIndex = Array.from({ length: count }, (_unused, index) => index).find(
    isDangerTick,
  );
  const roundedCount = max > 0 ? Math.round((clamped / max) * count) : 0;
  let filledCount = roundedCount;
  if (firstDangerIndex !== undefined) {
    filledCount = inDanger
      ? Math.max(roundedCount, firstDangerIndex + 1)
      : Math.min(roundedCount, firstDangerIndex);
  }

  const segments = Array.from({ length: count }, (_unused, index) => ({
    filled: index < filledCount,
    danger: isDangerTick(index),
  }));

  return { segments, filledCount, inDanger };
}

export interface SegmentedMeterProps {
  /** What the meter measures, such as "Hype" or "Fatigue". Names the meter. */
  readonly label: string;
  readonly value: number;
  /** Top of the scale. 100 by default. */
  readonly max?: number;
  /** Number of ticks. 10 by default. */
  readonly segments?: number;
  /** Value where the danger zone starts. 80% of `max` by default. */
  readonly dangerFrom?: number;
  /**
   * The word shown and announced once the value is in the danger zone, so the state is never
   * colour alone. "Danger" by default; a hype meter might say "Hot".
   */
  readonly dangerLabel?: string;
  /** The visible value, such as "78%". The number by default. */
  readonly valueText?: string;
  /** Keep the label for screen readers only. */
  readonly hideLabel?: boolean;
  /** Show the value after the label. True by default. */
  readonly showValue?: boolean;
  readonly className?: string | undefined;
}

/**
 * Hype, heat and fatigue as discrete ticks: cyan up to the danger threshold and red-orange past
 * it. A `meter` with the value, the scale and a value text that names the danger state. Fills
 * change colour over `--motion-base`, which reduced motion sets to 0ms.
 */
export function SegmentedMeter({
  label,
  value,
  max = 100,
  segments = DEFAULT_METER_SEGMENTS,
  dangerFrom = max * DEFAULT_DANGER_SHARE,
  dangerLabel = 'Danger',
  valueText,
  hideLabel = false,
  showValue = true,
  className,
}: SegmentedMeterProps) {
  const layout = layoutSegments(value, max, segments, dangerFrom);
  const shownValue = valueText ?? formatNumber(value);
  const ariaValueText = layout.inDanger ? `${shownValue}, ${dangerLabel}` : shownValue;
  const clampedValue = Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), max);

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={clampedValue}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={ariaValueText}
      className={classNames(styles['meter'], className)}
      data-danger={layout.inDanger}
    >
      {(!hideLabel || showValue) && (
        // The meter is named by aria-label and described by aria-valuetext; this row is visual.
        <div className={styles['header']} aria-hidden="true">
          {!hideLabel && <span className={styles['label']}>{label}</span>}
          {showValue && (
            <span className={classNames(styles['value'], layout.inDanger && styles['valueDanger'])}>
              {layout.inDanger && <Icon name="warning" decorative />}
              {shownValue}
              {layout.inDanger && <span className={styles['dangerLabel']}>{dangerLabel}</span>}
            </span>
          )}
        </div>
      )}
      <span className={styles['ticks']} aria-hidden="true">
        {layout.segments.map((segment, index) => (
          <span
            // The ticks are positions on a fixed scale: the index is their identity.
            key={index}
            className={classNames(
              styles['tick'],
              segment.filled && (segment.danger ? styles['filledDanger'] : styles['filled']),
            )}
            data-part="tick"
            data-filled={segment.filled}
            data-zone={segment.danger ? 'danger' : 'safe'}
          />
        ))}
      </span>
    </div>
  );
}
