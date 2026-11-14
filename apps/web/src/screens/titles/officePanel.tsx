/**
 * The Office's "Champions" panel (CRTV1-06, DAY2's panel registry): the promotion's active titles
 * from `titles.list { scope: 'own', status: 'active' }`, flattened across brands in the list's own
 * order, each as the Titles screen's `TitleCard` (the name links to the title page, the champion to
 * their profile, prestige with its Why?). Side column, order 35. A grid of one column in the narrow
 * side column on desktop; a swipe row on a phone, as the Office mockup shows. Read-only: changing a
 * title happens on the Titles screen, which "All titles" opens.
 */
import { Link } from 'react-router-dom';
import type { TitleCardRow, TitleListResult } from '@ringside/engine';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { ChampionCardList } from '@/components/ChampionCard';
import { Icon } from '@/components/Icon';
import { Panel } from '@/components/Panel';
import { registerOfficePanel } from '@/screens/office/panels/officePanelRegistry';
import { TitleCard } from './titleCard';
import styles from './officePanel.module.css';

/** The panel's id in the Office registry. */
export const CHAMPIONS_PANEL_ID = 'titles.champions';

/** The panel's title. */
export const CHAMPIONS_TITLE = 'Champions';

/** The link to Creative > Titles. */
export const ALL_TITLES_TEXT = 'All titles';

/** What the panel says when the promotion has no active titles. */
export const NO_TITLES_TEXT = 'No active titles yet.';

/** Every title in the answer's groups, in the list's order (brand order, then promotion-wide). */
export function championRows(list: TitleListResult): TitleCardRow[] {
  return list.groups.flatMap((group) => group.titles);
}

export interface ChampionsPanelProps {
  /** The promotion's active titles, in the order to draw them. */
  readonly rows: readonly TitleCardRow[];
}

/** The champions and the Titles link, drawn from rows the caller already has. */
export function ChampionsPanel({ rows }: ChampionsPanelProps) {
  return (
    <Panel title={CHAMPIONS_TITLE}>
      <div className={styles['body']}>
        {rows.length === 0 ? (
          <p className={styles['empty']}>{NO_TITLES_TEXT}</p>
        ) : (
          <ChampionCardList label="Your champions">
            {rows.map((row) => (
              <TitleCard key={row.titleId} row={row} headingLevel={3} />
            ))}
          </ChampionCardList>
        )}
        <Link className={styles['link']} to={routes.game.titles()}>
          {ALL_TITLES_TEXT}
          <Icon name="chevron-right" size="sm" decorative />
        </Link>
      </div>
    </Panel>
  );
}

function ChampionsLoader() {
  const query = useEngineQuery(
    'titles.list',
    { scope: 'own', status: 'active' },
    { keepPreviousData: true },
  );
  // Nothing until the engine answers; a refused query leaves the panel out.
  if (query.status === 'error' || query.data === undefined) return null;
  return <ChampionsPanel rows={championRows(query.data)} />;
}

registerOfficePanel({
  id: CHAMPIONS_PANEL_ID,
  order: 35,
  column: 'side',
  render: ({ promotionId }) => (promotionId === null ? null : <ChampionsLoader />),
});
