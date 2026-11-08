import type { Cents } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import { DeltaChip } from '@/components/DeltaChip';
import { formatGameDate, formatPercent, useMoneyFormatter } from '@/components/format';
import { Icon } from '@/components/Icon';
import type { ShellStatus } from './shellPreview';
import styles from './StatusStrip.module.css';

export interface StatusStripProps {
  readonly status: ShellStatus;
  /** The phone layout: week, season and cash only, stacked in two short lines. */
  readonly compact: boolean;
  /** Marks the figures as a sample, on screen and for screen readers. */
  readonly sample?: boolean;
}

const POPULARITY_SCALE = 100;

/** "Week 11 · Season 2", or just the week before the first season. */
function weekAndSeason(status: ShellStatus): string {
  const week = `Week ${String(status.week)}`;
  return status.season === null ? week : `${week} · Season ${String(status.season)}`;
}

/** "Wk 11 · S2", for the phone bar. */
function shortWeekAndSeason(status: ShellStatus): string {
  const week = `Wk ${String(status.week)}`;
  return status.season === null ? week : `${week} · S${String(status.season)}`;
}

function signedMoney(amount: Cents, format: (amount: Cents) => string): string {
  return `${amount > 0 ? '+' : ''}${format(amount)}`;
}

/**
 * The game's heartbeat in the top bar: the date with its week and season, the promotion's cash and
 * its change this week, and popularity. Cash and popularity drop out for a player who runs no
 * promotion. On a phone it shrinks to the week and the cash so Next Day keeps its room.
 */
export function StatusStrip({ status, compact, sample = false }: StatusStripProps) {
  const formatMoney = useMoneyFormatter();
  const groupLabel = sample ? 'Status (sample figures)' : 'Status';
  const formatCompact = (amount: Cents) => formatMoney(amount, { style: 'compact' });

  if (compact) {
    return (
      <div role="group" aria-label={groupLabel} data-testid="top-bar-status">
        <dl className={styles['compact']}>
          <div className={styles['compactItem']}>
            <dt className={styles['hidden']}>Date</dt>
            <dd className={styles['compactDate']}>{shortWeekAndSeason(status)}</dd>
          </div>
          {status.cash !== null && (
            <div className={styles['compactItem']}>
              <dt className={styles['hidden']}>Cash</dt>
              <dd className={styles['compactCash']}>{formatCompact(status.cash)}</dd>
            </div>
          )}
        </dl>
      </div>
    );
  }

  return (
    <div role="group" aria-label={groupLabel} data-testid="top-bar-status">
      <dl className={styles['status']}>
        <div className={styles['item']} data-status="date">
          <dt className={styles['label']}>{weekAndSeason(status)}</dt>
          <dd className={styles['value']}>
            <Icon name="calendar" size="sm" className={styles['icon']} decorative />
            {formatGameDate(status.date, 'short')}
          </dd>
        </div>
        {status.cash !== null && (
          <div className={styles['item']} data-status="cash">
            <dt className={styles['label']}>Cash</dt>
            <dd className={styles['value']}>
              <span className={styles['cash']}>{formatCompact(status.cash)}</span>
              {status.cashDelta !== null && (
                <DeltaChip
                  value={status.cashDelta}
                  display={signedMoney(status.cashDelta, formatCompact)}
                  suffix="/wk"
                  variant="plain"
                  className={styles['delta']}
                />
              )}
            </dd>
          </div>
        )}
        {status.popularity !== null && (
          <div className={styles['item']} data-status="popularity">
            <dt className={styles['label']}>Popularity</dt>
            <dd className={styles['value']}>
              <span className={styles['popularity']}>
                {formatPercent(status.popularity / POPULARITY_SCALE)}
              </span>
            </dd>
          </div>
        )}
        {sample && (
          <div className={styles['sampleItem']}>
            <dt className={styles['hidden']}>Figures</dt>
            <dd>
              <Badge tone="neutral">Sample</Badge>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
