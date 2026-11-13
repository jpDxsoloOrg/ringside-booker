/**
 * The Office's "Last show" panel (DAY2-06, as EVT3-07 describes it), registered from the results
 * page's own folder: the player's latest completed show from `shows.lastCompleted`, with its date,
 * score (with its Why?) and stars, the main event, any title changes, EVT6's crowd and the box
 * office net (each with its Why?), and a link to the full results. "No shows yet" before the first.
 */
import { Link } from 'react-router-dom';
import { cents } from '@ringside/engine';
import type { EventInstanceId, ShowSummaryView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { useSettingsStore } from '@/app/settings/settingsStore';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatNumber, formatSignedMoney } from '@/components/format';
import { Icon } from '@/components/Icon';
import { Panel } from '@/components/Panel';
import { StarRating } from '@/components/StarRating';
import { Explained, WhyButton } from '@/components/Trace';
import { registerOfficePanel } from '@/screens/office/panels/officePanelRegistry';
import styles from './officePanel.module.css';

/** The panel's id in the Office registry. */
export const LAST_SHOW_PANEL_ID = 'shows.lastShow';

/** The panel's title. */
export const LAST_SHOW_TITLE = 'Last show';

/** What the panel says before the player's first show. */
export const NO_SHOWS_YET_TEXT = 'No shows yet';

/** "Main event: Ace vs Bolt (Singles match)". */
export function mainEventText(mainEvent: NonNullable<ShowSummaryView['mainEvent']>): string {
  return `Main event: ${mainEvent.sides.join(' vs ')} (${mainEvent.typeName})`;
}

/** "Winner: Ace", or "No winner" for a draw or no contest. */
export function winnerText(mainEvent: NonNullable<ShowSummaryView['mainEvent']>): string {
  return mainEvent.winnerSide === null ? 'No winner' : `Winner: ${mainEvent.winnerSide}`;
}

/** "New champion: Ace (World Heavyweight)", or "Vacated: World Heavyweight". */
export function titleChangeText(change: ShowSummaryView['titleChanges'][number]): string {
  if (change.newHolderNames.length === 0) return `Vacated: ${change.titleName}`;
  const holders = change.newHolderNames.join(' & ');
  const noun = change.newHolderNames.length === 1 ? 'New champion' : 'New champions';
  return `${noun}: ${holders} (${change.titleName})`;
}

/** "Crowd 12,400 · 82% full" with its Why?, once EVT6 has settled the show. */
function CrowdLine({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const query = useEngineQuery('boxOffice.showCrowd', { eventInstanceId });
  const crowd = query.data;
  if (crowd?.status !== 'settled' || crowd.attendance === null) return null;
  return (
    <li className={styles['fact']}>
      <span>
        Crowd {formatNumber(crowd.attendance)}
        {crowd.percentFull === null ? '' : ` · ${formatNumber(crowd.percentFull)}% full`}
      </span>
      {crowd.attendanceTraceRef !== null && (
        <WhyButton
          label="Crowd at your last show"
          panelTitle="Crowd"
          value={crowd.attendance}
          unit="people"
          source={{ traceRef: crowd.attendanceTraceRef }}
        />
      )}
    </li>
  );
}

/** "Box office net +$12,300" with its Why?, for the player's own settled show. */
function NetLine({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const moneyStyle = useSettingsStore((state) => state.settings.moneyStyle);
  const crowd = useEngineQuery('boxOffice.showCrowd', { eventInstanceId });
  const money = useEngineQuery(
    'boxOffice.showMoney',
    { eventInstanceId },
    { enabled: crowd.data?.status === 'settled' },
  );
  const net = money.data?.net;
  if (net === undefined) return null;
  return (
    <li className={styles['fact']}>
      <span>
        Box office net{' '}
        <span className={net.amount < 0 ? styles['negative'] : undefined}>
          {formatSignedMoney(cents(net.amount), { showPlus: true, style: moneyStyle })}
        </span>
      </span>
      {net.traceRef !== null && (
        <WhyButton
          label="Box office net at your last show"
          panelTitle="Box office net"
          value={net.amount}
          unit="money"
          source={{ traceRef: net.traceRef }}
        />
      )}
    </li>
  );
}

export interface LastShowPanelProps {
  /** `shows.lastCompleted` for the player's own shows; null before the first. */
  readonly show: ShowSummaryView | null;
}

/** The player's latest completed show, or "No shows yet". */
export function LastShowPanel({ show }: LastShowPanelProps) {
  if (show === null) {
    return (
      <Panel title={LAST_SHOW_TITLE}>
        <EmptyState
          icon="history"
          title={NO_SHOWS_YET_TEXT}
          headingLevel={3}
          body="Your first show's score and results will be here."
        />
      </Panel>
    );
  }
  return (
    <Panel title={LAST_SHOW_TITLE}>
      <div className={styles['lastShow']}>
        <div className={styles['heading']}>
          <h3 className={styles['showName']}>{show.name}</h3>
          <p className={styles['date']}>{formatGameDate(show.date, 'dayMonthYear')}</p>
        </div>
        <p className={styles['score']}>
          <span className={styles['scoreValue']}>
            Score <Explained value={show.score} label="Show score" traceRef={show.scoreTraceRef} />
          </span>
          <StarRating value={show.stars} size="sm" />
        </p>
        <ul className={styles['facts']}>
          {show.mainEvent !== null && (
            <li className={styles['fact']}>
              <span>{`${mainEventText(show.mainEvent)}. ${winnerText(show.mainEvent)}`}</span>
            </li>
          )}
          {show.titleChanges.map((change, index) => (
            <li key={`${change.titleName}-${String(index)}`} className={styles['fact']}>
              <Icon name="trophy" size="sm" decorative />
              <span>{titleChangeText(change)}</span>
            </li>
          ))}
          <CrowdLine eventInstanceId={show.eventInstanceId} />
          {show.mine && <NetLine eventInstanceId={show.eventInstanceId} />}
        </ul>
        <Link className={styles['link']} to={routes.game.showResults(show.eventInstanceId)}>
          Full results
          <Icon name="chevron-right" size="sm" decorative />
        </Link>
      </div>
    </Panel>
  );
}

/** Asks the engine for the player's last show and draws it. Nothing until the first answer. */
function LastShowPanelLoader() {
  const query = useEngineQuery(
    'shows.lastCompleted',
    { scope: 'mine' },
    { keepPreviousData: true },
  );
  if (query.data === undefined) return null;
  return <LastShowPanel show={query.data} />;
}

registerOfficePanel({
  id: LAST_SHOW_PANEL_ID,
  order: 55,
  column: 'main',
  render: () => <LastShowPanelLoader />,
});
