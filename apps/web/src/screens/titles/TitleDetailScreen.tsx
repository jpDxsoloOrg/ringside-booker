import { Fragment } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { isId } from '@ringside/engine';
import type { TitleDetail, TitleHolderCount, TitleId } from '@ringside/engine';
import { RouteHeading } from '@/app/a11y/RouteHeading';
import { useDocumentTitle } from '@/app/a11y/useDocumentTitle';
import type { EngineQueryError } from '@/app/engine/queryCache';
import { useEngineQuery } from '@/app/engine/useEngineQuery';
import { PromotionProfileLink, titlesListUrlFrom } from '@/app/entityLinks';
import { routes, TITLE_ROUTE_PARAM } from '@/app/routes';
import { Badge } from '@/components/Badge';
import { classNames } from '@/components/classNames';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate, formatNumber } from '@/components/format';
import { Icon } from '@/components/Icon';
import { ImageSlot } from '@/components/ImageSlot';
import { VisuallyHidden } from '@/components/layout';
import { Panel } from '@/components/Panel';
import { StatBar } from '@/components/StatBar';
import { Explained, traceSourceOf, WhyButton } from '@/components/Trace';
import { WorkerLink } from '@/components/WorkerLink';
import { beltTierOf } from './beltTier';
import { TitleActionBar } from './TitleActionMenus';
import { TitleActionOverlays } from './TitleActionOverlays';
import { reignDaysText, TitleLineageTable } from './TitleLineageTable';
import { TitleRecordsPanel } from './TitleRecordsPanel';
import { useTitleDetailSections, visibleTitleDetailSections } from './titleDetailSections';
import type { TitleDetailSectionColumn, TitleDetailSectionContext } from './titleDetailSections';
import styles from './Titles.module.css';
import { useTitleActions } from './useTitleActions';

const NOT_FOUND_TITLE = 'Title not found';
const LOADING_TITLE = 'Loading title';

/** "Singles", "Tag team", "Trios". */
export const HOLDER_COUNT_LABELS: Readonly<Record<TitleHolderCount, string>> = {
  1: 'Singles',
  2: 'Tag team',
  3: 'Trios',
};

function errorText(error: EngineQueryError | null): string {
  if (error === null) return 'Something went wrong.';
  if (error.kind === 'transport') return error.message;
  return error.reasons.map((reason) => reason.message).join(' ');
}

/** The link back to Titles: with the tab and filter it was left on, when it was the way in. */
function BackToTitles() {
  const location = useLocation();
  const listUrl = titlesListUrlFrom(location.state) ?? routes.game.titles();
  return (
    <Link to={listUrl} className={styles['backLink']}>
      <Icon name="back" size="sm" decorative />
      Back to Titles
    </Link>
  );
}

function TitleNotFound({ reason }: { readonly reason: string }) {
  useDocumentTitle(NOT_FOUND_TITLE);
  return (
    <div className={styles['screen']}>
      <RouteHeading className={styles['heading']}>{NOT_FOUND_TITLE}</RouteHeading>
      <EmptyState
        size="page"
        icon="titles"
        title="There is no title to show"
        body={
          <>
            {reason} <Link to={routes.game.titles()}>Back to Titles</Link>
          </>
        }
      />
    </div>
  );
}

function TitleDetailLoading() {
  useDocumentTitle('Title');
  return (
    <div className={styles['screen']} aria-busy="true">
      <BackToTitles />
      <div className={classNames(styles['skeleton'], styles['skeletonHeader'])}>
        <RouteHeading className={styles['heading']}>
          <VisuallyHidden>{LOADING_TITLE}</VisuallyHidden>
        </RouteHeading>
      </div>
      <div className={styles['skeletonGrid']}>
        <span className={classNames(styles['skeleton'], styles['skeletonCard'])} />
        <span className={classNames(styles['skeleton'], styles['skeletonCard'])} />
      </div>
    </div>
  );
}

/** The top of a title's page: belt, name, where it belongs, division, kind, dates and prestige. */
function TitleHeader({ detail }: { readonly detail: TitleDetail }) {
  const { title } = detail;
  const source = traceSourceOf(title.prestigeTrace, title.prestigeTraceRef);
  return (
    <header className={styles['detailHeader']}>
      <span className={styles['belt']}>
        <ImageSlot
          subject={{
            kind: 'title',
            id: title.titleId,
            name: title.name,
            tier: beltTierOf(title.prestige),
            ...(title.imageRef === null ? {} : { imageRef: title.imageRef }),
          }}
          size="lg"
          shape="square"
          decorative
        />
      </span>
      <div className={styles['identity']}>
        <RouteHeading className={styles['heading']}>{title.name}</RouteHeading>
        <p className={styles['belongs']}>
          <PromotionProfileLink promotionId={title.promotionId}>
            {title.promotionName}
          </PromotionProfileLink>
          <span aria-hidden="true"> · </span>
          <span>{title.brandName ?? 'Promotion-wide'}</span>
        </p>
        <div className={styles['chips']}>
          <Badge tone={title.status === 'active' ? 'positive' : 'neutral'}>
            {title.status === 'active' ? 'Active' : 'Retired'}
          </Badge>
        </div>
      </div>
      <dl className={styles['headerFacts']}>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Division</dt>
          <dd>{title.divisionLabel}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Kind</dt>
          <dd>{HOLDER_COUNT_LABELS[title.holderCount]}</dd>
        </div>
        <div className={styles['fact']}>
          <dt className={styles['factLabel']}>Introduced</dt>
          <dd>
            <time dateTime={title.introducedOn}>{formatGameDate(title.introducedOn)}</time>
          </dd>
        </div>
        {title.retiredOn !== null && (
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>Retired</dt>
            <dd>
              <time dateTime={title.retiredOn}>{formatGameDate(title.retiredOn)}</time>
            </dd>
          </div>
        )}
        <div className={classNames(styles['fact'], styles['prestigeFact'])}>
          <dt className={styles['factLabel']}>Prestige</dt>
          <dd className={styles['explained']}>
            <StatBar label="Prestige" hideLabel value={title.prestige} />
            {source !== null && (
              <WhyButton
                label="Prestige"
                value={title.prestige}
                panelTitle={`Prestige: ${title.name}`}
                source={source}
              />
            )}
          </dd>
        </div>
      </dl>
    </header>
  );
}

