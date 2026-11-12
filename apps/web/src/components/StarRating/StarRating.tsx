import { classNames } from '../classNames';
import { formatNumber } from '../format';
import { Icon } from '../Icon';
import styles from './StarRating.module.css';

/** The most stars a rating can show. */
export const STAR_RATING_MAX = 5;

/** How much of one star is filled, in quarters. */
export type StarFill = 0 | 25 | 50 | 75 | 100;

export type StarRatingSize = 'sm' | 'md' | 'lg';
export type StarRatingTone = 'office' | 'broadcast';

export interface StarRatingProps {
  /** 0 to 5 in quarter steps, such as 3.75. Anything else throws in development. */
  readonly value: number;
  /** `md` by default. */
  readonly size?: StarRatingSize;
  /** `office` (the default) for management screens, `broadcast` for show moments. */
  readonly tone?: StarRatingTone;
  readonly className?: string | undefined;
}

const QUARTERS_PER_STAR = 4;
const FILL_BY_QUARTERS: readonly StarFill[] = [0, 25, 50, 75, 100];

/** True for 0 to 5 in quarter steps. */
export function isQuarterStarValue(value: number): boolean {
  return (
    Number.isFinite(value) &&
    value >= 0 &&
    value <= STAR_RATING_MAX &&
    Number.isInteger(value * QUARTERS_PER_STAR)
  );
}

/** The value rounded to the nearest quarter and kept within 0 to 5. */
function normalised(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const quarters = Math.round(value * QUARTERS_PER_STAR) / QUARTERS_PER_STAR;
  return Math.min(STAR_RATING_MAX, Math.max(0, quarters));
}

/**
 * How full each of the five stars is: 3.75 gives `[100, 100, 100, 75, 0]`. Values off the quarter
 * grid or outside 0 to 5 are rounded and clamped first.
 */
export function starFills(value: number): StarFill[] {
  const rating = normalised(value);
  return Array.from({ length: STAR_RATING_MAX }, (_, index) => {
    const quarters = Math.round(Math.min(1, Math.max(0, rating - index)) * QUARTERS_PER_STAR);
    return FILL_BY_QUARTERS[quarters] ?? 0;
  });
}

/** The rating in words: "3.75 stars out of 5", "1 star out of 5", or "No stars" for 0. */
export function starRatingLabel(value: number): string {
  const rating = normalised(value);
  if (rating === 0) return 'No stars';
  const word = rating === 1 ? 'star' : 'stars';
  return `${formatNumber(rating, { maximumFractionDigits: 2 })} ${word} out of ${String(STAR_RATING_MAX)}`;
}

/**
 * A star rating from 0 to 5 in quarter steps: five star glyphs, each filled by a quarter, half,
 * three quarters or whole (clipped with CSS, no inline styles). It is an image named by the rating
 * in words, so the fill is never the only cue; 0 also says "No stars" on screen.
 */
export function StarRating({ value, size = 'md', tone = 'office', className }: StarRatingProps) {
  if (import.meta.env.DEV && !isQuarterStarValue(value)) {
    throw new RangeError(
      `StarRating: value must be 0 to ${String(STAR_RATING_MAX)} in quarter steps, got ${String(value)}`,
    );
  }
  const fills = starFills(value);
  const label = starRatingLabel(value);
  const empty = normalised(value) === 0;

  return (
    <span
      role="img"
      aria-label={label}
      className={classNames(
        styles['starRating'],
        styles[`size-${size}`],
        styles[`tone-${tone}`],
        className,
      )}
      data-value={normalised(value)}
    >
      <span className={styles['stars']}>
        {fills.map((fill, index) => (
          <span
            // The five places never move, so the place is a stable key.
            key={`star-${String(index)}`}
            className={classNames(styles['star'], styles[`fill-${String(fill)}`])}
            data-fill={fill}
          >
            <Icon name="star" decorative className={styles['glyphEmpty']} />
            <Icon name="star" decorative className={styles['glyphFilled']} />
          </span>
        ))}
      </span>
      {empty && (
        <span className={styles['noStars']} aria-hidden="true">
          No stars
        </span>
      )}
    </span>
  );
}
