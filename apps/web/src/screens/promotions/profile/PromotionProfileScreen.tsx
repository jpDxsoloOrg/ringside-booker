import type { ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { isId } from '@ringside/engine';
import type { PromotionId } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { promotionsListUrlFrom } from '@/app/entityLinks';
import { PROMOTION_PARAMS, PROMOTION_ROUTE_PARAM, routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { classNames } from '@/components/classNames';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { VisuallyHidden } from '@/components/layout';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import { BUILTIN_PROMOTION_TABS } from './builtinTabs';
import { PromotionHeader } from './PromotionHeader';
import styles from './PromotionProfile.module.css';
import { DEFAULT_PROMOTION_TAB_ID, usePromotionTabs, visiblePromotionTabs } from './promotionTabs';
import type { PromotionTabContext } from './promotionTabs';

const NOT_FOUND_TITLE = 'Promotion not found';
const LOADING_TITLE = 'Loading promotion';

/** The link back to the Promotions list: with the sort it was left with, when it was the way in. */
function BackToPromotions() {
  const location = useLocation();
  const listUrl = promotionsListUrlFrom(location.state) ?? routes.game.promotions();
  return (
    <Link to={listUrl} className={styles['backLink']}>
      <Icon name="back" size="sm" decorative />
      Back to Promotions
    </Link>
  );
}

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

function PromotionNotFound({ reason }: { readonly reason: string }) {
  useDocumentTitle(NOT_FOUND_TITLE);
  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['heading']}>{NOT_FOUND_TITLE}</RouteHeading>
      <EmptyState
        size="page"
        icon="building"
        title="There is no profile to show"
        body={
          <>
            {reason} <Link to={routes.game.promotions()}>Back to Promotions</Link>
          </>
        }
      />
    </div>
  );
}

function PromotionProfileLoading() {
  useDocumentTitle('Promotion');
  return (
    <div className={styles['screen']} aria-busy="true">
      <BackToPromotions />
      <div className={classNames(styles['skeleton'], styles['skeletonHeader'])}>
        <RouteHeading className={styles['heading']}>
          <VisuallyHidden>{LOADING_TITLE}</VisuallyHidden>
        </RouteHeading>
      </div>
      <span className={classNames(styles['skeleton'], styles['skeletonTabs'])} />
    </div>
  );
}

/** The tab strip and the selected tab's panel. The selection lives in the URL (`?tab=roster`). */
function PromotionTabs({ context }: { readonly context: PromotionTabContext }) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const registered = usePromotionTabs();
  const tabs = visiblePromotionTabs([...BUILTIN_PROMOTION_TABS, ...registered], context);
  const requested = searchParams.get(PROMOTION_PARAMS.tab);
  // An unknown tab, or one hidden for this promotion, falls back to Overview.
  const selected = tabs.find((tab) => tab.id === requested)?.id ?? DEFAULT_PROMOTION_TAB_ID;

  const select = (tabId: string): void => {
    const next = new URLSearchParams(searchParams);
    if (tabId === DEFAULT_PROMOTION_TAB_ID) {
      next.delete(PROMOTION_PARAMS.tab);
    } else {
      next.set(PROMOTION_PARAMS.tab, tabId);
    }
    // Replace, so Back leaves the profile, and keep the state the back link reads the sort from.
    setSearchParams(next, { replace: true, state: location.state as unknown });
  };

  return (
    <Tabs value={selected} onChange={select}>
      <TabList label={`${context.profile.header.name} profile`}>
        {tabs.map((tab) => (
          <Tab key={tab.id} value={tab.id}>
            {tab.label}
          </Tab>
        ))}
      </TabList>
      {tabs.map((tab) => (
        <TabPanel key={tab.id} value={tab.id}>
          {tab.id === selected ? tab.render(context) : null}
        </TabPanel>
      ))}
    </Tabs>
  );
}

function LoadedPromotionProfile({ promotionId }: { readonly promotionId: PromotionId }): ReactNode {
  const query = useEngineQuery('promotions.profile', { promotionId });
  const viewerPromotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  useDocumentTitle(query.data?.header.name ?? null);

  if (query.status === 'loading') return <PromotionProfileLoading />;
  if (query.status === 'error' || query.data === undefined) {
    return <PromotionNotFound reason={errorText(query.error)} />;
  }

  const profile = query.data;
  const context: PromotionTabContext = {
    profile,
    promotionId,
    isOwn: profile.header.controlledBy === 'you',
    viewerPromotionId,
  };
  return (
    <div className={styles['screen']}>
      <BackToPromotions />
      <PromotionHeader promotionId={promotionId} header={profile.header} />
      <PromotionTabs context={context} />
    </div>
  );
}

/**
 * One promotion's profile at `/game/promotions/:promotionId`: the header, then the tabs. The
 * built-in Overview, Roster and Decision log are joined by whatever other features registered with
 * `registerPromotionTab`. A promotion the engine does not know, an address that is not a
 * promotion's, or a world that cannot answer all show "Promotion not found" with a way back.
 */
export function PromotionProfileScreen() {
  const params = useParams();
  const promotionId = params[PROMOTION_ROUTE_PARAM];
  if (!isId('promotion', promotionId)) {
    return <PromotionNotFound reason="That address is not a promotion's." />;
  }
  // Keyed by promotion, so following a link from one profile to another starts clean.
  return <LoadedPromotionProfile key={promotionId} promotionId={promotionId} />;
}
