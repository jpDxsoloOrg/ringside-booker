/**
 * The Office's "Fans after your last show" panel (DAY2-06, as EVT5-04 describes it), registered
 * from EVT5's own folder: where the player's latest completed show won or lost fans, region by
 * region with a Why? on every change (three regions on a phone before "Show all"), and a link to
 * the show's results. It shows nothing before the first show, or when that show changed no one's
 * popularity: the "Last show" panel already says "No shows yet".
 */
import { Link } from 'react-router-dom';
import type { EventInstanceId, ShowPopularityChangeView } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { Icon } from '@/components/Icon';
import { Panel } from '@/components/Panel';
import { PopularityChangeList } from '@/components/PopularityChangeList';
import { registerOfficePanel } from '@/screens/office/panels/officePanelRegistry';
import styles from './officePanel.module.css';

/** The panel's id in the Office registry. */
export const FANS_PANEL_ID = 'promoPop.lastShow';

/** The panel's title. */
export const FANS_PANEL_TITLE = 'Fans after your last show';

/** Regions a phone shows before "Show all". */
export const FANS_PHONE_LIMIT = 3;

export interface FansAfterLastShowPanelProps {
  /** What the show did to the promotion's popularity, as `popularity.showChange` gives it. */
  readonly change: ShowPopularityChangeView;
}

/** The change list for one applied show, with a link to its results. */
export function FansAfterLastShowPanel({ change }: FansAfterLastShowPanelProps) {
  return (
    <Panel title={FANS_PANEL_TITLE} subtitle={change.showName}>
      <div className={styles['fans']}>
        <PopularityChangeList data={change} phoneLimit={FANS_PHONE_LIMIT} />
        <Link className={styles['link']} to={routes.game.showResults(change.eventInstanceId)}>
          See the results
          <Icon name="chevron-right" size="sm" decorative />
        </Link>
      </div>
    </Panel>
  );
}

function ChangeLoader({ eventInstanceId }: { readonly eventInstanceId: EventInstanceId }) {
  const query = useEngineQuery('popularity.showChange', { eventInstanceId });
  const change = query.data;
  if (change?.status !== 'applied' || change.summary === null) return null;
  return <FansAfterLastShowPanel change={change} />;
}

function FansPanelLoader() {
  const last = useEngineQuery('shows.lastCompleted', { scope: 'mine' }, { keepPreviousData: true });
  const show = last.data;
  if (show == null) return null;
  return <ChangeLoader eventInstanceId={show.eventInstanceId} />;
}

registerOfficePanel({
  id: FANS_PANEL_ID,
  order: 60,
  column: 'main',
  render: () => <FansPanelLoader />,
});
