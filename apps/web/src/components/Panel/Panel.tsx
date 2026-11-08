import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import styles from './Panel.module.css';

export type PanelHeadingLevel = 2 | 3 | 4;
export type PanelPadding = 'none' | 'md';
/**
 * The two visual registers (docs/design/visual-identity.md):
 * - `office`: a rounded card with a hairline border, for the management screens.
 * - `broadcast`: square corners with chamfered cuts and an uppercase header behind a red-orange
 *   slash, for show moments.
 */
export type PanelVariant = 'office' | 'broadcast';

export const PANEL_VARIANTS: readonly PanelVariant[] = ['office', 'broadcast'];

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
  /** `office` (the default) or `broadcast`. */
  readonly variant?: PanelVariant;
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
  variant = 'office',
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
        <Icon name="chevron-down" className={styles['chevron']} decorative />
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
      className={classNames(
        styles['panel'],
        styles[`variant-${variant}`],
        isExpanded && styles['expanded'],
        className,
      )}
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
