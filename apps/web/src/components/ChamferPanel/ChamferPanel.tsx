import { useId } from 'react';
import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import styles from './ChamferPanel.module.css';

export type ChamferPanelAccent = 'none' | 'action' | 'data' | 'prestige';
export type ChamferPanelSurface = 'default' | 'raised';
export type ChamferPanelPadding = 'none' | 'md';
export type ChamferPanelHeadingLevel = 2 | 3 | 4;

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export interface ChamferPanelProps {
  /** Heading in the broadcast style. With a title, a `section` panel is named by it. */
  readonly title?: ReactNode;
  /** A short uppercase line above the title, such as "Show forecast". */
  readonly kicker?: ReactNode;
  /** Heading level for the title, so the panel fits the page outline. 2 by default. */
  readonly headingLevel?: ChamferPanelHeadingLevel;
  /** Controls at the end of the header row. */
  readonly actions?: ReactNode;
  /** A coloured stripe along the top edge. `none` by default. */
  readonly accent?: ChamferPanelAccent;
  /** `raised` for a panel that is active or sits on another surface. */
  readonly surface?: ChamferPanelSurface;
  /** Body padding: `md` (the default) or `none` for edge-to-edge content. */
  readonly padding?: ChamferPanelPadding;
  /** `div` (the default) is a plain box; `section` and `article` are named by the title. */
  readonly as?: 'div' | 'section' | 'article';
  readonly id?: string;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/**
 * The broadcast register's container: square corners with the top-left and bottom-right corners
 * cut at `--chamfer`, a hairline border, and an optional accent stripe. The office register's
 * equivalent is `Panel`.
 */
export function ChamferPanel({
  title,
  kicker,
  headingLevel = 2,
  actions,
  accent = 'none',
  surface = 'default',
  padding = 'md',
  as: Element = 'div',
  id,
  className,
  children,
}: ChamferPanelProps) {
  const headingId = useId();
  const Heading = HEADING_TAGS[headingLevel];
  const hasHeader = title !== undefined || kicker !== undefined || actions !== undefined;
  const named = Element !== 'div' && title !== undefined;

  return (
    <Element
      id={id}
      aria-labelledby={named ? headingId : undefined}
      className={classNames(styles['frame'], className)}
      data-accent={accent}
    >
      <div
        className={classNames(
          styles['panel'],
          styles[`surface-${surface}`],
          styles[`accent-${accent}`],
        )}
      >
        {hasHeader && (
          <div className={styles['header']}>
            <div className={styles['titles']}>
              {kicker !== undefined && <p className={styles['kicker']}>{kicker}</p>}
              {title !== undefined && (
                <Heading id={headingId} className={styles['title']}>
                  {title}
                </Heading>
              )}
            </div>
            {actions !== undefined && <div className={styles['actions']}>{actions}</div>}
          </div>
        )}
        <div className={styles[`padding-${padding}`]}>{children}</div>
      </div>
    </Element>
  );
}
