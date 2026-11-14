import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { isId } from '@ringside/engine';
import type { PersonId } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { workersListUrlFrom } from '@/app/entityLinks';
import { routes, WORKER_ROUTE_PARAM } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { classNames } from '@/components/classNames';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icon';
import { VisuallyHidden } from '@/components/layout';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import { BUILTIN_PROFILE_TABS } from './builtinTabs';
import { orderProfileActions, useProfileActions } from './profileActions';
import { DEFAULT_PROFILE_TAB_ID, useProfileTabs, visibleProfileTabs } from './profileTabs';
import type { ProfileTabContext } from './profileTabs';
import styles from './WorkerProfile.module.css';
import { WorkerProfileHeader } from './WorkerProfileHeader';

/** The search parameter that holds the selected tab: `?tab=attributes`. */
export const PROFILE_TAB_PARAM = 'tab';

const NOT_FOUND_TITLE = 'Worker not found';
const LOADING_TITLE = 'Loading worker';

/** The link back to the workers list: with the filters it was left with, when it was the way in. */
function BackToWorkers() {
  const location = useLocation();
  const listUrl = workersListUrlFrom(location.state) ?? routes.game.workers();
  return (
    <Link to={listUrl} className={styles['backLink']}>
      <Icon name="back" size="sm" decorative />
      Back to Workers
    </Link>
  );
}

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

function WorkerNotFound({ reason }: { readonly reason: string }) {
  useDocumentTitle(NOT_FOUND_TITLE);
  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['heading']}>{NOT_FOUND_TITLE}</RouteHeading>
      <EmptyState
        size="page"
        icon="user-search"
        title="There is no profile to show"
        body={
          <>
            {reason} <Link to={routes.game.workers()}>Back to Workers</Link>
          </>
        }
      />
    </div>
  );
}

/** How many facts the header shows for someone under contract: the skeleton holds their place. */
const SKELETON_FACTS = 6;
const SKELETON_PANELS = 4;

function skeletonKeys(count: number): readonly string[] {
  return Array.from({ length: count }, (_, index) => String(index));
}

/** The profile's shape in quiet blocks: header card, tab strip and the Overview's panels. */
function WorkerProfileLoading() {
  useDocumentTitle('Worker');
  return (
    <div className={styles['screen']} aria-busy="true">
      <BackToWorkers />
      <div className={classNames(styles['header'], styles['skeletonHeader'])}>
        <span className={classNames(styles['skeleton'], styles['skeletonPicture'])} />
        <div className={styles['identity']}>
          <RouteHeading className={styles['heading']}>
            <VisuallyHidden>{LOADING_TITLE}</VisuallyHidden>
            <span className={classNames(styles['skeleton'], styles['skeletonHeading'])} />
          </RouteHeading>
          <span className={classNames(styles['skeleton'], styles['skeletonChips'])} />
        </div>
        <div className={styles['facts']}>
          {skeletonKeys(SKELETON_FACTS).map((key) => (
            <span key={key} className={classNames(styles['skeleton'], styles['skeletonFact'])} />
          ))}
        </div>
      </div>
      <span className={classNames(styles['skeleton'], styles['skeletonTabs'])} />
      <div className={styles['overview']}>
        {skeletonKeys(SKELETON_PANELS).map((key) => (
          <span key={key} className={classNames(styles['skeleton'], styles['skeletonPanel'])} />
        ))}
      </div>
    </div>
  );
}

interface ProfileTabsProps {
  readonly context: ProfileTabContext;
}

/** The tab strip and the selected tab's panel. The selection lives in the URL. */
function ProfileTabs({ context }: ProfileTabsProps) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const registered = useProfileTabs();
  const tabs = visibleProfileTabs([...BUILTIN_PROFILE_TABS, ...registered], context);
  const requested = searchParams.get(PROFILE_TAB_PARAM);
  // An unknown tab, or one hidden for this person, falls back to Overview.
  const selected = tabs.find((tab) => tab.id === requested)?.id ?? DEFAULT_PROFILE_TAB_ID;

  const select = (tabId: string): void => {
    const next = new URLSearchParams(searchParams);
    if (tabId === DEFAULT_PROFILE_TAB_ID) {
      next.delete(PROFILE_TAB_PARAM);
    } else {
      next.set(PROFILE_TAB_PARAM, tabId);
    }
    // Replace, so Back leaves the profile instead of stepping through tabs, and keep the state
    // the back link reads the list's filters from.
    setSearchParams(next, { replace: true, state: location.state as unknown });
  };

  return (
    <Tabs value={selected} onChange={select}>
      <TabList label={`${context.profile.header.ringName} profile`}>
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

/** The actions other features add under the header (ECO5-06's Offer contract), in order. */
function ProfileActionsRow({ context }: { readonly context: ProfileTabContext }) {
  const actions = orderProfileActions(useProfileActions());
  if (actions.length === 0) return null;
  return (
    <div className={styles['actions']}>
      {actions.map((action) => (
        <Fragment key={action.id}>{action.render(context)}</Fragment>
      ))}
    </div>
  );
}

function LoadedWorkerProfile({ personId }: { readonly personId: PersonId }): ReactNode {
  const query = useEngineQuery('workers.profile', { personId });
  const viewerPromotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  const ringName = query.data?.header.ringName ?? null;
  useDocumentTitle(ringName);

  if (query.status === 'loading') return <WorkerProfileLoading />;
  if (query.status === 'error' || query.data === undefined) {
    return <WorkerNotFound reason={errorText(query.error)} />;
  }

  const profile = query.data;
  return (
    <div className={styles['screen']}>
      <BackToWorkers />
      <WorkerProfileHeader header={profile.header} />
      <ProfileActionsRow context={{ profile, personId, viewerPromotionId }} />
      <ProfileTabs context={{ profile, personId, viewerPromotionId }} />
    </div>
  );
}

/**
 * One worker's profile at `/game/workers/:personId`: the header, then the tabs. The four built-in
 * tabs are joined by whatever other features registered with `registerProfileTab`. A person the
 * engine does not know, an address that is not a person's, or a world that cannot answer all show
 * "Worker not found" with the reason and a way back.
 */
export function WorkerProfileScreen() {
  const params = useParams();
  const personId = params[WORKER_ROUTE_PARAM];
  if (!isId('person', personId)) {
    return <WorkerNotFound reason="That address is not a worker's." />;
  }
  // Keyed by person, so following a link from one profile to another starts from a clean slate.
  return <LoadedWorkerProfile key={personId} personId={personId} />;
}
