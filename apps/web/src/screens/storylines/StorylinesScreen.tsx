import { useState } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { StorylineListView, StorylineRow } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { routes } from '@/app/routes';
import { useSessionStore } from '@/app/session/sessionStore';
import { CountBadge } from '@/components/Badge';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { Panel } from '@/components/Panel';
import { StorylineCard } from '@/components/StorylineCard';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import { StorylineEditorSheet } from './StorylineEditorSheet';
import { isNoWorldError, NO_GAME_TEXT, NO_GAME_TITLE, queryErrorText } from './storylineText';
import styles from './StorylinesScreen.module.css';

const TITLE = 'Storylines';

export const STORYLINE_TABS = ['active', 'ended'] as const;
export type StorylineTab = (typeof STORYLINE_TABS)[number];

const TAB_LABELS: Readonly<Record<StorylineTab, string>> = {
  active: 'Active',
  ended: 'Ended',
};

/** The search parameter that holds the tab, so Back from a storyline returns to it. */
export const STORYLINES_TAB_PARAM = 'tab';

/** What each tab says when it has no storylines. */
export const EMPTY_TAB_TITLES: Readonly<Record<StorylineTab, string>> = {
  active: 'No storylines yet',
  ended: 'No ended storylines',
};

function isStorylineTab(value: string | null): value is StorylineTab {
  return value === 'active' || value === 'ended';
}

/** "You run 6 storylines; it gets hard to keep them all hot." */
export function softLimitText(activeCount: number): string {
  return `You run ${formatNumber(activeCount)} storylines. It gets hard to keep them all hot; you can still start more.`;
}

/** "3 active · 1 ended". */
function countsText(active: number, ended: number): string {
  return `${formatNumber(active)} active · ${formatNumber(ended)} ended`;
}

interface StorylineGridProps {
  readonly rows: readonly StorylineRow[];
  readonly hotFrom: number;
  readonly tab: StorylineTab;
  readonly onNew: (() => void) | null;
}

function StorylineGrid({ rows, hotFrom, tab, onNew }: StorylineGridProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="storylines"
        title={EMPTY_TAB_TITLES[tab]}
        body={
          tab === 'active'
            ? 'Start a storyline to give your feuds heat that builds show to show.'
            : 'Storylines you end move here.'
        }
        {...(tab === 'active' && onNew !== null
          ? {
              action: (
                <Button iconStart="add" onClick={onNew}>
                  New storyline
                </Button>
              ),
            }
          : {})}
      />
    );
  }
  return (
    <ul className={styles['grid']} aria-label={`${TAB_LABELS[tab]} storylines`}>
      {rows.map((row) => (
        <li key={row.id} className={styles['gridItem']}>
          <StorylineCard row={row} hotFrom={hotFrom} href={routes.game.storyline(row.id)} />
        </li>
      ))}
    </ul>
  );
}

interface StorylineTabsProps {
  readonly list: StorylineListView;
  readonly tab: StorylineTab;
  readonly onTabChange: (tab: string) => void;
  readonly onNew: (() => void) | null;
}

function StorylineTabs({ list, tab, onTabChange, onNew }: StorylineTabsProps) {
  const rowsOf = (value: StorylineTab): StorylineRow[] =>
    list.rows.filter((row) => row.status === value);
  return (
    <Tabs value={tab} onChange={onTabChange}>
      <TabList label="Storyline lists">
        {STORYLINE_TABS.map((value) => {
          const count = rowsOf(value).length;
          return (
            <Tab key={value} value={value}>
              <span className={styles['tabLabel']}>
                {TAB_LABELS[value]}
                <CountBadge
                  count={count}
                  showZero
                  tone="neutral"
                  variant="soft"
                  label={`(${formatNumber(count)})`}
                />
              </span>
            </Tab>
          );
        })}
      </TabList>
      {STORYLINE_TABS.map((value) => (
        <TabPanel key={value} value={value}>
          {value === tab && (
            <StorylineGrid rows={rowsOf(value)} hotFrom={list.hotFrom} tab={value} onNew={onNew} />
          )}
        </TabPanel>
      ))}
    </Tabs>
  );
}

/**
 * Creative > Storylines: the promotion's storylines as cards on an Active and an Ended tab, each
 * card with its people by side and its heat. New storyline opens the create sheet; a card's name
 * opens the storyline's page. Past the soft limit a notice says so, without stopping anything.
 */
export function StorylinesScreen() {
  useDocumentTitle(TITLE);
  const promotionId = useSessionStore((state) => state.seat?.promotionId ?? null);
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get(STORYLINES_TAB_PARAM);
  const tab: StorylineTab = isStorylineTab(requested) ? requested : 'active';
  const [creating, setCreating] = useState(false);
  // Both tabs from one answer, so each tab's count is known whichever is open.
  const query = useEngineQuery(
    'storylines.list',
    { status: 'all', ...(promotionId === null ? {} : { promotionId }) },
    { keepPreviousData: true },
  );
  const list = query.data;
  const editable = list?.editable ?? false;
  const openCreate = editable
    ? () => {
        setCreating(true);
      }
    : null;

  const changeTab = (value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value === 'active') {
      next.delete(STORYLINES_TAB_PARAM);
    } else {
      next.set(STORYLINES_TAB_PARAM, value);
    }
    setSearchParams(next, { replace: true });
  };

  let body: ReactNode;
  if (query.status === 'loading') {
    body = (
      <p className={styles['muted']} aria-busy="true">
        Loading storylines…
      </p>
    );
  } else if (query.status === 'error' || list === undefined) {
    body = isNoWorldError(query.error) ? (
      <EmptyState size="page" icon="storylines" title={NO_GAME_TITLE} body={NO_GAME_TEXT} />
    ) : (
      <EmptyState
        size="page"
        icon="storylines"
        title="Storylines can't be shown"
        body={queryErrorText(query.error)}
      />
    );
  } else {
    body = <StorylineTabs list={list} tab={tab} onTabChange={changeTab} onNew={openCreate} />;
  }

  return (
    <div className={styles['screen']}>
      <div className={styles['intro']}>
        <RouteHeading className={styles['heading']}>{TITLE}</RouteHeading>
        {list !== undefined && (
          <p className={styles['count']}>
            {countsText(list.activeCount, list.rows.length - list.activeCount)}
          </p>
        )}
        {openCreate !== null && (
          <Button iconStart="add" className={styles['newButton']} onClick={openCreate}>
            New storyline
          </Button>
        )}
      </div>
      {list !== undefined && editable && list.activeCount >= list.softLimit && (
        <Panel title="Lots of storylines" headingLevel={2} className={styles['notice']}>
          <p className={styles['noticeText']}>{softLimitText(list.activeCount)}</p>
        </Panel>
      )}
      {body}
      {editable && (
        <StorylineEditorSheet
          mode="create"
          open={creating}
          onClose={() => {
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
