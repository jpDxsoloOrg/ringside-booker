import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import styles from './layout.module.css';
import type { SpaceStep } from './space';

export type StackDirection = 'column' | 'row';
export type StackAlign = 'stretch' | 'start' | 'center' | 'end' | 'baseline';

export interface StackProps {
  /** Space between children as a `--space-*` step. 4 (1rem) by default. */
  readonly gap?: SpaceStep;
  /** `column` by default. A row stack never wraps; use `Cluster` for rows that should. */
  readonly direction?: StackDirection;
  /** Cross-axis alignment. `stretch` by default. */
  readonly align?: StackAlign;
  /** `ul` and `ol` drop their bullets, for lists laid out as a stack. */
  readonly as?: 'div' | 'ul' | 'ol';
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/** Lays its children out in a line (a column by default) with a token gap between them. */
export function Stack({
  gap = 4,
  direction = 'column',
  align = 'stretch',
  as: Element = 'div',
  className,
  children,
}: StackProps) {
  return (
    <Element
      className={classNames(
        styles['stack'],
        direction === 'row' && styles['direction-row'],
        styles[`gap-${String(gap)}`],
        styles[`align-${align}`],
        Element !== 'div' && styles['list'],
        className,
      )}
    >
      {children}
    </Element>
  );
}
