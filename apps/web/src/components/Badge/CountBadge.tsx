import { classNames } from '../classNames';
import { VisuallyHidden } from '../layout';
import type { Tone } from '../tone';
import styles from './Badge.module.css';
import type { BadgeVariant } from './Badge';

export interface CountBadgeProps {
  /** The number to show. */
  readonly count: number;
  /** Counts above this show as `max+`. 99 by default. */
  readonly max?: number;
  /** Show the badge at 0 instead of hiding it. */
  readonly showZero?: boolean;
  /**
   * What screen readers hear instead of the bare number, for example "3 unread". The visible
   * number is hidden from them, so "99+" is never announced on its own.
   */
  readonly label?: string;
  /** `accent` by default. */
  readonly tone?: Tone;
  /** `solid` by default. */
  readonly variant?: BadgeVariant;
  readonly className?: string | undefined;
}

/** The visible text for a count: the number, or `max+` once it goes past `max`. */
export function countBadgeText(count: number, max: number): string {
  return count > max ? `${String(max)}+` : String(count);
}

/** A small number in a pill, such as unread mail. Renders nothing at 0 unless `showZero`. */
export function CountBadge({
  count,
  max = 99,
  showZero = false,
  label,
  tone = 'accent',
  variant = 'solid',
  className,
}: CountBadgeProps) {
  if (count === 0 && !showZero) {
    return null;
  }
  const visibleText = countBadgeText(count, max);

  return (
    <span
      className={classNames(
        styles['badge'],
        styles['count'],
        styles[variant],
        styles[`tone-${tone}`],
        className,
      )}
    >
      <span aria-hidden="true">{visibleText}</span>
      <VisuallyHidden>{label ?? visibleText}</VisuallyHidden>
    </span>
  );
}
