import { classNames } from '../classNames';
import { formatNumber } from '../format';
import { VisuallyHidden } from '../layout';
import styles from './Histogram.module.css';

/** One bar: values from `from` up to `to`, and how many fell there. */
export interface HistogramBin {
  readonly from: number;
  readonly to: number;
  readonly count: number;
}

export interface HistogramProps {
  /** The bins, lowest first, edge to edge. */
  readonly bins: readonly HistogramBin[];
  /** Draws a line at the mean, when it lies within the bins. */
  readonly mean?: number | undefined;
  /** With `mean`, shades one standard deviation either side of it (kept within the bins). */
  readonly sd?: number | undefined;
  /** What the chart shows, such as "Score over 100 runs". Captions the screen-reader table. */
  readonly label: string;
  /** The unit of the values along the bottom, such as "points". Heads the table's first column. */
  readonly unit: string;
  readonly className?: string | undefined;
}

/** The SVG coordinate space. The chart scales to its container's width. */
export const HISTOGRAM_VIEWBOX_WIDTH = 320;
export const HISTOGRAM_VIEWBOX_HEIGHT = 150;

const PLOT_LEFT = 26;
const PLOT_RIGHT = 8;
const PLOT_TOP = 10;
const PLOT_BOTTOM = 22;
/** Room between bars, in viewBox units. */
const BAR_GAP = 1;
/** At most this many labelled ticks along the bottom. */
const MAX_TICK_LABELS = 6;
const GEOMETRY_PRECISION = 100;

function round(position: number): number {
  return Math.round(position * GEOMETRY_PRECISION) / GEOMETRY_PRECISION;
}

export interface HistogramBar {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly count: number;
}

export interface HistogramTick {
  readonly x: number;
  readonly value: number;
}

export interface HistogramGeometry {
  readonly plot: {
    readonly left: number;
    readonly right: number;
    readonly top: number;
    readonly bottom: number;
  };
  readonly bars: readonly HistogramBar[];
  /** Labelled edges along the bottom. */
  readonly ticks: readonly HistogramTick[];
  readonly maxCount: number;
  /** The mean line's x, or null when there is no mean or it lies outside the bins. */
  readonly meanX: number | null;
  /** The ±1 sd band, clamped to the bins, or null without a mean and sd. */
  readonly band: { readonly from: number; readonly to: number } | null;
}

/** True when there is nothing to draw: no bins, or no value in any of them. */
export function histogramIsEmpty(bins: readonly HistogramBin[]): boolean {
  return bins.every((bin) => bin.count <= 0);
}

/**
 * Where everything goes in the viewBox: one bar per bin (height by count, tallest bin full
 * height), labelled ticks every few edges, and the mean line and sd band when they apply.
 */
export function histogramGeometry(
  bins: readonly HistogramBin[],
  mean?: number,
  sd?: number,
): HistogramGeometry {
  const plot = {
    left: PLOT_LEFT,
    right: HISTOGRAM_VIEWBOX_WIDTH - PLOT_RIGHT,
    top: PLOT_TOP,
    bottom: HISTOGRAM_VIEWBOX_HEIGHT - PLOT_BOTTOM,
  };
  const first = bins[0];
  const last = bins[bins.length - 1];
  if (first === undefined || last === undefined || last.to <= first.from) {
    return { plot, bars: [], ticks: [], maxCount: 0, meanX: null, band: null };
  }
  const low = first.from;
  const high = last.to;
  const xOf = (value: number): number =>
    round(plot.left + ((value - low) / (high - low)) * (plot.right - plot.left));
  const maxCount = Math.max(0, ...bins.map((bin) => bin.count));
  const plotHeight = plot.bottom - plot.top;

  const bars = bins.map((bin) => {
    const height = maxCount === 0 ? 0 : round((Math.max(0, bin.count) / maxCount) * plotHeight);
    const left = xOf(bin.from);
    const width = Math.max(0, round(xOf(bin.to) - left - BAR_GAP));
    return {
      x: round(left + BAR_GAP / 2),
      y: round(plot.bottom - height),
      width,
      height,
      count: bin.count,
    };
  });

  const edges = [...bins.map((bin) => bin.from), last.to];
  const step = Math.max(1, Math.ceil((edges.length - 1) / (MAX_TICK_LABELS - 1)));
  const ticks = edges
    .filter((_, index) => index % step === 0 || index === edges.length - 1)
    .filter((value, index, kept) => kept.indexOf(value) === index)
    .map((value) => ({ x: xOf(value), value }));
  // The last edge always shows; drop the one before it when the two would collide.
  const lastTick = ticks[ticks.length - 1];
  const beforeLast = ticks[ticks.length - 2];
  const minTickGap = (plot.right - plot.left) / (MAX_TICK_LABELS * 1.5);
  const spacedTicks =
    lastTick !== undefined && beforeLast !== undefined && lastTick.x - beforeLast.x < minTickGap
      ? [...ticks.slice(0, -2), lastTick]
      : ticks;

  const hasMean = mean !== undefined && Number.isFinite(mean);
  const meanX = hasMean && mean >= low && mean <= high ? xOf(mean) : null;
  let band: HistogramGeometry['band'] = null;
  if (hasMean && sd !== undefined && Number.isFinite(sd) && sd > 0) {
    const from = Math.min(high, Math.max(low, mean - sd));
    const to = Math.min(high, Math.max(low, mean + sd));
    if (to > from) band = { from: xOf(from), to: xOf(to) };
  }
  return { plot, bars, ticks: spacedTicks, maxCount, meanX, band };
}

