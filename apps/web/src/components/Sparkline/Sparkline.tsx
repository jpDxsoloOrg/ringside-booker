import { classNames } from '../classNames';
import { formatNumber } from '../format';
import styles from './Sparkline.module.css';

/** Width and height of the SVG coordinate space. The SVG stretches to its CSS box. */
export const SPARKLINE_VIEWBOX_WIDTH = 100;
export const SPARKLINE_VIEWBOX_HEIGHT = 30;
/** Room above and below the line so its stroke is never clipped at the highest and lowest point. */
const VERTICAL_PADDING = 3;
/** Geometry is rounded to this many steps per unit, far finer than a pixel on any sparkline. */
const GEOMETRY_PRECISION = 100;

export type SparklineTrend = 'rising' | 'falling' | 'flat';

/** `auto` follows the trend: positive when it rises, negative when it falls, data when flat. */
export type SparklineTone = 'auto' | 'data' | 'prestige' | 'positive' | 'negative';

export interface SparklineProps {
  /** The series, oldest first. Non-finite values are skipped; fewer than two points draw nothing. */
  readonly values: readonly number[];
  /** What the line shows, such as "TV viewers, last 8 weeks". Starts the accessible name. */
  readonly label: string;
  /** `data` (cyan, the chart colour) by default. */
  readonly tone?: SparklineTone;
  /** Formats the first and last values for the accessible name. `formatNumber` by default. */
  readonly formatValue?: (value: number) => string;
  readonly className?: string | undefined;
}

function roundGeometry(position: number): number {
  return Math.round(position * GEOMETRY_PRECISION) / GEOMETRY_PRECISION;
}

/** The finite values of a series, in order. */
export function finiteValues(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value));
}

/** Rising, falling or flat, from the first point to the last. */
export function sparklineTrend(values: readonly number[]): SparklineTrend {
  const points = finiteValues(values);
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined || first === last) return 'flat';
  return last > first ? 'rising' : 'falling';
}

/**
 * The series as `x,y` pairs in the viewBox: spread evenly from left to right, highest value at the
 * top. A flat series runs along the middle. Fewer than two finite values give no points.
 */
export function sparklinePoints(values: readonly number[]): readonly (readonly [number, number])[] {
  const points = finiteValues(values);
  if (points.length < 2) return [];
  const lowest = Math.min(...points);
  const highest = Math.max(...points);
  const range = highest - lowest;
  const usableHeight = SPARKLINE_VIEWBOX_HEIGHT - VERTICAL_PADDING * 2;
  const step = SPARKLINE_VIEWBOX_WIDTH / (points.length - 1);
  return points.map((value, index) => {
    const share = range === 0 ? 0.5 : (value - lowest) / range;
    const horizontal = roundGeometry(index * step);
    const vertical = roundGeometry(VERTICAL_PADDING + (1 - share) * usableHeight);
    return [horizontal, vertical] as const;
  });
}

const TONE_FOR_TREND: Readonly<Record<SparklineTrend, Exclude<SparklineTone, 'auto'>>> = {
  rising: 'positive',
  falling: 'negative',
  flat: 'data',
};

/**
 * A tiny line chart of a recent series, drawn as inline SVG with no chart library. It is an image
 * whose name says what it shows and how it moved ("TV viewers: 0.9M to 1.1M, rising"), so the
 * trend is never colour alone. It stretches to the box its parent gives it.
 */
export function Sparkline({
  values,
  label,
  tone = 'data',
  formatValue = formatNumber,
  className,
}: SparklineProps) {
  const points = sparklinePoints(values);
  const series = finiteValues(values);
  const first = series[0];
  const last = series[series.length - 1];
  if (points.length < 2 || first === undefined || last === undefined) return null;

  const trend = sparklineTrend(series);
  const resolvedTone = tone === 'auto' ? TONE_FOR_TREND[trend] : tone;
  const linePoints = points
    .map(([horizontal, vertical]) => `${String(horizontal)},${String(vertical)}`)
    .join(' ');
  const areaPoints = `0,${String(SPARKLINE_VIEWBOX_HEIGHT)} ${linePoints} ${String(SPARKLINE_VIEWBOX_WIDTH)},${String(SPARKLINE_VIEWBOX_HEIGHT)}`;
  const accessibleName = `${label}: ${formatValue(first)} to ${formatValue(last)}, ${trend}`;

  return (
    <svg
      className={classNames(styles['sparkline'], styles[`tone-${resolvedTone}`], className)}
      viewBox={`0 0 ${String(SPARKLINE_VIEWBOX_WIDTH)} ${String(SPARKLINE_VIEWBOX_HEIGHT)}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={accessibleName}
      focusable="false"
      data-trend={trend}
      data-tone={resolvedTone}
    >
      <polygon className={styles['area']} points={areaPoints} />
      <polyline className={styles['line']} points={linePoints} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
