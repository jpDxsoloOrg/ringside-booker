import { useCallback, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { TitleGroup, TitleListResult } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { ChampionCardList } from '@/components/ChampionCard';
import { classNames } from '@/components/classNames';
import { EmptyState } from '@/components/EmptyState';
import { formatNumber } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import type { ImageSubject } from '@/components/ImageSlot';
import { VisuallyHidden } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { RadioGroup } from '@/components/RadioGroup';
import type { RadioOption } from '@/components/RadioGroup';
import { Tab, TabList, TabPanel, Tabs } from '@/components/Tabs';
import { TitleCard } from './titleCard';
import styles from './Titles.module.css';
import {
  isTitlesStatus,
  isTitlesTab,
  searchWithTitlesView,
  titlesViewFromSearch,
} from './titlesListParams';
import type { TitlesStatus, TitlesTab, TitlesView } from './titlesListParams';

const TITLE = 'Titles';

const TAB_LABELS: Readonly<Record<TitlesTab, string>> = {
  own: 'Our titles',
  world: 'Around the world',
};

/** How many quiet cards stand in for the titles while they load. */
const SKELETON_CARDS = ['one', 'two', 'three'] as const;

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

/** "Active (6)", "Retired (0)". */
export function statusOptionLabel(status: TitlesStatus, count: number | null): string {
  const word = status === 'active' ? 'Active' : 'Retired';
  return count === null ? word : `${word} (${formatNumber(count)})`;
}

/** The group's heading words: the brand, "Promotion-wide", or the promotion's name. */
export function groupName(group: TitleGroup): string {
  return group.brandName ?? group.promotionName;
}

/** The picture beside a group's name: the brand's logo, or the promotion's. */
function groupLogo(group: TitleGroup): ImageSubject {
  const logo = group.logoRef === null ? {} : { imageRef: group.logoRef };
  if (group.brandId !== null) {
    return { kind: 'brand', id: group.brandId, name: groupName(group), ...logo };
  }
  return { kind: 'promotion', id: group.promotionId, name: group.promotionName, ...logo };
}

function TitleGroupPanel({ group }: { readonly group: TitleGroup }) {
  const name = groupName(group);
  return (
    <Panel
      className={styles['group']}
      title={
        <span className={styles['groupHeading']}>
          <ImageSlot subject={groupLogo(group)} size="sm" decorative />
          <span>{name}</span>
        </span>
      }
      subtitle={`${formatNumber(group.titles.length)} ${group.titles.length === 1 ? 'title' : 'titles'}`}
    >
      <ChampionCardList label={`${name} titles`} phoneLayout="stack">
        {group.titles.map((row) => (
          <TitleCard key={row.titleId} row={row} />
        ))}
      </ChampionCardList>
    </Panel>
  );
}

function TitlesLoading() {
  return (
    <div className={styles['groups']} aria-busy="true">
      <VisuallyHidden>Loading titles</VisuallyHidden>
      <div className={styles['skeletonGrid']}>
        {SKELETON_CARDS.map((key) => (
          <span key={key} className={classNames(styles['skeleton'], styles['skeletonCard'])} />
        ))}
      </div>
    </div>
  );
}

interface TitleGroupsProps {
  readonly view: TitlesView;
  readonly result: TitleListResult;
}

function TitleGroups({ view, result }: TitleGroupsProps) {
  if (result.groups.length === 0) {
    if (view.status === 'retired') {
      return (
        <EmptyState
          icon="titles"
          title="No retired titles"
          body="Every title here is still active. A retired title keeps its lineage and shows up here."
        />
      );
    }
    return (
      <EmptyState
        icon="titles"
        title="No titles"
        body={
          view.tab === 'own'
            ? 'Your promotion has no active titles.'
            : 'No other promotion has an active title.'
        }
      />
    );
  }
  return (
    <div className={styles['groups']}>
      {result.groups.map((group) => (
        <TitleGroupPanel key={group.key} group={group} />
      ))}
    </div>
  );
}

/**
 * Creative > Titles: our titles grouped by brand (then the promotion-wide ones) and, on the second
 * tab, every other promotion's titles grouped by promotion, each as a champion card with its
 * prestige Why?. The tab and the Active / Retired filter live in the URL (`?tab=world`,
 * `?status=retired`), so Back from a title's page returns to the same view. Read-only: creating,
 * awarding and the rest arrive with CRTV1-05.
 */
export function TitlesScreen() {
  useDocumentTitle(TITLE);
  const [searchParams, setSearchParams] = useSearchParams();
  const view = useMemo(() => titlesViewFromSearch(searchParams), [searchParams]);
  const args = useMemo(() => ({ scope: view.tab, status: view.status }), [view]);
  const query = useEngineQuery('titles.list', args, { keepPreviousData: false });

  // Replace, so Back leaves the screen instead of stepping through every tab and filter change.
  const changeView = useCallback(
    (next: TitlesView): void => {
      setSearchParams((current) => searchWithTitlesView(current, next), { replace: true });
    },
    [setSearchParams],
  );
  const selectTab = (value: string): void => {
    if (isTitlesTab(value)) changeView({ ...view, tab: value });
  };
  const selectStatus = (value: string): void => {
    if (isTitlesStatus(value)) changeView({ ...view, status: value });
  };

  const counts = query.status === 'success' ? (query.data?.counts ?? null) : null;
  const statusOptions: readonly RadioOption<TitlesStatus>[] = [
    { value: 'active', label: statusOptionLabel('active', counts?.active ?? null) },
    { value: 'retired', label: statusOptionLabel('retired', counts?.retired ?? null) },
  ];

  const body = (): ReactNode => {
    if (query.status === 'error') {
      return (
        <EmptyState
          size="page"
          icon="titles"
          title="The titles could not be loaded"
          body={errorText(query.error)}
        />
      );
    }
    if (query.data === undefined) return <TitlesLoading />;
    return <TitleGroups view={view} result={query.data} />;
  };

  // One tree for every state, so the heading focused on arrival stays mounted as the query settles.
  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['heading']}>{TITLE}</RouteHeading>
      <Tabs value={view.tab} onChange={selectTab}>
        <TabList label={TITLE}>
          <Tab value="own">{TAB_LABELS.own}</Tab>
          <Tab value="world">{TAB_LABELS.world}</Tab>
        </TabList>
        <RadioGroup
          className={classNames(styles['statusFilter'])}
          legend="Show"
          layout="row"
          options={statusOptions}
          value={view.status}
          onValueChange={selectStatus}
        />
        <TabPanel value="own" className={classNames(styles['tabPanel'])}>
          {body()}
        </TabPanel>
        <TabPanel value="world" className={classNames(styles['tabPanel'])}>
          {body()}
        </TabPanel>
      </Tabs>
    </div>
  );
}
