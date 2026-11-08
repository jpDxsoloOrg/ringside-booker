import type { ReactNode } from 'react';
import styles from './layout.module.css';

export interface VisuallyHiddenProps {
  /** `span` by default, so it can sit inside a line of text. */
  readonly as?: 'span' | 'div';
  readonly children: ReactNode;
}

/** Content that screen readers announce but that takes no space on screen. */
export function VisuallyHidden({ as: Element = 'span', children }: VisuallyHiddenProps) {
  return <Element className={styles['visuallyHidden']}>{children}</Element>;
}
