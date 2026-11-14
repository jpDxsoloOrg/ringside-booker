import { useId } from 'react';
import { Link } from 'react-router-dom';
import type { StorylineRow } from '@ringside/engine';
import { Badge } from '../Badge';
import { classNames } from '../classNames';
import { formatGameDate, formatNumber } from '../format';
import { SegmentedMeter } from '../SegmentedMeter';
import { Explained } from '../Trace';
import { StorylineSides } from './StorylineSides';
import styles from './StorylineCard.module.css';

/** What a card says in place of the meter when the heat is not the viewer's to see. */
export const HEAT_NOT_PUBLIC_TEXT = 'Heat not public';

/** The word the heat meter shows once a storyline is hot. */
export const HOT_LABEL = 'Hot';

export interface StorylineCardProps {
  readonly row: StorylineRow;
  /** `storylines.heat.hotFrom`: where the meter turns red-orange and says Hot. */
  readonly hotFrom: number;
  /** The storyline's page. */
  readonly href: string;
  readonly className?: string | undefined;
}

function plural(count: number, one: string, many: string): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

/**
 * The card's footer facts: "Started Jan 4, 2027 · 2 linked segments · 3 days since it moved on".
 * A rival's card only has its dates; an ended one says when it ended.
 */
export function storylineFooterFacts(row: StorylineRow): string[] {
  const facts = [`Started ${formatGameDate(row.startedOn)}`];
  if (row.endedOn !== null) facts.push(`Ended ${formatGameDate(row.endedOn)}`);
  if (row.linkedSegmentCount !== null) {
    facts.push(plural(row.linkedSegmentCount, 'linked segment', 'linked segments'));
  }
  if (row.daysSinceProgress !== null) {
    facts.push(
      row.daysSinceProgress === 0
        ? 'Moved on today'
        : `${plural(row.daysSinceProgress, 'day', 'days')} since it moved on`,
    );
  }
  return facts;
}

/**
 * One storyline on the Storylines desk: its name (the link to its page), brand, the people by side
 * and the heat as a meter with its number and Why?. A rival's storyline, or any whose heat is not
 * public, says "Heat not public" and draws no meter.
 */
export function StorylineCard({ row, hotFrom, href, className }: StorylineCardProps) {
  const headingId = useId();
  return (
    <article
      className={classNames(styles['card'], className)}
      aria-labelledby={headingId}
      data-status={row.status}
    >
      <header className={styles['header']}>
        <h3 id={headingId} className={styles['name']}>
          <Link to={href} className={styles['nameLink']} title={row.name}>
            {row.name}
          </Link>
        </h3>
        <div className={styles['chips']}>
          {row.brandName !== null && <Badge tone="data">{row.brandName}</Badge>}
          {row.status === 'ended' && <Badge>Ended</Badge>}
        </div>
      </header>
      <StorylineSides faces={row.faces} heels={row.heels} neutrals={row.neutrals} />
      <div className={styles['heat']}>
        {row.heat === null ? (
          <p className={styles['muted']}>{HEAT_NOT_PUBLIC_TEXT}</p>
        ) : (
          <>
            <SegmentedMeter
              label="Heat"
              value={row.heat}
              dangerFrom={hotFrom}
              dangerLabel={HOT_LABEL}
              showValue={false}
              className={styles['meter']}
            />
            <Explained value={row.heat} label="Heat" traceRef={row.heatTraceRef} />
            {/* The meter keeps its value row hidden, so the Hot state is said here too. */}
            {row.heat >= hotFrom && (
              <Badge tone="action" variant="solid">
                {HOT_LABEL}
              </Badge>
            )}
          </>
        )}
      </div>
      <p className={styles['footer']}>{storylineFooterFacts(row).join(' · ')}</p>
    </article>
  );
}