/** The current champion with their pictures, the day they won, days held and defences. */
function ChampionPanel({ detail }: { readonly detail: TitleDetail }) {
  const { title } = detail;
  const { champion } = title;
  if (champion === null) {
    const [latest] = detail.reigns;
    const retired = title.status === 'retired';
    const since = retired
      ? (title.retiredOn ?? title.introducedOn)
      : (latest?.lostOn ?? title.introducedOn);
    return (
      <Panel title="Champion" headingLevel={2}>
        <p className={styles['vacant']}>
          {retired ? 'Retired on ' : 'Vacant since '}
          <time dateTime={since}>{formatGameDate(since)}</time>
        </p>
      </Panel>
    );
  }
  const currentReign = detail.reigns.find((reign) => reign.reignId === champion.reignId);
  const daysText = reignDaysText(champion.daysHeld);
  return (
    <Panel title="Champion" headingLevel={2}>
      <div className={styles['championBody']}>
        <ul className={styles['holders']} aria-label="Champions">
          {champion.holders.map((holder) => (
            <li key={holder.personId} className={styles['holderItem']}>
              <ImageSlot
                subject={{
                  kind: 'person',
                  id: holder.personId,
                  name: holder.ringName,
                  ...(holder.imageRef === null ? {} : { imageRef: holder.imageRef }),
                }}
                size="md"
                decorative
              />
              <WorkerLink personId={holder.personId} name={holder.ringName} />
            </li>
          ))}
        </ul>
        {champion.teamId !== null && <p className={styles['teamName']}>{champion.label}</p>}
        <dl className={styles['facts']}>
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>Won</dt>
            <dd>
              <time dateTime={champion.wonOn}>{formatGameDate(champion.wonOn)}</time>
            </dd>
          </div>
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>Days held</dt>
            <dd>
              <Explained
                value={daysText}
                label="Days held"
                trace={currentReign?.daysHeldTrace ?? null}
              />
            </dd>
          </div>
          <div className={styles['fact']}>
            <dt className={styles['factLabel']}>Defences</dt>
            <dd className="tabular">{formatNumber(champion.defences)}</dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}

function RegisteredSections({
  column,
  context,
}: {
  readonly column: TitleDetailSectionColumn;
  readonly context: TitleDetailSectionContext;
}) {
  const sections = visibleTitleDetailSections(useTitleDetailSections(), column, context.detail);
  return (
    <>
      {sections.map((section) => (
        <Fragment key={section.id}>{section.render(context)}</Fragment>
      ))}
    </>
  );
}

function LoadedTitleDetail({ titleId }: { readonly titleId: TitleId }): ReactNode {
  const query = useEngineQuery('titles.detail', { titleId });
  const actions = useTitleActions();
  useDocumentTitle(query.data?.title.name ?? null);

  if (query.status === 'loading') return <TitleDetailLoading />;
  if (query.status === 'error' || query.data === undefined) {
    return <TitleNotFound reason={errorText(query.error)} />;
  }

  const detail = query.data;
  const context: TitleDetailSectionContext = { titleId, detail };
  return (
    <div className={styles['screen']}>
      <BackToTitles />
      <TitleHeader detail={detail} />
      <TitleActionBar row={detail.title} actions={actions} />
      <div className={styles['detailColumns']}>
        <div className={styles['column']}>
          <ChampionPanel detail={detail} />
          <Panel title="Lineage" headingLevel={2} padding="none">
            <TitleLineageTable reigns={detail.reigns} titleName={detail.title.name} />
          </Panel>
          <RegisteredSections column="main" context={context} />
        </div>
        <div className={styles['column']}>
          <TitleRecordsPanel records={detail.records} stats={detail.stats} reigns={detail.reigns} />
          <RegisteredSections column="side" context={context} />
        </div>
      </div>
      <TitleActionOverlays actions={actions} />
    </div>
  );
}

/**
 * One title's page at `/game/titles/:titleId`: the header (belt, name, promotion and brand,
 * division, kind, introduced date, Active or Retired, prestige with its Why?), the champion or
 * "Vacant since", the full lineage newest first and the records, then whatever sections other
 * features registered with `registerTitleDetailSection`. A title the engine does not know, or an
 * address that is not a title's, shows "Title not found" with a way back. For a title the player
 * runs, an action bar under the header edits, awards, vacates, retires or reactivates it.
 */
export function TitleDetailScreen() {
  const params = useParams();
  const titleId = params[TITLE_ROUTE_PARAM];
  if (!isId('title', titleId)) {
    return <TitleNotFound reason="That address is not a title's." />;
  }
  // Keyed by title, so following a link from one title to another starts clean.
  return <LoadedTitleDetail key={titleId} titleId={titleId} />;
}
