import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DealId, NetworkId, PromotionId } from '@ringside/engine';
import { useAnnounce } from '@/app/a11y/LiveAnnouncer';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { useSessionStore } from '@/app/session/sessionStore';
import { EmptyState } from '@/components/EmptyState';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import { isNoWorldError } from '@/screens/storylines/storylineText';
import './builtinTabs';
import { DealSheet } from './DealSheet';
import {
  dealFromSearch,
  DEAL_PARAM,
  PROPOSE_PARAM,
  proposeFromSearch,
  searchWith,
  TAB_PARAM,
  YOUR_DEALS_TAB_ID,
} from './networksParams';
import { ProposeDealSheet } from './ProposeDealSheet';
import { useNetworksTabs } from './registry';
import type { NetworksTabContext } from './registry';
import styles from './Networks.module.css';

const TITLE = 'Networks';

export const NO_PROMOTION_TITLE = "You don't run a promotion";
export const NO_GAME_TITLE = 'No game loaded';

/**
 * Business > Networks at `/game/networks`: your TV, streaming and pay-per-view deals and the
 * networks that would take your shows, on tabs from `registerNetworksTab`. The tab (`?tab=`), the
 * open deal (`?deal=`) and the Propose sheet (`?propose=`) live in the URL, so links, a reload and
 * Back land in the same place.
 */
export function NetworksScreen() {
  useDocumentTitle(TITLE);
  const promotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{TITLE}</RouteHeading>
        <p className={styles['lead']}>
          The networks that air your shows and pay you for them. Press the ? beside a figure to see
          how it was worked out.
        </p>
      </div>
      {promotionId === null ? (
        <EmptyState
          size="page"
          icon="tv"
          title={NO_PROMOTION_TITLE}
          body="Only a promotion signs TV deals."
          headingLevel={2}
        />
      ) : (
        <NetworksView promotionId={promotionId} />
      )}
    </div>
  );
}

interface NetworksViewProps {
  readonly promotionId: PromotionId;
}

function NetworksView({ promotionId }: NetworksViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const announce = useAnnounce();
  const tabs = useNetworksTabs();
  const requested = searchParams.get(TAB_PARAM);
  const selected = tabs.find((tab) => tab.id === requested)?.id ?? tabs[0]?.id ?? YOUR_DEALS_TAB_ID;
  const dealId = dealFromSearch(searchParams);
  const proposeId = proposeFromSearch(searchParams);
  const [focusDealId, setFocusDealId] = useState<DealId | null>(null);
  // Asked once here, so a world that cannot answer shows one message instead of a broken tab.
  const probe = useEngineQuery('clock.get', {});

  const openTab = useCallback(
    (tabId: string): void => {
      setSearchParams((current) => searchWith(current, TAB_PARAM, tabId), { replace: true });
    },
    [setSearchParams],
  );
  const openDeal = useCallback(
    (next: DealId): void => {
      setSearchParams((current) => searchWith(current, DEAL_PARAM, next));
    },
    [setSearchParams],
  );
  const closeDeal = useCallback((): void => {
    setSearchParams((current) => searchWith(current, DEAL_PARAM, null), { replace: true });
  }, [setSearchParams]);
  const openPropose = useCallback(
    (next: NetworkId): void => {
      setSearchParams((current) => searchWith(current, PROPOSE_PARAM, next));
    },
    [setSearchParams],
  );
  const closePropose = useCallback((): void => {
    setSearchParams((current) => searchWith(current, PROPOSE_PARAM, null), { replace: true });
  }, [setSearchParams]);
  const signed = useCallback(
    (newDealId: DealId, networkName: string): void => {
      setSearchParams(
        (current) =>
          searchWith(searchWith(current, PROPOSE_PARAM, null), TAB_PARAM, YOUR_DEALS_TAB_ID),
        { replace: true },
      );
      setFocusDealId(newDealId);
      announce(`Deal signed with ${networkName}`);
    },
    [setSearchParams, announce],
  );
  const onDealFocused = useCallback((): void => {
    setFocusDealId(null);
  }, []);

  if (probe.status === 'error') {
    return isNoWorldError(probe.error) ? (
      <EmptyState
        size="page"
        icon="tv"
        title={NO_GAME_TITLE}
        body="Start or load a game to see its networks."
        headingLevel={2}
      />
    ) : (
      <EmptyState size="page" icon="tv" title="The networks can't be shown" headingLevel={2} />
    );
  }

  const context: NetworksTabContext = {
    promotionId,
    openTab,
    openDeal,
    openPropose,
    focusDealId,
    onDealFocused,
  };

  let content: ReactNode = null;
  if (tabs.length > 0) {
    content = (
      <Tabs value={selected} onChange={openTab}>
        <TabList label="Networks sections">
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

  return (
    <>
      {content}
      <DealSheet promotionId={promotionId} dealId={dealId} onClose={closeDeal} />
      <ProposeDealSheet
        promotionId={promotionId}
        networkId={proposeId}
        onClose={closePropose}
        onSigned={signed}
      />
    </>
  );
}
