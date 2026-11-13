/**
 * The Office's "Top of your roster" panel (WRK2-06), registered from the roster's own folder: the
 * five most popular wrestlers among the promotion's fans from `roster.summary.topByPopularity`,
 * each with their portrait, a link to their profile, their push, their popularity (with a Why?)
 * and their momentum ("–" before their first appearance), then a link to the roster. The side
 * column on desktop; on a phone each wrestler is a stacked row.
 */
import { Link } from 'react-router-dom';
import type { PromotionId, RosterRow } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { formatPopularity, roundPopularity } from '@/components/format';
import { Icon } from '@/components/Icon';
import { ImageSlot } from '@/components/ImageSlot';
import { Panel } from '@/components/Panel';
import { LazyWhyButton } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import { registerOfficePanel } from '@/screens/office/panels/officePanelRegistry';
import { pushLabel } from './labels';
import { momentumCell } from './rosterColumns';
import styles from './officePanel.module.css';

/** The panel's id in the Office registry. */
export const TOP_OF_ROSTER_PANEL_ID = 'roster.top';

/** The panel's title. */
export const TOP_OF_ROSTER_TITLE = 'Top of your roster';

/** The link to the full roster. */
export const VIEW_ROSTER_TEXT = 'View roster';

/** What the panel says when the promotion has no wrestlers under contract. */
export const NO_WRESTLERS_TEXT = 'No wrestlers under contract yet.';

function TopRow({ row }: { readonly row: RosterRow }) {
  const popularity = roundPopularity(row.popularity);
  return (
    <li className={styles['row']}>
      <ImageSlot
        subject={{
          kind: 'person',
          id: row.personId,
          name: row.ringName,
          ...(row.imageRef === null ? {} : { imageRef: row.imageRef }),
        }}
        size="sm"
        decorative
      />
      <div className={styles['who']}>
        <WorkerLink personId={row.personId} name={row.ringName} truncate />
        <span className={styles['push']}>{pushLabel(row.push)}</span>
      </div>
      <dl className={styles['stats']}>
        <div className={styles['stat']}>
          <dt>Popularity</dt>
          <dd className={styles['value']}>
            <span className="tabular">{formatPopularity(popularity)}</span>
            <LazyWhyButton
              label={`${row.ringName} popularity`}
              value={popularity}
              queryName="roster.explain"
              args={{ employmentId: row.employmentId, metric: 'popularity' }}
            />
          </dd>
        </div>
        <div className={styles['stat']}>
          <dt>Momentum</dt>
          <dd className={styles['value']}>{momentumCell(row)}</dd>
        </div>
      </dl>
    </li>
  );
}

export interface TopOfRosterPanelProps {
  /** `roster.summary`'s `topByPopularity`, most popular first. */
  readonly rows: readonly RosterRow[];
}

/** The five wrestlers and the roster link, drawn from rows the caller already has. */
export function TopOfRosterPanel({ rows }: TopOfRosterPanelProps) {
  return (
    <Panel title={TOP_OF_ROSTER_TITLE} subtitle="Most popular with your fans">
      <div className={styles['body']}>
        {rows.length === 0 ? (
          <p className={styles['empty']}>{NO_WRESTLERS_TEXT}</p>
        ) : (
          <ol className={styles['list']}>
            {rows.map((row) => (
              <TopRow key={row.employmentId} row={row} />
            ))}
          </ol>
        )}
        <Link className={styles['link']} to={routes.game.roster()}>
          {VIEW_ROSTER_TEXT}
          <Icon name="chevron-right" size="sm" decorative />
        </Link>
      </div>
    </Panel>
  );
}

function TopOfRosterLoader({ promotionId }: { readonly promotionId: PromotionId }) {
  const query = useEngineQuery('roster.summary', { promotionId }, { keepPreviousData: true });
  const summary = query.status === 'error' ? undefined : query.data;
  // Nothing until the engine answers, and nothing for a roster it cannot read (the Office's own
  // panels already say why a seat has no promotion).
  if (summary?.unavailableReason !== null) return null;
  return <TopOfRosterPanel rows={summary.topByPopularity} />;
}

registerOfficePanel({
  id: TOP_OF_ROSTER_PANEL_ID,
  order: 30,
  column: 'side',
  render: ({ promotionId }) =>
    promotionId === null ? null : <TopOfRosterLoader promotionId={promotionId} />,
});
