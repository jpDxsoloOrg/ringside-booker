import type { NewsKind } from '@ringside/engine';
import { classNames } from '@/components/classNames';
import { newsKindTone } from './newsTone';
import styles from './NewsKindTag.module.css';

export interface NewsKindTagProps {
  readonly kind: NewsKind;
  /** The kind's name on screen, from the story's `kindLabel`. */
  readonly label: string;
  readonly className?: string | undefined;
}

/** A story's kind as the ticker draws it: a slanted tag in the kind's tone, always with its word. */
export function NewsKindTag({ kind, label, className }: NewsKindTagProps) {
  return (
    <span className={classNames(styles['tag'], styles[`tone-${newsKindTone(kind)}`], className)}>
      <span className={styles['text']}>{label}</span>
    </span>
  );
}
