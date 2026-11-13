/**
 * The promotion profile's Shows tab (AIP4-07): the promotion's recent shows, newest first, then
 * the ones coming up, soonest first, each a `RivalShowCard` that opens onto its card. It reads
 * `aip.showCards`, which already hides a rival's card until the show airs.
 */
import { isBefore } from '@ringside/engine';
import type { GameDate, ShowCardRow, TraceNode, TraceRef } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { EmptyState } from '@/components/EmptyState';
import type { PromotionTabContext } from '../promotionTabs';
import profileStyles from '../PromotionProfile.module.css';
import { RivalShowCard } from '../shows/RivalShowCard';
import styles from './ShowsTab.module.css';

export interface ShowsListProps {
  /** `aip.showCards`' rows: the past first (newest first), then today and later. */
  readonly rows: readonly ShowCardRow[];
  /** The game's date, which splits the rows into recent and coming up. */
  readonly today: GameDate;
  /** For the gallery, which has no engine: hands a breakdown over inline. */
  readonly traceOf?: (ref: TraceRef) => TraceNode | null;
}

function Section({
  title,
  rows,
  empty,
  traceOf,
}: {
  readonly title: string;
  readonly rows: readonly ShowCardRow[];
  readonly empty: string;
  readonly traceOf: ShowsListProps['traceOf'];
}) {
  return (
    <section className={styles['section']} aria-label={title}>
      <h3 className={styles['heading']}>{title}</h3>
      {rows.length === 0 ? (
        <p className={profileStyles['muted']}>{empty}</p>
      ) : (
        <ul className={styles['list']}>
          {rows.map((row) => (
            <li key={row.eventInstanceId}>
              <RivalShowCard
                row={row}
                headingLevel={4}
                {...(traceOf === undefined ? {} : { traceOf })}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The two sections, from rows already fetched. */
export function ShowsList({ rows, today, traceOf }: ShowsListProps) {
  const recent = rows.filter((row) => isBefore(row.date, today));
  const upcoming = rows.filter((row) => !isBefore(row.date, today));
  return (
    <>
      <Section title="Recent shows" rows={recent} empty="No shows yet." traceOf={traceOf} />
      <Section
        title="Coming up"
        rows={upcoming}
        empty="Nothing on the calendar yet."
        traceOf={traceOf}
      />
    </>
  );
}

export function ShowsTab({ promotionId }: Pick<PromotionTabContext, 'promotionId'>) {
  const query = useEngineQuery('aip.showCards', { promotionId });
  const clock = useEngineQuery('sim.status', {});
  if (query.status === 'error') {
    return (
      <div className={profileStyles['tab']}>
        <EmptyState icon="calendar" size="inline" title="The shows could not be loaded" />
      </div>
    );
  }
  if (query.data === undefined || clock.data === undefined) {
    return (
      <div className={profileStyles['tab']} aria-busy="true">
        <p className={profileStyles['muted']}>Loading the shows…</p>
      </div>
    );
  }
  return (
    <div className={profileStyles['tab']}>
      <ShowsList rows={query.data.rows} today={clock.data.date} />
    </div>
  );
}
