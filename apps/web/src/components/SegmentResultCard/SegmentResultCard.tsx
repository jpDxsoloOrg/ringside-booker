import { useId } from 'react';
import type { ReactNode } from 'react';
import type {
  PersonId,
  SegmentResultView,
  SegmentSideView,
  SegmentTitleView,
} from '@ringside/engine';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import { ImageSlot } from '../ImageSlot';
import type { ImageSubject } from '../ImageSlot';
import { SlashDivider } from '../SlashDivider';
import { StarRating } from '../StarRating';
import { Explained, WhyButton } from '../Trace';
import {
  comingUpText,
  resultLine,
  segmentResultAccent,
  slotHeadingLabel,
  titleBannerText,
  winningSideOf,
} from './segmentResultText';
import styles from './SegmentResultCard.module.css';

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export interface SegmentResultCardProps {
  /** One finished segment, as `shows.results` returns it. */
  readonly segment: SegmentResultView;
  /** Heading level of the slot title. 3 by default. */
  readonly headingLevel?: 2 | 3 | 4;
  /**
   * False draws the "Coming up" placeholder at the card's full height, so a results page can
   * reveal cards one by one without the page jumping. True by default.
   */
  readonly revealed?: boolean;
  /** Draws a person's name, such as a `WorkerLink` to their profile. Plain text by default. */
  readonly renderPersonLink?: (personId: PersonId, name: string) => ReactNode;
  /** Extra content under the card, such as a link to the segment's details. */
  readonly footer?: ReactNode;
  readonly className?: string | undefined;
}

function personSubject(member: SegmentSideView['members'][number]): ImageSubject {
  return {
    kind: 'person',
    id: member.personId,
    name: member.name,
    ...(member.imageRef === null ? {} : { imageRef: member.imageRef }),
  };
}

interface SideProps {
  readonly side: SegmentSideView;
  readonly result: 'won' | 'lost' | 'even';
  readonly interactive: boolean;
  readonly renderPersonLink: SegmentResultCardProps['renderPersonLink'];
}

function Side({ side, result, interactive, renderPersonLink }: SideProps) {
  const sideLabel = `Side ${String(side.side + 1)}${result === 'won' ? ', winner' : ''}: ${side.label}`;
  return (
    <li
      className={classNames(styles['side'], result === 'won' && styles['winner'])}
      data-result={result}
    >
      <div role="group" aria-label={sideLabel} className={styles['sideInner']}>
        <span className={styles['avatars']}>
          {side.members.map((member) => (
            <ImageSlot
              key={member.personId}
              subject={personSubject(member)}
              size="md"
              shape="square"
              decorative
            />
          ))}
        </span>
        <span className={styles['sideText']}>
          {result === 'won' && (
            <span className={styles['winnerMarker']} data-part="winner">
              <Icon name="trophy" decorative />
              Winner
            </span>
          )}
          <ul className={styles['members']}>
            {side.members.map((member) => (
              <li key={member.personId} className={styles['member']} data-role={member.role}>
                {interactive && renderPersonLink !== undefined
                  ? renderPersonLink(member.personId, member.name)
                  : member.name}
              </li>
            ))}
          </ul>
        </span>
      </div>
    </li>
  );
}

interface TitleBannerProps {
  readonly title: SegmentTitleView;
  readonly winnerLabel: string | null;
  readonly interactive: boolean;
}

function TitleBanner({ title, winnerLabel, interactive }: TitleBannerProps) {
  const text = titleBannerText(title, winnerLabel);
  if (text === null) return null;
  return (
    <div
      className={classNames(styles['banner'], styles[`banner-${text.tone}`])}
      data-outcome={title.outcome}
    >
      <Icon name="titles" decorative />
      <p className={styles['bannerText']}>
        <strong className={styles['bannerHeadline']}>{text.headline}</strong>
        <span className={styles['bannerTitle']}>{title.name}</span>
      </p>
      {interactive && title.outcomeTraceRef !== null && (
        <WhyButton
          label={`the ${title.name} outcome`}
          value={text.whyValue}
          panelTitle={`Title outcome: ${title.name}`}
          source={{ traceRef: title.outcomeTraceRef }}
        />
      )}
    </div>
  );
}

interface BodyProps {
  readonly segment: SegmentResultView;
  readonly interactive: boolean;
  readonly renderPersonLink: SegmentResultCardProps['renderPersonLink'];
}

