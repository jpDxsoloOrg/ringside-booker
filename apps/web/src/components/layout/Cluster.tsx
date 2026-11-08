import type { ReactNode } from 'react';
import { classNames } from '../classNames';
import styles from './layout.module.css';
import type { SpaceStep } from './space';

export type ClusterJustify = 'start' | 'center' | 'end' | 'between';
export type ClusterAlign = 'start' | 'center' | 'end' | 'baseline' | 'stretch';

export interface ClusterProps {
  /** Space between children, across and down, as a `--space-*` step. 2 (0.5rem) by default. */
  readonly gap?: SpaceStep;
  /** Main-axis distribution. `start` by default. */
  readonly justify?: ClusterJustify;
  /** Cross-axis alignment. `center` by default. */
  readonly align?: ClusterAlign;
  /** `ul` and `ol` drop their bullets, for lists laid out as a row. */
  readonly as?: 'div' | 'ul' | 'ol';
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/** A row that wraps onto new lines when it runs out of width, so it never overflows a phone. */
export function Cluster({
  gap = 2,
  justify = 'start',
  align = 'center',
  as: Element = 'div',
  className,
  children,
}: ClusterProps) {
  return (
    <Element
      className={classNames(
        styles['cluster'],
        styles[`gap-${String(gap)}`],
        styles[`justify-${justify}`],
        styles[`align-${align}`],
        Element !== 'div' && styles['list'],
        className,
      )}
    >
      {children}
    </Element>
  );
}
