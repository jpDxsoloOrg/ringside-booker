import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import styles from './Panel.module.css';

export type PanelHeadingLevel = 2 | 3 | 4;
export type PanelPadding = 'none' | 'md';

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export interface PanelProps {
  /** The panel's heading. A `section` panel is named by it. */
  readonly title: ReactNode;
  /** A muted line under the title. */
  readonly subtitle?: ReactNode;
  /** Controls at the end of the header row, such as a button or a menu. */
  readonly actions?: ReactNode;
  /** `section` (the default) is a named region; `div` is a plain box. */
  readonly as?: 'section' | 'div';
  /** Heading level for the title, so the panel fits the page outline. 2 by default. */
  readonly headingLevel?: PanelHeadingLevel;
  /** Puts the title in a disclosure button that shows and hides the body. */
  readonly collapsible?: boolean;
  /** Start collapsed. Only used when `collapsible`. */
  readonly defaultCollapsed?: boolean;
  /** Body padding: `md` (the default) or `none` for edge-to-edge content such as a table. */
  readonly padding?: PanelPadding;
  /** Anchor id for the panel element. */
  readonly id?: string;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/** A titled surface that groups related content. On phones it runs edge to edge. */
export function Panel({
  title,
  subtitle,
  actions,
  as: Element = 'section',
  headingLevel = 2,
  collapsible = false,
  defaultCollapsed = false,
  padding = 'md',
  id,
  className,
  children,
}: PanelProps) {
  const headingId = useId();
  const bodyId = useId();
  const [collapsed, setCollapsed] = useState(collapsible && defaultCollapsed);
  const Heading = HEADING_TAGS[headingLevel];
  const isExpanded = !collapsed;

  const heading = collapsible ? (
    <Heading className={styles['title']}>
      <button
        type="button"
        id={headingId}
        className={styles['toggle']}
        aria-expanded={isExpanded}
        aria-controls={bodyId}
        onClick={() => {
          setCollapsed((wasCollapsed) => !wasCollapsed);
        }}
      >
        <Icon name="chevron-down" className={styles['chevron']} />
        {title}
      </button>
    </Heading>
  ) : (
    <Heading id={headingId} className={styles['title']}>
      {title}
    </Heading>
  );

  return (
    <Element
      id={id}
      aria-labelledby={Element === 'section' ? headingId : undefined}
      className={classNames(styles['panel'], isExpanded && styles['expanded'], className)}
    >
      <div className={styles['header']}>
        <div className={styles['titles']}>
          {heading}
          {subtitle !== undefined && <p className={styles['subtitle']}>{subtitle}</p>}
        </div>
        {actions !== undefined && <div className={styles['actions']}>{actions}</div>}
      </div>
      <div
        id={bodyId}
        hidden={collapsed}
        className={classNames(styles['body'], styles[`padding-${padding}`])}
      >
        {children}
      </div>
    </Element>
  );
}
