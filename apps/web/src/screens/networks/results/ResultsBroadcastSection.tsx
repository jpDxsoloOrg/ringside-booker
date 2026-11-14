/**
 * The results page's "On TV" section (ECO8-07, through EVT3's `registerResultsSection`): for one
 * of your own shows that aired, one line per network, "On National Signal Network: 2.4M viewers
 * (expected 1.9M) · TV rights $1.6M", with the airing's Why? (what it paid less the airtime).
 * The page's score bug already shows the viewers added up; this says where they came from.
 *
 * `ResultsBroadcastLines` draws a `broadcast.showAiring` answer with no query of its own, for
 * tests and the gallery.
 */
import { cents, shortViewers } from '@ringside/engine';
import type { EventInstanceId, ShowAiringView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useMoneyFormatter } from '@/components/format';
import { WhyButton } from '@/components/Trace';
import { AIRING_MONEY_LABELS, kindOfRow, missedText, ON_TV_TEXT, viewersText } from '../airingText';
import styles from '../calendar/OnTvSection.module.css';

export interface ResultsBroadcastLinesProps {
  readonly view: ShowAiringView;
}

/** One line per network that aired (or missed) the show; null when no deal carried it. */
export function ResultsBroadcastLines({ view }: ResultsBroadcastLinesProps) {
  const money = useMoneyFormatter();
  if (view.airings.length === 0) {
    return <p className={styles['muted']}>{ON_TV_TEXT.noDeal}</p>;
  }
  return (
    <ul className={styles['lines']}>
      {view.airings.map((row) => {
        const kind = kindOfRow(row, view.deals);
        if (row.status === 'missed') {
          return (
            <li key={row.airingId} className={styles['line']}>
              On {row.networkName}: {missedText(row.missReason).toLowerCase()}
            </li>
          );
        }
        const expected = `expected ${shortViewers(row.expectedViewers)}`;
        const income =
          row.income === null
            ? ''
            : ` · ${AIRING_MONEY_LABELS[kind]} ${money(cents(row.income), { style: 'compact' })}`;
        return (
          <li key={row.airingId} className={styles['line']}>
            <span>
              On {row.networkName}: {viewersText(row.viewers, kind)} ({expected}){income}
            </span>
            {row.net !== null && row.traceRef !== null && (
              <WhyButton
                label={`${row.showName} on ${row.networkName}`}
                value={row.net}
                unit="money"
                source={{ traceRef: row.traceRef }}
              />
            )}
            {row.note !== null && <span className={styles['muted']}>{row.note}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The section's body: `broadcast.showAiring` for the show. */
export function ResultsBroadcastSection({
  eventInstanceId,
}: {
  readonly eventInstanceId: EventInstanceId;
}) {
  const query = useEngineQuery('broadcast.showAiring', { eventInstanceId });
  if (query.error !== null) {
    return <p className={styles['muted']}>{ON_TV_TEXT.error}</p>;
  }
  if (query.data === undefined) {
    return (
      <p className={styles['muted']} role="status">
        {ON_TV_TEXT.loading}
      </p>
    );
  }
  return <ResultsBroadcastLines view={query.data} />;
}
