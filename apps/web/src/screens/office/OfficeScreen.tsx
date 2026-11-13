import type { OfficeDashboard } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { EmptyState } from '@/components/EmptyState';
import { KpiCardGrid } from '@/components/KpiCard';
import { useIsMobile } from '@/styles/useMediaQuery';
import { OfficeKpiCard } from './OfficeKpiCard';
import styles from './OfficeScreen.module.css';
import './panels';
import { OfficePanelFrame } from './panels/OfficePanelFrame';
import {
  officePanelApplies,
  orderOfficePanels,
  useOfficePanels,
} from './panels/officePanelRegistry';
import type { OfficePanelContext, OfficePanelDefinition } from './panels/officePanelRegistry';

const SCREEN_TITLE = 'Dashboard';

/** The KPI cards drawn while the first answer loads: card shapes, never numbers. */
const SKELETON_CARDS = 5;

/** The heading's subtitle: whose Office this is and where the season stands. */
export function officeSubtitle(dashboard: OfficeDashboard): string {
  if (dashboard.promotion === null) return 'World overview';
  const { season } = dashboard.clock;
  if (season === null) return dashboard.promotion.name;
  return `${dashboard.promotion.name} · Week ${String(season.week)} of Season ${String(season.number)}`;
}

/** The engine's reasons for refusing, in words. */
function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

function KpiSkeleton() {
  return (
    <div className={styles['skeletonGrid']} aria-hidden="true">
      {Array.from({ length: SKELETON_CARDS }, (_, index) => (
        <div key={index} className={styles['skeletonCard']}>
          <span className={styles['skeletonLine']} />
          <span className={styles['skeletonValue']} />
        </div>
      ))}
    </div>
  );
}

interface PanelListProps {
  readonly panels: readonly OfficePanelDefinition[];
  readonly context: OfficePanelContext;
  readonly className: string | undefined;
  readonly column: string;
}

function PanelList({ panels, context, className, column }: PanelListProps) {
  return (
    <div className={className} data-office-column={column}>
      {panels.map((panel) => (
        <OfficePanelFrame key={panel.id} panelId={panel.id} render={() => panel.render(context)} />
      ))}
    </div>
  );
}

/**
 * The Office at `/game/office`: the promotion's key numbers from `office.dashboard`, each with
 * its Why?, its change since last week and its trend, then the panels other features register
 * (`registerOfficePanel`) in a wide main column and a narrower side column. A seat that runs no
 * promotion sees the world overview instead of key numbers. On a phone the cards go 2-up and the
 * panels become one column, still in order. Every figure comes from the engine.
 */
export function OfficeScreen() {
  useDocumentTitle(SCREEN_TITLE);
  const query = useEngineQuery('office.dashboard', {}, { keepPreviousData: true });
  const isPhone = useIsMobile();
  const registered = useOfficePanels();
  const dashboard = query.data;

  const header = (
    <div className={styles['header']}>
      <RouteHeading className={styles['heading']}>{SCREEN_TITLE}</RouteHeading>
      {dashboard !== undefined && <p className={styles['subtitle']}>{officeSubtitle(dashboard)}</p>}
    </div>
  );

  if (dashboard === undefined) {
    return (
      <div className={styles['screen']}>
        {header}
        {query.status === 'loading' ? (
          <>
            <p className={styles['loading']} role="status">
              Loading the Office…
            </p>
            <KpiSkeleton />
          </>
        ) : (
          <EmptyState
            size="page"
            icon="office"
            title="The Office can't be shown"
            body={errorText(query.error)}
            headingLevel={2}
          />
        )}
      </div>
    );
  }

  const promotionId = dashboard.promotion?.promotionId ?? null;
  const context: OfficePanelContext = { promotionId, dashboard, isPhone };
  const panels = orderOfficePanels(registered).filter((panel) =>
    officePanelApplies(panel, promotionId),
  );

  return (
    <div className={styles['screen']}>
      {header}
      {dashboard.kpis.length > 0 && (
        <KpiCardGrid label="Key numbers">
          {dashboard.kpis.map((kpi) => (
            <OfficeKpiCard key={kpi.key} kpi={kpi} />
          ))}
        </KpiCardGrid>
      )}
      {isPhone ? (
        <PanelList
          panels={panels}
          context={context}
          className={styles['singleColumn']}
          column="single"
        />
      ) : (
        <div className={styles['columns']}>
          <PanelList
            panels={panels.filter((panel) => panel.column === 'main')}
            context={context}
            className={styles['mainColumn']}
            column="main"
          />
          <PanelList
            panels={panels.filter((panel) => panel.column === 'side')}
            context={context}
            className={styles['sideColumn']}
            column="side"
          />
        </div>
      )}
    </div>
  );
}
