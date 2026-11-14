import { Link } from 'react-router-dom';
import type { To } from 'react-router-dom';
import type { NewsItemView, NewsNames, TraceNode } from '@ringside/engine';
import { useEntityLinkRenderer } from '@/app/entityLinks';
import { ChamferPanel } from '@/components/ChamferPanel';
import { classNames } from '@/components/classNames';
import { formatGameDate } from '@/components/format';
import { ImageSlot } from '@/components/ImageSlot';
import { SlashDivider } from '@/components/SlashDivider';
import { Explained } from '@/components/Trace';
import { renderTemplatedText, templatedTextToString } from '@/text/renderTemplatedText';
import { NewsKindTag } from './NewsKindTag';
import { newsSubjectOf } from './newsStory';
import { newsKindTone, shownBuzz } from './newsTone';
import styles from './NewsHeroCard.module.css';

export type NewsHeroCardSize = 'large' | 'small';

export interface NewsHeroCardProps {
  readonly item: NewsItemView;
  /** The names of every id the story mentions, from the query. */
  readonly names: NewsNames;
  /** Where the headline goes: the story sheet (`?story=<id>`). */
  readonly storyLink: To;
  /** The lead story is `large`; the others `small`. */
  readonly size?: NewsHeroCardSize;
  /** The buzz breakdown when the caller already has it (the gallery); else `buzzTraceRef`. */
  readonly buzzTrace?: TraceNode | undefined;
}

/**
 * One of the front page's biggest stories, in the broadcast kit: the kind tag in its tone and the
 * date, the headline as the link to the story, two lines of the body, a picture of the first person
 * (or promotion) it is about, and its buzz with a Why?.
 */
export function NewsHeroCard({
  item,
  names,
  storyLink,
  size = 'small',
  buzzTrace,
}: NewsHeroCardProps) {
  const renderEntityLink = useEntityLinkRenderer();
  const subject = newsSubjectOf(item, names);
  const headline = templatedTextToString(item.headline, { names });
  return (
    <ChamferPanel
      as="article"
      accent={newsKindTone(item.kind)}
      surface={size === 'large' ? 'raised' : 'default'}
      className={classNames(styles['card'], styles[size])}
    >
      <div className={styles['layout']} data-size={size}>
        {subject !== null && (
          <div className={styles['picture']}>
            <ImageSlot subject={subject} size={size === 'large' ? 'xl' : 'lg'} decorative />
          </div>
        )}
        <div className={styles['story']}>
          <p className={styles['meta']}>
            <NewsKindTag kind={item.kind} label={item.kindLabel} />
            <SlashDivider variant="inline" />
            <span className="tabular">{formatGameDate(item.date, 'short')}</span>
          </p>
          <h3 className={styles['headline']}>
            <Link to={storyLink} className={styles['headlineLink']}>
              {headline}
            </Link>
          </h3>
          <p className={styles['excerpt']}>
            {renderTemplatedText(item.body, { names, renderEntityLink })}
          </p>
          <p className={styles['buzz']}>
            <span className={styles['buzzLabel']}>Buzz</span>
            <Explained
              value={shownBuzz(item.buzz)}
              label="Buzz"
              {...(buzzTrace === undefined
                ? { traceRef: item.buzzTraceRef }
                : { trace: buzzTrace })}
            />
          </p>
        </div>
      </div>
    </ChamferPanel>
  );
}
