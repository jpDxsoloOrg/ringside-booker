import type { DealRecentAiring } from '@ringside/engine';
import { formatNumber } from '@/components/format';
import styles from './DealTrend.module.css';

const WIDTH = 100;
const HEIGHT = 30;
const PAD = 3;

export interface DealTrendProps {
  /** The newest airings, oldest first. Missed ones count as no viewers. */
  readonly recent: readonly DealRecentAiring[];
  readonly networkName: string;
}

/** "Viewers over the last 6 airings: 3,962 to 4,120. The network expects 1,616." */
export function dealTrendLabel(recent: readonly DealRecentAiring[], networkName: string): string {
  const first = recent[0];
  const last = recent.at(-1);
  if (first === undefined || last === undefined || recent.length < 2) return 'No trend yet';
  return `Viewers over the last ${formatNumber(recent.length)} airings: ${formatNumber(first.viewers)} to ${formatNumber(last.viewers)}. ${networkName} expects ${formatNumber(last.expectedViewers)}.`;
}

function points(values: readonly number[], low: number, high: number): string {
  const span = high - low || 1;
  const step = values.length > 1 ? WIDTH / (values.length - 1) : 0;
  return values
    .map((value, index) => {
      const across = Math.round(index * step * 100) / 100;
      const down =
        Math.round((HEIGHT - PAD - ((value - low) / span) * (HEIGHT - 2 * PAD)) * 100) / 100;
      return `${String(across)},${String(down)}`;
    })
    .join(' ');
}

/**
 * The viewers of a deal's last airings against what the network expected, on one scale, so the
 * player sees at a glance whether the show stays above the line. Two airings at least; fewer say
 * "No trend yet" in words.
 */
export function DealTrend({ recent, networkName }: DealTrendProps) {
  const label = dealTrendLabel(recent, networkName);
  if (recent.length < 2) return <span className={styles['none']}>{label}</span>;
  const viewers = recent.map((airing) => airing.viewers);
  const expected = recent.map((airing) => airing.expectedViewers);
  const low = Math.min(...viewers, ...expected);
  const high = Math.max(...viewers, ...expected);
  return (
    <svg
      className={styles['trend']}
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
    >
      <polyline className={styles['expected']} points={points(expected, low, high)} />
      <polyline className={styles['viewers']} points={points(viewers, low, high)} />
    </svg>
  );
}
