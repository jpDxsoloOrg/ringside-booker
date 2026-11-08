import styles from '../ImageSlot.module.css';
import { PLACEHOLDER_SALT, hashString, pick } from '../hash';
import { CATEGORY_FILLS, PlaceholderSvg } from './shared';
import type { PlaceholderProps } from './shared';

/** A simple arena outline for venues, and the fallback for any kind without its own generator. */
export function GenericPlace({ subject, decorative }: PlaceholderProps) {
  const seed = hashString(subject.id);
  return (
    <PlaceholderSvg label={subject.name} decorative={decorative} generator="place">
      <rect
        x="0"
        y="0"
        width="64"
        height="64"
        rx="12"
        className={pick(CATEGORY_FILLS, seed, PLACEHOLDER_SALT.venue)}
      />
      <g className={styles['outlineInverse']}>
        {/* Domed roof with a flag on top. */}
        <path d="M10 42 C13 26 22 19 32 19 C42 19 51 26 54 42" />
        <path d="M32 19 V11 L39 13.5 L32 16" />
        {/* The building and its two entrances. */}
        <rect x="8" y="42" width="48" height="11" rx="1" />
        <path d="M19 53 V47.5 H26 V53 M38 53 V47.5 H45 V53" />
        {/* Roof ribs. */}
        <path d="M21 42 C22 31 26 24 32 22 M43 42 C42 31 38 24 32 22" />
      </g>
    </PlaceholderSvg>
  );
}
