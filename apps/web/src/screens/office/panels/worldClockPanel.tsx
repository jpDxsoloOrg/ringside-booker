import { dayOfMonth, month, year } from '@ringside/engine';
import type { GameDate, OfficeClock } from '@ringside/engine';
import { formatGameDate, formatNumber } from '@/components/format';
import { Panel } from '@/components/Panel';
import styles from './officePanels.module.css';
import { registerOfficePanel } from './officePanelRegistry';

/** `Monday 25 January`: weekday, day and month, the way the clock names the next report day. */
const weekdayDayMonthFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** A game date as `Monday 25 January`. Game dates are calendar days, formatted at UTC midnight. */
export function weekdayDayMonth(date: GameDate): string {
  const parts = weekdayDayMonthFormat.formatToParts(
    new Date(Date.UTC(year(date), month(date) - 1, dayOfMonth(date))),
  );
  const partOf = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${partOf('weekday')} ${partOf('day')} ${partOf('month')}`;
}

/** `Season 1 · week 4 · 337 days left`, or "No season running". */
export function seasonLine(season: OfficeClock['season']): string {
  if (season === null) return 'No season running';
  const left =
    season.daysLeft === 0
      ? 'last day of the season'
      : `${formatNumber(season.daysLeft)} ${season.daysLeft === 1 ? 'day' : 'days'} left`;
  return `Season ${String(season.number)} · week ${String(season.week)} · ${left}`;
}

/** `Next weekly report: Monday 25 January`, with "(today)" when it is taken tonight. */
export function nextReportLine(clock: OfficeClock): string {
  const day = weekdayDayMonth(clock.nextSnapshotOn);
  return `Next weekly report: ${clock.nextSnapshotOn === clock.date ? `today, ${day}` : day}`;
}

export interface WorldClockPanelProps {
  readonly clock: OfficeClock;
}

/** Today in the game world: the date, how long the game has run, the season and the next report. */
export function WorldClockPanel({ clock }: WorldClockPanelProps) {
  return (
    <Panel title="World clock">
      <div className={styles['clock']}>
        <p className={styles['clockDate']}>{formatGameDate(clock.date, 'long')}</p>
        <ul className={styles['clockLines']}>
          <li>Day {formatNumber(clock.dayNumber)} of your game</li>
          <li>{seasonLine(clock.season)}</li>
          <li>{nextReportLine(clock)}</li>
        </ul>
      </div>
    </Panel>
  );
}

registerOfficePanel({
  id: 'day2.worldClock',
  order: 10,
  column: 'side',
  requiresPromotion: false,
  render: ({ dashboard }) => <WorldClockPanel clock={dashboard.clock} />,
});
