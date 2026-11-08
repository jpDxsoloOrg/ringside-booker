import type { ReactElement, ReactNode } from 'react';
import type { ButtonProps } from '../Button';
import { classNames } from '../classNames';
import { Icon } from '../Icon';
import type { IconName } from '../Icon';
import styles from './EmptyState.module.css';

export type EmptyStateSize = 'inline' | 'page';

const HEADING_TAGS = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export interface EmptyStateProps {
  /** A decorative icon above the title. */
  readonly icon?: IconName;
  /** What is empty, in a few words: "No matches booked yet". */
  readonly title: string;
  /** One or two sentences on why, or what to do next. */
  readonly body?: ReactNode;
  /** The way out of the empty state: a `Button`. */
  readonly action?: ReactElement<ButtonProps>;
  /** `inline` (the default) for inside a panel or table; `page` for a whole empty screen. */
  readonly size?: EmptyStateSize;
  /**
   * Make the title a heading at this level. Without it the title is a paragraph, which suits an
   * empty table inside a panel that already has its own heading.
   */
  readonly headingLevel?: 2 | 3 | 4;
  readonly className?: string | undefined;
}

/** What to show where a list, table or screen has nothing in it yet. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  size = 'inline',
  headingLevel,
  className,
}: EmptyStateProps) {
  const Title = headingLevel === undefined ? 'p' : HEADING_TAGS[headingLevel];

  return (
    <div className={classNames(styles['emptyState'], styles[`size-${size}`], className)}>
      {icon !== undefined && (
        <Icon
          name={icon}
          size={size === 'page' ? 'lg' : 'md'}
          className={styles['icon']}
          decorative
        />
      )}
      <Title className={styles['title']}>{title}</Title>
      {body !== undefined && <p className={styles['body']}>{body}</p>}
      {action !== undefined && <div className={styles['action']}>{action}</div>}
    </div>
  );
}
