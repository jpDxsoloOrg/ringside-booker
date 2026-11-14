/**
 * The calendar show sheet's "On TV" section (ECO8-07, wiring ECO8 into EVT1's sheet without
 * editing it), from `broadcast.showAiring`:
 *
 * - one of your shows still to air: "Airs on National Signal Network (TV deal)";
 * - a rival's show still to air: "On National Signal Network" (who carries a show is public);
 * - once aired: one line per network, "National Signal Network: 2.4M viewers · $1.6M" with the
 *   airing's Why?, money only for your own shows;
 * - nothing aired: "Missed airing: show cancelled" (or "the show didn't run").
 *
 * The body (`OnTvLines`) is drawn from a `broadcast.showAiring` answer with no query of its own,
 * so tests and the gallery can show it with made-up airings.
 */
import { cents } from '@ringside/engine';
import type { CalendarShow, EventInstanceId, ShowAiringView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useMoneyFormatter } from '@/components/format';
import { WhyButton } from '@/components/Trace';
import type { ShowSheetSectionDefinition } from '@/screens/calendar/registry';
import {
  airsOnText,
  kindOfRow,
  missedText,
  ON_TV_TEXT,
  onNetworkText,
  viewersText,
} from '../airingText';
import styles from './OnTvSection.module.css';

export interface OnTvLinesProps {
  readonly view: ShowAiringView;
  /** True when the viewer runs the show. */
  readonly isOwn: boolean;
}

/** What the section says about one show's airings. */
export function OnTvLines({ view, isOwn }: OnTvLinesProps) {
  const money = useMoneyFormatter();
  const aired = view.airings.filter((row) => row.status === 'aired');
  if (view.airing !== null && aired.length === 0) {
    return <p className={styles['line']}>{missedText(view.airing.missReason)}</p>;
  }
  if (aired.length > 0) {
    return (
      <ul className={styles['lines']}>
        {aired.map((row) => {
          const kind = kindOfRow(row, view.deals);
          const viewers = viewersText(row.viewers, kind);
          // Money only ever arrives for your own shows; the engine leaves it null otherwise.
          const income =
            row.income === null ? null : money(cents(row.income), { style: 'compact' });
          return (
            <li key={row.airingId} className={styles['line']}>
              <span>
                {row.networkName}: {viewers}
                {income === null ? '' : ` · ${income}`}
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
  if (view.deals.length === 0) {
    return <p className={styles['muted']}>{ON_TV_TEXT.noDeal}</p>;
  }
  return (
    <ul className={styles['lines']}>
      {view.deals.map((deal) => (
        <li key={deal.dealId} className={styles['line']}>
          {isOwn ? airsOnText(deal.networkName, deal.kind) : onNetworkText(deal.networkName)}
        </li>
      ))}
    </ul>
  );
}

function OnTvSectionBody({
  eventInstanceId,
  isOwn,
}: {
  readonly eventInstanceId: EventInstanceId;
  readonly isOwn: boolean;
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
  return <OnTvLines view={query.data} isOwn={isOwn} />;
}

/**
 * The stored id of a show the section speaks about, or null to leave the section out: a projected
 * date (nothing stored yet), a house show (never on TV), or a show of a definition that isn't
 * televised and never ran (nothing can carry it; signing a deal makes the definition televised).
 */
export function onTvShowId(show: CalendarShow): EventInstanceId | null {
  if (show.eventInstanceId === null || show.importance === 'house') return null;
  if (show.televised === false && show.status !== 'completed' && show.status !== 'cancelled') {
    return null;
  }
  return show.eventInstanceId;
}

export const ON_TV_SECTION: ShowSheetSectionDefinition = {
  id: 'eco.airing',
  order: 30,
  title: ON_TV_TEXT.title,
  render: ({ show, isOwn }) => {
    const eventInstanceId = onTvShowId(show);
    return eventInstanceId === null ? null : (
      <OnTvSectionBody eventInstanceId={eventInstanceId} isOwn={isOwn} />
    );
  },
};