function formatValue(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 1 });
}

/** A bin's range as the table reads it: "55–60". */
export function binRangeText(bin: HistogramBin): string {
  return `${formatValue(bin.from)}–${formatValue(bin.to)}`;
}

/**
 * A bar chart of how values spread across bins, drawn as inline SVG with no chart library: a bar
 * per bin, ticks along the bottom, the tallest count up the side, and an optional mean line with a
 * ±1 sd band. The drawing is hidden from screen readers; a visually hidden table holds the same
 * numbers. With no values it shows "No runs yet".
 */
export function Histogram({ bins, mean, sd, label, unit, className }: HistogramProps) {
  const empty = histogramIsEmpty(bins);
  const geometry = histogramGeometry(bins, mean, sd);
  const { plot } = geometry;

  return (
    <div className={classNames(styles['histogram'], className)}>
      {empty ? (
        <p className={styles['empty']}>No runs yet</p>
      ) : (
        <svg
          className={styles['chart']}
          viewBox={`0 0 ${String(HISTOGRAM_VIEWBOX_WIDTH)} ${String(HISTOGRAM_VIEWBOX_HEIGHT)}`}
          aria-hidden="true"
          focusable="false"
        >
          {geometry.band !== null && (
            <rect
              className={styles['band']}
              x={geometry.band.from}
              y={plot.top}
              width={round(geometry.band.to - geometry.band.from)}
              height={plot.bottom - plot.top}
              data-part="sd-band"
            />
          )}
          {geometry.bars.map((bar, index) => (
            <rect
              // Bins are a fixed sequence, so the place is a stable key.
              key={`bin-${String(index)}`}
              className={styles['bar']}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
            />
          ))}
          <line
            className={styles['axis']}
            x1={plot.left}
            x2={plot.right}
            y1={plot.bottom}
            y2={plot.bottom}
          />
          <line
            className={styles['axis']}
            x1={plot.left}
            x2={plot.left}
            y1={plot.top}
            y2={plot.bottom}
          />
          {geometry.ticks.map((tick) => (
            <g key={tick.value}>
              <line
                className={styles['axis']}
                x1={tick.x}
                x2={tick.x}
                y1={plot.bottom}
                y2={plot.bottom + 3}
              />
              <text className={styles['tick']} x={tick.x} y={plot.bottom + 14} textAnchor="middle">
                {formatValue(tick.value)}
              </text>
            </g>
          ))}
          <text className={styles['tick']} x={plot.left - 4} y={plot.top + 4} textAnchor="end">
            {formatNumber(geometry.maxCount)}
          </text>
          <text className={styles['tick']} x={plot.left - 4} y={plot.bottom} textAnchor="end">
            0
          </text>
          {geometry.meanX !== null && (
            <line
              className={styles['mean']}
              x1={geometry.meanX}
              x2={geometry.meanX}
              y1={plot.top - 4}
              y2={plot.bottom}
              data-part="mean"
            />
          )}
        </svg>
      )}
      {bins.length > 0 && (
        <VisuallyHidden as="div">
          <table>
            <caption>{label}</caption>
            <thead>
              <tr>
                <th scope="col">{`Range (${unit})`}</th>
                <th scope="col">Count</th>
              </tr>
            </thead>
            <tbody>
              {bins.map((bin) => (
                <tr key={`${String(bin.from)}-${String(bin.to)}`}>
                  <th scope="row">{binRangeText(bin)}</th>
                  <td>{formatNumber(bin.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {mean !== undefined && Number.isFinite(mean) && (
            <p>
              {`Mean ${formatValue(mean)} ${unit}`}
              {sd !== undefined && Number.isFinite(sd) ? `, spread ±${formatValue(sd)}` : ''}
            </p>
          )}
        </VisuallyHidden>
      )}
    </div>
  );
}
