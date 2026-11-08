import { classNames } from '../classNames';
import styles from './SlashDivider.module.css';

export type SlashDividerTone = 'neutral' | 'inherit' | 'action' | 'data' | 'prestige';
export type SlashDividerVariant = 'band' | 'inline';

export interface SlashDividerProps {
  /**
   * `band` (the default) is a full-width strip of 45° slashes between blocks: a separator for
   * screen readers unless `decorative`. `inline` is the `//` mark between items on one line, such
   * as "Up next // In 3 days"; it is always hidden from screen readers.
   */
  readonly variant?: SlashDividerVariant;
  /**
   * Colour of the slashes. `neutral` (the border colour, or muted text inline) by default;
   * `inherit` takes the surrounding text colour, for a slash on a coloured tag.
   */
  readonly tone?: SlashDividerTone;
  /** Hide a band from screen readers when it only decorates, such as under a heading. */
  readonly decorative?: boolean;
  readonly className?: string | undefined;
}

/** The broadcast register's divider: 45° slashes, as a band between blocks or `//` in a line. */
export function SlashDivider({
  variant = 'band',
  tone = 'neutral',
  decorative = false,
  className,
}: SlashDividerProps) {
  const toneClass = styles[`tone-${tone}`];

  if (variant === 'inline') {
    return (
      <span className={classNames(styles['inline'], toneClass, className)} aria-hidden="true">
        {'//'}
      </span>
    );
  }

  return (
    <hr
      className={classNames(styles['band'], toneClass, className)}
      aria-hidden={decorative ? true : undefined}
    />
  );
}
