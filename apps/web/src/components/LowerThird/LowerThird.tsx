import { useId } from 'react';
import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import { SlashDivider } from '../SlashDivider';
import styles from './LowerThird.module.css';

export type LowerThirdAccent = 'action' | 'data' | 'prestige';
export type LowerThirdHeadingLevel = 1 | 2 | 3 | 4;

const HEADING_TAGS = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4' } as const;

/** One fact in the meta row under the title, such as a venue or a capacity. */
export interface LowerThirdMetaItem {
  /** Stable key for the list. */
  readonly id: string;
  readonly label: ReactNode;
  /** Decorative icon before the label; the label says the same thing. */
  readonly icon?: IconName;
}

export interface LowerThirdProps {
  /** The line above the title, such as "Up next // In 3 days". */
  readonly kicker: ReactNode;
  /** The big condensed title: a show name, a results header. */
  readonly title: ReactNode;
  /** Heading level of the title, so the block fits the page outline. 2 by default. */
  readonly headingLevel?: LowerThirdHeadingLevel;
  /** Facts in a row under the title, split by `//`. */
  readonly meta?: readonly LowerThirdMetaItem[];
  /** A short tag at the top right, such as an episode number. */
  readonly badge?: ReactNode;
  /** Colour of the kicker bar, the top stripe and the wedge. `action` (red-orange) by default. */
  readonly accent?: LowerThirdAccent;
  /** Draws the slanted accent wedge down the right edge. */
  readonly wedge?: boolean;
  /** Content under the header, such as meters or a feud line. */
  readonly children?: ReactNode;
  /** A footer row, such as projections and the main action. */
  readonly footer?: ReactNode;
  readonly className?: string | undefined;
}

/**
 * The broadcast lower-third: a kicker line, a big condensed title and a meta row, the way a TV
 * graphic introduces what is coming up. Used for the "Up next" show card and results headers.
 * It is a section named by its title.
 */
export function LowerThird({
  kicker,
  title,
  headingLevel = 2,
  meta,
  badge,
  accent = 'action',
  wedge = false,
  children,
  footer,
  className,
}: LowerThirdProps) {
  const headingId = useId();
  const Heading = HEADING_TAGS[headingLevel];

  return (
    <section
      aria-labelledby={headingId}
      className={classNames(
        styles['lowerThird'],
        styles[`accent-${accent}`],
        wedge && styles['withWedge'],
        className,
      )}
    >
      {wedge && <span className={styles['wedge']} data-part="wedge" aria-hidden="true" />}
      <div className={styles['header']}>
        <div className={styles['topRow']}>
          <p className={styles['kicker']}>{kicker}</p>
          {badge !== undefined && <p className={styles['badge']}>{badge}</p>}
        </div>
        <Heading id={headingId} className={styles['title']}>
          {title}
        </Heading>
        {meta !== undefined && meta.length > 0 && (
          <ul className={styles['meta']}>
            {meta.map((item, index) => (
              <li key={item.id} className={styles['metaItem']}>
                {index > 0 && <SlashDivider variant="inline" tone={accent} />}
                {item.icon !== undefined && (
                  <Icon name={item.icon} decorative className={styles['metaIcon']} />
                )}
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {children !== undefined && <div className={styles['body']}>{children}</div>}
      {footer !== undefined && <div className={styles['footer']}>{footer}</div>}
    </section>
  );
}