/** Everything under the header. Drawn without links or buttons while the card is hidden. */
function Body({ segment, interactive, renderPersonLink }: BodyProps) {
  const winningSide = winningSideOf(segment);
  const line = resultLine(segment);
  const { rating } = segment;
  const winnerLabel =
    winningSide === null
      ? null
      : (segment.sides.find((side) => side.side === winningSide)?.label ?? null);
  const traceRef = interactive ? (rating?.traceRef ?? null) : null;
  const isMatch = segment.kind === 'match';

  return (
    <div className={styles['body']}>
      {segment.label !== null && <p className={styles['billing']}>{segment.label}</p>}
      <ul
        className={classNames(styles['sides'], segment.sides.length === 1 && styles['oneSide'])}
        aria-label={isMatch ? 'Sides' : 'In the segment'}
        data-sides={segment.sides.length}
      >
        {segment.sides.map((side) => (
          <Side
            key={side.side}
            side={side}
            result={winningSide === null ? 'even' : side.side === winningSide ? 'won' : 'lost'}
            interactive={interactive}
            renderPersonLink={renderPersonLink}
          />
        ))}
      </ul>
      {line !== null && (
        <p className={styles['resultLine']} data-part="result">
          {line}
        </p>
      )}
      {rating !== null && (
        <dl className={styles['stats']}>
          <div className={classNames(styles['stat'], styles['statScore'])}>
            <dt>Segment score</dt>
            <dd className={styles['scoreValue']}>
              <StarRating value={rating.stars} size="sm" tone="broadcast" />
              <Explained value={rating.score} label="Segment score" traceRef={traceRef} />
            </dd>
          </div>
          {rating.workRate !== null && (
            <div className={styles['stat']}>
              <dt>Work rate</dt>
              <dd>
                <Explained value={rating.workRate} label="Work rate" traceRef={traceRef} />
              </dd>
            </div>
          )}
          {rating.crowd !== null && (
            <div className={styles['stat']}>
              <dt>Crowd</dt>
              <dd>
                <Explained value={rating.crowd} label="Crowd" traceRef={traceRef} />
              </dd>
            </div>
          )}
          {rating.expectation !== null && (
            <div className={styles['stat']}>
              <dt>Expected</dt>
              <dd>
                <Explained value={rating.expectation} label="Expected" traceRef={traceRef} />
              </dd>
            </div>
          )}
        </dl>
      )}
      {segment.storylines.length > 0 && (
        <ul className={styles['storylines']} aria-label="Storylines">
          {segment.storylines.map((storyline) => (
            <li key={storyline.id} className={classNames(styles['chip'], styles['chip-storyline'])}>
              {storyline.name}
            </li>
          ))}
        </ul>
      )}
      {segment.titles.map((title) => (
        <TitleBanner
          key={title.titleId}
          title={title}
          winnerLabel={winnerLabel}
          interactive={interactive}
        />
      ))}
    </div>
  );
}

/**
 * One finished segment, broadcast style: the slot and role, chips for the duration class, the
 * match type and the titles; every side with its people and the winner marked; the result line;
 * the stars and the numbers behind them, each with a Why?; storylines and the title banner. The
 * same accent bar as `CardSlot`: red-orange for the main event, gold for a title match, cyan for
 * the rest. Unrevealed, it keeps its full height and shows "Coming up: <Role>" instead.
 */
export function SegmentResultCard({
  segment,
  headingLevel = 3,
  revealed = true,
  renderPersonLink,
  footer,
  className,
}: SegmentResultCardProps) {
  const headingId = useId();
  const Heading = HEADING_TAGS[headingLevel];
  const accent = segmentResultAccent(segment);

  return (
    <article
      aria-labelledby={headingId}
      className={classNames(
        styles['card'],
        styles[`accent-${accent}`],
        segment.preShow && styles['preShow'],
        className,
      )}
      data-role={segment.roleKey}
      data-kind={segment.kind}
      data-state={revealed ? 'revealed' : 'hidden'}
    >
      <div className={styles['header']}>
        <Heading
          id={headingId}
          className={styles['roleTag']}
          aria-label={slotHeadingLabel(segment)}
        >
          <span>Slot {segment.slotNumber}</span>
          <SlashDivider variant="inline" tone="inherit" />
          <span>{segment.roleLabel}</span>
        </Heading>
        <ul
          className={classNames(styles['chips'], !revealed && styles['concealed'])}
          aria-label="Segment details"
          aria-hidden={revealed ? undefined : true}
        >
          <li className={styles['chip']} data-kind="duration">
            {segment.durationLabel}
          </li>
          <li className={classNames(styles['chip'], styles['chip-type'])} data-kind="type">
            {segment.typeName}
          </li>
          {segment.titles.map((title) => (
            <li
              key={title.titleId}
              className={classNames(styles['chip'], styles['chip-title'])}
              data-kind="title"
            >
              <Icon name="titles" decorative />
              {title.name}
            </li>
          ))}
        </ul>
      </div>

      {revealed ? (
        <Body segment={segment} interactive renderPersonLink={renderPersonLink} />
      ) : (
        // Both layers share one grid cell: the hidden card keeps the height, the placeholder
        // covers it. The hidden layer has no links or buttons and is out of the accessibility tree.
        <div className={styles['reveal']}>
          <div className={styles['concealed']} aria-hidden="true">
            <Body segment={segment} interactive={false} renderPersonLink={undefined} />
          </div>
          <p className={styles['placeholder']}>{comingUpText(segment)}</p>
        </div>
      )}
      {footer !== undefined && <div className={styles['footer']}>{footer}</div>}
    </article>
  );
}
