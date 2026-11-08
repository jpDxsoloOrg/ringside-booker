import type { ReactNode } from 'react';
import { Badge } from '../../Badge';
import { classNames } from '../../classNames';
import styles from '../Trace.module.css';
import type { TraceLine } from '../wording';

export interface TraceLineViewProps {
  readonly line: TraceLine;
  /** Replaces the sentence's text, for a row that links part of it (an input's entity). */
  readonly text?: ReactNode;
  /** Extra class for the sentence, such as the formula's heavier weight. */
  readonly textClassName?: string | undefined;
}

/**
 * One row's words: the sentence in its tone, then a badge and muted details. The same pieces, in
 * the same order, make up the row's copy-as-text line.
 */
export function TraceLineView({ line, text, textClassName }: TraceLineViewProps) {
  return (
    <span className={styles['line']}>
      <span className={classNames(styles['text'], styles[`tone-${line.tone}`], textClassName)}>
        {text ?? line.text}
      </span>
      {line.badge !== undefined && (
        <Badge tone="prestige" className={styles['badge']}>
          {line.badge}
        </Badge>
      )}
      {line.details.map((detail) => (
        <span key={detail} className={styles['detail']}>
          {detail}
        </span>
      ))}
    </span>
  );
}
