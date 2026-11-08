import { classNames } from '../classNames';
import { formatNumber, formatSigned } from '../format';
import type { Tone } from '../tone';
import styles from './StatBar.module.css';

/** Width of the SVG coordinate space. Bar geometry is a percentage of the scale. */
const VIEWBOX_WIDTH = 100;
const VIEWBOX_HEIGHT = 8;
/** Geometry is rounded to this many steps per unit, far finer than a pixel on any bar. */
const GEOMETRY_PRECISION = 1000;

/** Rounds SVG geometry so attributes read `58`, not `57.99999999999999`. */
function roundGeometry(position: number): number {
  return Math.round(position * GEOMETRY_PRECISION) / GEOMETRY_PRECISION;
}

export interface StatBarProps {
  /** The value to show. Values outside 0..max are clamped on the bar but shown as they are. */
  readonly value: number;
  /** Top of the scale. 100 by default. */
  readonly max?: number;
  /** What the bar measures. Shown beside the bar and used as the meter's accessible name. */
  readonly label: string;
  /** Keep the label for screen readers only, for example in a table with a column header. */
  readonly hideLabel?: boolean;
  /** Show the number after the bar. True by default. */
  readonly showValue?: boolean;
  /** Potential: draws a marker at this value. */
  readonly ceiling?: number;
  /**
   * The recent change. A gain tints the newest part of the bar; a loss shows the ground given up
   * as a faint segment past the end of the bar.
   */
  readonly delta?: number;
  /** `auto` (the default) picks a tone from the value and the two thresholds below. */
  readonly tone?: 'auto' | Tone;
  /** With `tone="auto"`, values below this are negative. 40 by default. */
  readonly negativeBelow?: number;
  /** With `tone="auto"`, values below this (and not negative) are a warning. 70 by default. */
  readonly warningBelow?: number;
  readonly className?: string | undefined;
}

export interface StatBarToneThresholds {
  readonly negativeBelow: number;
  readonly warningBelow: number;
}

export const DEFAULT_STAT_BAR_THRESHOLDS: StatBarToneThresholds = {
  negativeBelow: 40,
  warningBelow: 70,
};

/** The tone `auto` resolves to: negative below the low band, warning below the middle one. */
export function autoStatTone(
  value: number,
  thresholds: StatBarToneThresholds = DEFAULT_STAT_BAR_THRESHOLDS,
): Tone {
  if (value < thresholds.negativeBelow) {
    return 'negative';
  }
  return value < thresholds.warningBelow ? 'warning' : 'positive';
}

/** `value` as a position on the 0..100 SVG scale, clamped to the bar. */
export function statBarPosition(value: number, max: number): number {
  if (!Number.isFinite(value) || max <= 0) {
    return 0;
  }
  const clamped = Math.min(Math.max(value, 0), max);
  return roundGeometry((clamped / max) * VIEWBOX_WIDTH);
}

/** A horizontal 0–100 bar for attributes, popularity and condition. */
export function StatBar({
  value,
  max = 100,
  label,
  hideLabel = false,
  showValue = true,
  ceiling,
  delta,
  tone = 'auto',
  negativeBelow = DEFAULT_STAT_BAR_THRESHOLDS.negativeBelow,
  warningBelow = DEFAULT_STAT_BAR_THRESHOLDS.warningBelow,
  className,
}: StatBarProps) {
  const resolvedTone =
    tone === 'auto' ? autoStatTone(value, { negativeBelow, warningBelow }) : tone;
  const fillEnd = statBarPosition(value, max);
  const hasDelta = delta !== undefined && delta !== 0;

  // A gain splits the fill: the older part in the tone, the newest part tinted positive.
  const gainStart = hasDelta && delta > 0 ? statBarPosition(value - delta, max) : fillEnd;
  // A loss adds a faint segment from the end of the fill to where the value used to be.
  const lossEnd = hasDelta && delta < 0 ? statBarPosition(value - delta, max) : fillEnd;
  const ceilingX = ceiling === undefined ? undefined : statBarPosition(ceiling, max);

  const valueText = formatNumber(value);
  const deltaText = hasDelta ? formatSigned(delta) : undefined;
  const ariaValueText = [
    valueText,
    deltaText === undefined ? undefined : `change ${deltaText}`,
    ceiling === undefined ? undefined : `potential ${formatNumber(ceiling)}`,
  ]
    .filter((part) => part !== undefined)
    .join(', ');

  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={Math.min(Math.max(value, 0), max)}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuetext={ariaValueText}
      className={classNames(styles['statBar'], className)}
      data-tone={resolvedTone}
    >
      {!hideLabel && (
        // The meter is already named by aria-label; the visible copy is for sighted players.
        <span className={styles['label']} aria-hidden="true">
          {label}
        </span>
      )}
      <svg
        className={styles['bar']}
        viewBox={`0 0 ${String(VIEWBOX_WIDTH)} ${String(VIEWBOX_HEIGHT)}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <rect
          className={styles['track']}
          x={0}
          y={0}
          width={VIEWBOX_WIDTH}
          height={VIEWBOX_HEIGHT}
        />
        <rect
          className={styles[`tone-${resolvedTone}`]}
          data-part="fill"
          x={0}
          y={0}
          width={gainStart}
          height={VIEWBOX_HEIGHT}
        />
        {gainStart < fillEnd && (
          <rect
            className={styles['gain']}
            data-part="gain"
            x={gainStart}
            y={0}
            width={roundGeometry(fillEnd - gainStart)}
            height={VIEWBOX_HEIGHT}
          />
        )}
        {lossEnd > fillEnd && (
          <rect
            className={styles['loss']}
            data-part="loss"
            x={fillEnd}
            y={0}
            width={roundGeometry(lossEnd - fillEnd)}
            height={VIEWBOX_HEIGHT}
          />
        )}
        {ceilingX !== undefined && (
          <line
            className={styles['ceiling']}
            data-part="ceiling"
            x1={ceilingX}
            x2={ceilingX}
            y1={0}
            y2={VIEWBOX_HEIGHT}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {showValue && (
        <span className={styles['value']} aria-hidden="true">
          {valueText}
          {deltaText !== undefined && (
            <span
              className={classNames(
                styles['delta'],
                delta !== undefined && delta > 0 ? styles['delta-up'] : styles['delta-down'],
              )}
            >
              {deltaText}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
