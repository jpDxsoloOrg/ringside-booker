import { Fragment } from 'react';
import { Link } from 'react-router-dom';
import type { To } from 'react-router-dom';
import type { NewsItemView, NewsNames } from '@ringside/engine';
import { Badge } from '@/components/Badge';
import type { ColumnDef } from '@/components/DataTable';
import { formatGameDate } from '@/components/format';
import { Explained } from '@/components/Trace';
import type { EntityLinkRenderer } from '@/components/Trace/rows/rowTypes';
import { templatedTextToString } from '@/text/renderTemplatedText';
import { newsEntitiesOf } from './newsStory';
import { NEWS_IMPORTANCE_LABELS, newsKindTone } from './newsTone';
import styles from './NewsScreen.module.css';

export interface NewsColumnsInput {
  readonly names: NewsNames;
  readonly storyLinkOf: (item: NewsItemView) => To;
  readonly renderEntityLink: EntityLinkRenderer;
}

/** The feed's columns: date, kind, headline (the way into the story), who, importance and buzz. */
export function newsColumns({
  names,
  storyLinkOf,
  renderEntityLink,
}: NewsColumnsInput): ColumnDef<NewsItemView>[] {
  return [
    {
      id: 'date',
      header: 'Date',
      cell: (item) => <span className="tabular">{formatGameDate(item.date, 'short')}</span>,
      sortValue: (item) => item.date,
      width: 'sm',
      card: 'meta',
      hideable: false,
    },
    {
      id: 'kind',
      header: 'Kind',
      cell: (item) => <Badge tone={newsKindTone(item.kind)}>{item.kindLabel}</Badge>,
      width: 'sm',
      card: 'subtitle',
    },
    {
      id: 'headline',
      header: 'Headline',
      cell: (item) => (
        <Link to={storyLinkOf(item)} className={styles['headlineLink']}>
          {templatedTextToString(item.headline, { names })}
        </Link>
      ),
      filterValue: (item) => templatedTextToString(item.headline, { names }),
      width: 'auto',
      card: 'title',
      hideable: false,
    },
    {
      id: 'who',
      header: 'Who',
      cell: (item) => {
        const entities = newsEntitiesOf(item, names);
        if (entities.length === 0) return <span className={styles['none']}>—</span>;
        return (
          <span className={styles['who']}>
            {entities.map((entity, index) => (
              <Fragment key={entity.id}>
                {index > 0 && ', '}
                {renderEntityLink(entity, entity.name)}
              </Fragment>
            ))}
          </span>
        );
      },
      filterValue: (item) =>
        newsEntitiesOf(item, names)
          .map((entity) => entity.name)
          .join(' '),
      width: 'md',
      card: 'meta',
    },
    {
      id: 'importance',
      header: 'Importance',
      cell: (item) => NEWS_IMPORTANCE_LABELS[item.importance],
      width: 'sm',
      card: 'hidden',
    },
    {
      id: 'buzz',
      header: 'Buzz',
      cell: (item) => <Explained value={item.buzz} label="Buzz" traceRef={item.buzzTraceRef} />,
      align: 'end',
      numeric: true,
      width: 'sm',
      card: 'stat',
    },
  ];
}
