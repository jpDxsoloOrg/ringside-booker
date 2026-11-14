import { Link } from 'react-router-dom';
import type { NewsItemView, NewsNames, TraceNode } from '@ringside/engine';
import { routes } from '@/app/routes';
import { useNewsEntityLink } from './newsEntityLink';
import { EmptyState } from '@/components/EmptyState';
import { formatGameDate } from '@/components/format';
import { Icon } from '@/components/Icon';
import { Sheet } from '@/components/Sheet';
import { SlashDivider } from '@/components/SlashDivider';
import { Explained } from '@/components/Trace';
import { renderTemplatedText, templatedTextToString } from '@/text/renderTemplatedText';
import { NewsKindTag } from './NewsKindTag';
import { newsEntitiesOf } from './newsStory';
import { NEWS_IMPORTANCE_LABELS, shownBuzz } from './newsTone';
import styles from './NewsStorySheet.module.css';

/** What the sheet has to show: the story, its refusal, or nothing yet. */
export type NewsStoryState =
  | { readonly status: 'loading' }
  | { readonly status: 'found'; readonly item: NewsItemView; readonly names: NewsNames }
  | { readonly status: 'notFound'; readonly reason: string };

export interface NewsStorySheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly story: NewsStoryState;
  /** The buzz breakdown when the caller already has it (the gallery); else `buzzTraceRef`. */
  readonly buzzTrace?: TraceNode | undefined;
}

/** The link to the show's results, for a story about a show (`refs.eventInstanceId`). */
export const SEE_RESULTS_TEXT = 'See results';

/** "Leaves the archive on <date>", or "Kept in the archive" for a story that never expires. */
export function archiveText(item: Pick<NewsItemView, 'expiresOn'>): string {
  return item.expiresOn === null
    ? 'Kept in the archive'
    : `Leaves the archive on ${formatGameDate(item.expiresOn, 'long')}`;
}

interface StoryBodyProps {
  readonly item: NewsItemView;
  readonly names: NewsNames;
  readonly buzzTrace: TraceNode | undefined;
}

function StoryBody({ item, names, buzzTrace }: StoryBodyProps) {
  const renderEntityLink = useNewsEntityLink();
  const entities = newsEntitiesOf(item, names);
  return (
    <div className={styles['story']}>
      <p className={styles['meta']}>
        <NewsKindTag kind={item.kind} label={item.kindLabel} />
        <SlashDivider variant="inline" />
        <span className="tabular">{formatGameDate(item.date, 'long')}</span>
      </p>
      <p className={styles['body']}>
        {renderTemplatedText(item.body, { names, renderEntityLink })}
      </p>
      {entities.length > 0 && (
        <section className={styles['section']} aria-labelledby={`${item.id}-who`}>
          <h3 id={`${item.id}-who`} className={styles['sectionTitle']}>
            Who&apos;s in this story
          </h3>
          <ul className={styles['who']}>
            {entities.map((entity) => (
              <li key={entity.id}>{renderEntityLink(entity, entity.name)}</li>
            ))}
          </ul>
        </section>
      )}
      <dl className={styles['facts']}>
        <div className={styles['fact']}>
          <dt>Importance</dt>
          <dd>{NEWS_IMPORTANCE_LABELS[item.importance]}</dd>
        </div>
        <div className={styles['fact']}>
          <dt>Buzz</dt>
          <dd>
            <Explained
              value={shownBuzz(item.buzz)}
              label="Buzz"
              {...(buzzTrace === undefined
                ? { traceRef: item.buzzTraceRef }
                : { trace: buzzTrace })}
            />
          </dd>
        </div>
      </dl>
      {item.refs.eventInstanceId !== null && (
        <Link className={styles['results']} to={routes.game.showResults(item.refs.eventInstanceId)}>
          {SEE_RESULTS_TEXT}
          <Icon name="chevron-right" size="sm" decorative />
        </Link>
      )}
      <p className={styles['archive']}>{archiveText(item)}</p>
    </div>
  );
}

/**
 * One story, opened from the front page or the feed (`?story=<newsId>`): a side sheet on desktop
 * and a bottom sheet on a phone. The headline names the sheet; under it the kind and date, the full
 * story with its names linked, who it is about, its importance, its buzz with a Why?, and how long
 * the archive keeps it. A story that has gone says so.
 */
export function NewsStorySheet({ open, onClose, story, buzzTrace }: NewsStorySheetProps) {
  let title = 'Story';
  if (story.status === 'found') {
    title = templatedTextToString(story.item.headline, { names: story.names });
  } else if (story.status === 'notFound') {
    title = 'Story not found';
  }
  return (
    <Sheet open={open} onClose={onClose} title={title} side="right" size="md">
      {story.status === 'loading' && (
        <p className={styles['notice']} role="status">
          Loading the story…
        </p>
      )}
      {story.status === 'notFound' && (
        <EmptyState icon="newspaper" title="This story can't be shown" body={story.reason} />
      )}
      {story.status === 'found' && (
        <StoryBody item={story.item} names={story.names} buzzTrace={buzzTrace} />
      )}
    </Sheet>
  );
}
